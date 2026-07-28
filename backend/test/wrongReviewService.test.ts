import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initLearningDomainDatabase } from '../src/services/learningDomain.js';
import { getLearningTask } from '../src/services/learningTaskService.js';
import { createWrongReviewTask, listWrongProblemCandidates } from '../src/services/wrongReviewService.js';

function createDatabase(): Database.Database {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE scanned_items (id TEXT PRIMARY KEY, type TEXT, subject TEXT, ownerId TEXT, problemsJson TEXT, timestamp INTEGER);
    CREATE TABLE quiz_results (id TEXT PRIMARY KEY, subject TEXT, chapter TEXT, ownerId TEXT, resultsJson TEXT, status TEXT, createdAt INTEGER);
    CREATE TABLE classroom_items (id TEXT PRIMARY KEY, type TEXT, bookTitle TEXT, chapter TEXT, subject TEXT, ownerId TEXT, userName TEXT, contentJson TEXT, slideCount INTEGER, questionCount INTEGER, source TEXT, sourceProblemId TEXT, createdAt INTEGER);
    CREATE TABLE wrong_problem_quiz_links (id TEXT PRIMARY KEY, scannedItemId TEXT, problemIndex INTEGER, ownerId TEXT, coursewareId TEXT, quizId TEXT, createdAt INTEGER);
  `);
  initLearningDomainDatabase(database);
  database.prepare(`INSERT INTO scanned_items VALUES (?, 'wrong_problem', '数学', 'child_1', ?, ?)`)
    .run('scan-1', JSON.stringify([{ content: '12 除以 3 等于多少？', answer: '4', studentAnswer: '3', knowledgePoints: ['除法'] }]), 1000);
  database.prepare(`INSERT INTO quiz_results VALUES (?, '数学', '第一单元', 'child_1', ?, 'completed', ?)`)
    .run('result-1', JSON.stringify([{ question: '300 + 20 等于多少？', correctAnswer: '320', studentAnswer: '302', isCorrect: false, explanation: '按位相加' }]), 2000);
  return database;
}

const generated = {
  slides: [{ title: '易错点', content: '先看运算顺序，再核对每一步的计算结果。', notes: '结合两道错题复盘。' }],
  questions: [{ type: 'fill', question: '48 除以 6 等于多少？', answer: '8', explanation: '利用乘法口诀计算。' }],
};

test('reads and aggregates selected scanned and classroom wrong problems into one task', async () => {
  const database = createDatabase();
  const candidates = listWrongProblemCandidates('child_1', '数学', database);
  assert.deepEqual(candidates.map(candidate => candidate.source), ['quiz_result', 'scanned_item']);

  const result = await createWrongReviewTask({
    ownerId: 'child_1', requestKey: 'mixed-wrong-review', taskType: 'wrong_review', userName: '大宝',
    source: { kind: 'wrong_problems', subject: '数学', grade: '四年级', problems: [
      { source: 'scanned_item', scannedItemId: 'scan-1', problemIndex: 0 },
      { source: 'quiz_result', quizResultId: 'result-1', problemIndex: 0 },
    ] },
  }, { database, generate: async () => generated });

  assert.equal(result.generationStatus, 'ready');
  const task = getLearningTask(database, result.id, 'child_1');
  assert.equal(task?.wrongProblemRefs.length, 2);
  assert.equal(task?.wrongProblemRefs[1].source, 'quiz_result');
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM classroom_items WHERE ownerId = 'child_1'`).get() as { count: number }).count, 2);
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM learning_task_links WHERE taskId = ?`).get(result.id) as { count: number }).count, 2);
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM wrong_problem_quiz_links WHERE ownerId = 'child_1'`).get() as { count: number }).count, 1);
  const repeated = await createWrongReviewTask({
    ownerId: 'child_1', requestKey: 'mixed-wrong-review', taskType: 'wrong_review',
    source: { kind: 'wrong_problems', subject: '数学', grade: '四年级', problems: [{ source: 'scanned_item', scannedItemId: 'scan-1', problemIndex: 0 }] },
  }, { database, generate: async () => { throw new Error('不应再次调用模型'); } });
  assert.deepEqual(repeated, result);
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM classroom_items WHERE ownerId = 'child_1'`).get() as { count: number }).count, 2);
});

test('rejects cross-owner and cross-subject refs before creating a task', async () => {
  const database = createDatabase();
  database.prepare(`INSERT INTO scanned_items VALUES (?, 'wrong_problem', '英语', 'child_1', ?, ?)`)
    .run('scan-english', JSON.stringify([{ content: 'apple 的意思是什么？', answer: '苹果', knowledgePoints: ['词汇'] }]), 3000);
  await assert.rejects(() => createWrongReviewTask({
    ownerId: 'child_1', requestKey: 'wrong-subject', taskType: 'wrong_review',
    source: { kind: 'wrong_problems', subject: '数学', grade: '四年级', problems: [{ source: 'scanned_item', scannedItemId: 'scan-english', problemIndex: 0 }] },
  }, { database, generate: async () => generated }));
  await assert.rejects(() => createWrongReviewTask({
    ownerId: 'child_2', requestKey: 'wrong-owner', taskType: 'wrong_review',
    source: { kind: 'wrong_problems', subject: '数学', grade: '四年级', problems: [{ source: 'scanned_item', scannedItemId: 'scan-1', problemIndex: 0 }] },
  }, { database, generate: async () => generated }));
  assert.equal((database.prepare('SELECT COUNT(*) AS count FROM learning_tasks').get() as { count: number }).count, 0);
});

test('leaves a retryable failed task without incomplete entities when generation fails', async () => {
  const database = createDatabase();
  await assert.rejects(() => createWrongReviewTask({
    ownerId: 'child_1', requestKey: 'generation-failure', taskType: 'wrong_review',
    source: { kind: 'wrong_problems', subject: '数学', grade: '四年级', problems: [{ source: 'scanned_item', scannedItemId: 'scan-1', problemIndex: 0 }] },
  }, { database, generate: async () => { throw new Error('模型暂不可用'); } }));
  const task = database.prepare(`SELECT generationStatus, errorCode FROM learning_tasks WHERE requestKey = 'generation-failure'`).get() as { generationStatus: string; errorCode: string };
  assert.deepEqual(task, { generationStatus: 'failed', errorCode: 'generation_failed' });
  assert.equal((database.prepare('SELECT COUNT(*) AS count FROM classroom_items').get() as { count: number }).count, 0);
  assert.equal((database.prepare('SELECT COUNT(*) AS count FROM learning_task_links').get() as { count: number }).count, 0);
});
