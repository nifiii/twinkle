import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createReviewItems } from '../services/answerReviewService.js';

type Manifest = {
  id: 'answer-review-grading-cleanup'; mode: 'dry-run'; generatedAt: string; databaseSha256: string;
  targets: { quizResults: string[]; paperAttempts: string[]; itemResults: number; reviewEvents: number };
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const hasTable = (database: Database.Database, table: string) => Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
const parse = <T>(value: string | null, fallback: T): T => { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };

function scoreFreeQuizSnapshot(value: string | null): string {
  const items = parse<Array<Record<string, unknown>>>(value, []);
  const answers = Object.fromEntries(items.map((item, index) => [String(item.id || item.questionId || `q${index + 1}`), typeof item.studentAnswer === 'string' ? item.studentAnswer : '']));
  return JSON.stringify(createReviewItems(items, answers));
}

function paperSnapshot(database: Database.Database, attemptId: string, paperId: string, answersJson: string): string {
  const paper = database.prepare('SELECT contentJson FROM assessment_papers WHERE id = ?').get(paperId) as { contentJson: string } | undefined;
  const content = parse<{ sections?: Array<{ questions?: Array<Record<string, unknown>> }> }>(paper?.contentJson || null, {});
  return JSON.stringify(createReviewItems((content.sections || []).flatMap(section => section.questions || []), parse<Record<string, string>>(answersJson, {})));
}

export function buildGradingCleanupManifest(database: Database.Database): Manifest {
  const quizRows = hasTable(database, 'quiz_results') ? database.prepare('SELECT id, resultsJson FROM quiz_results ORDER BY id').all() as Array<{ id: string; resultsJson: string | null }> : [];
  const attemptRows = hasTable(database, 'paper_attempts') ? database.prepare("SELECT id, paperId, answersJson, reviewSnapshotJson FROM paper_attempts WHERE status = 'submitted' ORDER BY id").all() as Array<{ id: string; paperId: string; answersJson: string; reviewSnapshotJson: string | null }> : [];
  const quizResults = quizRows.map(row => row.id);
  const paperAttempts = attemptRows.map(row => row.id);
  const count = (table: string) => hasTable(database, table) ? (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count : 0;
  return { id: 'answer-review-grading-cleanup', mode: 'dry-run', generatedAt: new Date().toISOString(), databaseSha256: hash(JSON.stringify({ quizRows, attemptRows, itemResults: count('attempt_item_results'), reviewEvents: count('review_events') })), targets: { quizResults, paperAttempts, itemResults: count('attempt_item_results'), reviewEvents: count('review_events') } };
}

export function applyGradingCleanup(database: Database.Database, approved: Manifest): Manifest {
  const current = buildGradingCleanupManifest(database);
  if (current.databaseSha256 !== approved.databaseSha256) throw new Error('清理清单与当前评分数据不一致，未执行删除');
  database.transaction(() => {
    if (hasTable(database, 'quiz_results')) {
      const rows = database.prepare('SELECT id, resultsJson FROM quiz_results').all() as Array<{ id: string; resultsJson: string | null }>;
      const columns = new Set((database.prepare('PRAGMA table_info(quiz_results)').all() as Array<{ name: string }>).map(column => column.name));
      for (const row of rows) {
        const clear = ['correctCount', 'total', 'percentage', 'suggestions', 'gradedAt', 'userOverridesJson'].filter(column => columns.has(column));
        const sets = ['resultsJson = ?', ...clear.map(column => `${column} = ?`)];
        database.prepare(`UPDATE quiz_results SET ${sets.join(', ')} WHERE id = ?`).run(scoreFreeQuizSnapshot(row.resultsJson), ...clear.map(column => ['correctCount', 'total', 'percentage'].includes(column) ? 0 : null), row.id);
      }
    }
    if (hasTable(database, 'paper_attempts')) {
      const rows = database.prepare("SELECT id, paperId, answersJson, reviewSnapshotJson FROM paper_attempts WHERE status = 'submitted'").all() as Array<{ id: string; paperId: string; answersJson: string; reviewSnapshotJson: string | null }>;
      const hasScore = (database.prepare('PRAGMA table_info(paper_attempts)').all() as Array<{ name: string }>).some(column => column.name === 'diagnosticScore');
      for (const row of rows) database.prepare(`UPDATE paper_attempts SET reviewSnapshotJson = ?, ${hasScore ? 'diagnosticScore = NULL,' : ''} updatedAt = updatedAt WHERE id = ?`).run(row.reviewSnapshotJson || paperSnapshot(database, row.id, row.paperId, row.answersJson), row.id);
    }
    if (hasTable(database, 'attempt_item_results')) database.prepare('DELETE FROM attempt_item_results').run();
    if (hasTable(database, 'review_events')) database.prepare('DELETE FROM review_events').run();
  })();
  return current;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2); const apply = args[0] === '--apply' && args[1] === '--manifest' && args[2];
  if (!apply && args.length > 0 && !(args.length === 1 && args[0] === '--dry-run')) throw new Error('用法: --dry-run 或 --apply --manifest <manifest>');
  const dataDir = process.env.DATA_DIR || '/opt/twinkle/data'; const dbPath = process.env.HLOS_DB_PATH || path.join(dataDir, 'hlos.db');
  const database = new Database(dbPath); const manifest = buildGradingCleanupManifest(database);
  const outputDir = path.join(dataDir, 'migrations', manifest.id, `${Date.now()}-${randomUUID().slice(0, 8)}`); await mkdir(outputDir, { recursive: true });
  const backupPath = path.join(outputDir, 'hlos.db'); await database.backup(backupPath);
  if (!apply) { await writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify({ ...manifest, backupPath }, null, 2)); console.log(JSON.stringify({ ...manifest, backupPath }, null, 2)); return; }
  const approved = JSON.parse(await readFile(args[2], 'utf8')) as Manifest; applyGradingCleanup(database, approved); await writeFile(path.join(outputDir, 'result.json'), JSON.stringify({ status: 'completed', manifest, backupPath }, null, 2)); console.log(JSON.stringify({ status: 'completed', backupPath }, null, 2));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
