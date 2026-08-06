import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initLearningDomainDatabase } from '../src/services/learningDomain.js';
import { applyEnglishListeningRepair, createEnglishListeningRepairManifest } from '../src/scripts/repairEnglishListeningFailures.js';

test('creates an audited backup manifest then repairs grade and retires only invalid listening failures', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'twinkle-listening-repair-'));
  const database = new Database(path.join(dataDir, 'hlos.db'));
  database.exec(`CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT, ownerId TEXT, grade TEXT)`);
  initLearningDomainDatabase(database);
  database.prepare(`INSERT INTO books VALUES ('english-3', '义务教育教科书 英语 三年级下册', 'child_1', '小学')`).run();
  database.prepare(`INSERT INTO learning_tasks (id, ownerId, requestKey, taskType, sourceType, subject, grade, bookId, chapterIdsJson, wrongProblemRefsJson, title, generationStatus, learningStatus, errorCode, errorMessage, createdAt, updatedAt)
    VALUES (?, 'child_1', ?, 'english_listening', 'chapter', '英语', '小学', 'english-3', '[]', '[]', ?, 'failed', 'not_started', 'generation_failed', ?, 1, 1)`)
    .run('failed-1', 'listening-1', 'Unit 1·英语听力', '英语教材缺少可识别的 1-6 年级信息');
  database.prepare(`INSERT INTO learning_tasks (id, ownerId, requestKey, taskType, sourceType, subject, grade, bookId, chapterIdsJson, wrongProblemRefsJson, title, generationStatus, learningStatus, errorCode, errorMessage, createdAt, updatedAt)
    VALUES (?, 'child_1', ?, 'english_listening', 'chapter', '英语', '小学', 'english-3', '[]', '[]', ?, 'failed', 'not_started', 'generation_failed', ?, 2, 2)`)
    .run('keep-1', 'listening-2', 'Unit 2·英语听力', '模型请求超时');

  const manifest = await createEnglishListeningRepairManifest(database, { dataDir, bookId: 'english-3', now: new Date('2026-08-06T00:00:00.000Z') });
  assert.deepEqual(manifest.failedTasks.map(task => task.id), ['failed-1']);
  assert.deepEqual(manifest.blockers, ['存在非教材元数据或章节正文失败的听力任务，未纳入删除清单']);
  const manifestPath = path.join(dataDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({ ...manifest, blockers: [] }));
  // Removing the unrelated task is the maintenance decision needed before apply.
  database.prepare(`DELETE FROM learning_tasks WHERE id = 'keep-1'`).run();
  const approved = JSON.parse(await readFile(manifestPath, 'utf8')) as typeof manifest;
  approved.blockers = [];
  await writeFile(manifestPath, JSON.stringify(approved));
  const result = await applyEnglishListeningRepair(database, manifestPath, dataDir);
  assert.deepEqual(result, { repairedBookId: 'english-3', retiredTaskCount: 1 });
  assert.equal((database.prepare(`SELECT grade FROM books WHERE id = 'english-3'`).get() as { grade: string }).grade, '三年级下册');
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM learning_tasks WHERE id = 'failed-1'`).get() as { count: number }).count, 0);
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM retired_learning_content WHERE entityId = 'failed-1'`).get() as { count: number }).count, 1);
  database.close();
});
