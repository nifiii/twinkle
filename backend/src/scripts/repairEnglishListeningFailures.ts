import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';

const REPAIR_ID = '2026-08-06_english_listening_repair';
const INVALID_LISTENING_MESSAGE = /缺少可识别的 1-6 年级信息|教材中找不到.*正文|没有足够的章节正文/;

type RepairManifest = {
  repairId: string;
  mode: 'dry-run';
  runId: string;
  generatedAt: string;
  backup: { directory: string; databasePath: string; databaseSha256: string };
  book: { id: string; title: string; ownerId: string; previousGrade: string | null; nextGrade: '三年级下册' };
  failedTasks: Array<{ id: string; generationStatus: string; errorCode: string | null; errorMessage: string | null }>;
  blockers: string[];
};

function hash(content: Buffer): string { return createHash('sha256').update(content).digest('hex'); }
function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const next = argv[index + 1];
    args.set(value, next && !next.startsWith('--') ? next : true);
    if (next && !next.startsWith('--')) index += 1;
  }
  return args;
}

export async function createEnglishListeningRepairManifest(
  database: Database.Database,
  input: { dataDir: string; bookId: string; now?: Date },
): Promise<RepairManifest> {
  const book = database.prepare(`SELECT id, title, ownerId, grade FROM books WHERE id = ?`).get(input.bookId) as { id: string; title: string; ownerId: string; grade: string | null } | undefined;
  if (!book) throw new Error('教材不存在');
  if (!/英语/.test(book.title)) throw new Error('指定教材不是英语教材，拒绝执行修复');
  const timestamp = (input.now || new Date()).toISOString().replace(/[:.]/g, '-');
  const directory = path.join(input.dataDir, 'migrations', REPAIR_ID, `${timestamp}-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(directory, { recursive: true });
  const databasePath = path.join(input.dataDir, 'hlos.db');
  const backupPath = path.join(directory, 'hlos.db');
  await fs.copyFile(databasePath, backupPath);
  const databaseSha256 = hash(await fs.readFile(backupPath));
  const tasks = database.prepare(`
    SELECT task.id, task.generationStatus, task.errorCode, task.errorMessage
    FROM learning_tasks task
    WHERE task.ownerId = ? AND task.bookId = ? AND task.taskType = 'english_listening'
      AND task.generationStatus IN ('failed', 'resource_unavailable')
      AND NOT EXISTS (SELECT 1 FROM learning_task_links link WHERE link.taskId = task.id)
    ORDER BY task.createdAt ASC, task.id ASC
  `).all(book.ownerId, book.id) as RepairManifest['failedTasks'];
  const failedTasks = tasks.filter(task => INVALID_LISTENING_MESSAGE.test(task.errorMessage || ''));
  const blockers: string[] = [];
  if (tasks.length !== failedTasks.length) blockers.push('存在非教材元数据或章节正文失败的听力任务，未纳入删除清单');
  return {
    repairId: REPAIR_ID, mode: 'dry-run', runId: path.basename(directory), generatedAt: (input.now || new Date()).toISOString(),
    backup: { directory, databasePath: backupPath, databaseSha256 },
    book: { id: book.id, title: book.title, ownerId: book.ownerId, previousGrade: book.grade, nextGrade: '三年级下册' },
    failedTasks, blockers,
  };
}

export async function applyEnglishListeningRepair(database: Database.Database, manifestPath: string, dataDir: string): Promise<{ repairedBookId: string; retiredTaskCount: number }> {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as RepairManifest;
  if (manifest.repairId !== REPAIR_ID || manifest.mode !== 'dry-run') throw new Error('修复清单不合法');
  if (manifest.blockers.length) throw new Error(`修复清单存在阻断项: ${manifest.blockers.join('；')}`);
  const backupRelative = path.relative(path.resolve(dataDir), path.resolve(manifest.backup.databasePath));
  if (backupRelative === '..' || backupRelative.startsWith(`..${path.sep}`) || path.isAbsolute(backupRelative)) throw new Error('备份路径不在数据卷内');
  if (hash(await fs.readFile(manifest.backup.databasePath)) !== manifest.backup.databaseSha256) throw new Error('已审核备份的哈希不匹配');
  const current = await createEnglishListeningRepairManifest(database, { dataDir, bookId: manifest.book.id });
  if (current.book.title !== manifest.book.title || current.book.ownerId !== manifest.book.ownerId || current.book.previousGrade !== manifest.book.previousGrade || current.failedTasks.map(task => task.id).join(',') !== manifest.failedTasks.map(task => task.id).join(',')) {
    throw new Error('当前数据与已审核清单不一致，请重新生成并审核清单');
  }
  database.transaction(() => {
    database.prepare(`UPDATE books SET grade = ? WHERE id = ?`).run(manifest.book.nextGrade, manifest.book.id);
    for (const task of manifest.failedTasks) {
      database.prepare(`INSERT OR IGNORE INTO retired_learning_content (ownerId, entityType, entityId, retiredAt) VALUES (?, 'learning_task', ?, ?)`).run(manifest.book.ownerId, task.id, Date.now());
      database.prepare(`DELETE FROM learning_task_events WHERE taskId = ?`).run(task.id);
      database.prepare(`DELETE FROM learning_task_links WHERE taskId = ?`).run(task.id);
      database.prepare(`DELETE FROM learning_tasks WHERE id = ? AND ownerId = ?`).run(task.id, manifest.book.ownerId);
    }
  })();
  return { repairedBookId: manifest.book.id, retiredTaskCount: manifest.failedTasks.length };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = typeof args.get('--data-dir') === 'string' ? String(args.get('--data-dir')) : process.env.DATA_DIR || '/opt/twinkle/data';
  const manifestPath = typeof args.get('--manifest') === 'string' ? String(args.get('--manifest')) : '';
  const apply = args.get('--apply') === true;
  const bookId = typeof args.get('--book-id') === 'string' ? String(args.get('--book-id')) : '';
  if (!bookId && !manifestPath) throw new Error('必须提供 --book-id 或 --manifest');
  const database = new Database(path.join(dataDir, 'hlos.db'));
  try {
    if (apply) {
      if (!manifestPath) throw new Error('--apply 必须同时提供已审核的 --manifest');
      const result = await applyEnglishListeningRepair(database, manifestPath, dataDir);
      console.log(JSON.stringify({ status: 'completed', ...result, manifestPath }, null, 2));
      return;
    }
    const manifest = await createEnglishListeningRepairManifest(database, { dataDir, bookId });
    const outputPath = path.join(manifest.backup.directory, 'manifest.json');
    await fs.writeFile(outputPath, JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({ status: 'dry-run', manifestPath: outputPath, book: manifest.book, failedTaskCount: manifest.failedTasks.length, blockers: manifest.blockers }, null, 2));
  } finally { database.close(); }
}

if (process.argv[1] && import.meta.url.endsWith(pathToFileName(process.argv[1]))) void main();

function pathToFileName(filePath: string): string { return path.basename(filePath); }
