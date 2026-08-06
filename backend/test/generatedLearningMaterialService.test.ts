import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initLearningDomainDatabase } from '../src/services/learningDomain.js';
import { completeLearningTask, createLearningTask, updateLearningTaskGenerationStatus } from '../src/services/learningTaskService.js';
import { GeneratedMaterialError, listGeneratedLearningMaterials, retireGeneratedLearningMaterial } from '../src/services/generatedLearningMaterialService.js';
import { getPaperAttemptReview } from '../src/services/answerReviewService.js';

function database(): Database.Database {
  const value = new Database(':memory:');
  value.exec(`
    CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT NOT NULL, ownerId TEXT NOT NULL, tableOfContents TEXT);
    CREATE TABLE classroom_items (id TEXT PRIMARY KEY, type TEXT NOT NULL, ownerId TEXT NOT NULL, lastStudiedAt INTEGER);
    CREATE TABLE quiz_results (id TEXT PRIMARY KEY, quizId TEXT NOT NULL, ownerId TEXT NOT NULL, status TEXT NOT NULL, resultsJson TEXT);
  `);
  initLearningDomainDatabase(value);
  value.prepare(`INSERT INTO books VALUES (?, ?, ?, ?)`).run('book-1', '四年级数学', 'shared', JSON.stringify([{ id: 'c1', title: '大数的认识' }]));
  return value;
}

function readyCourseware(value: Database.Database, requestKey = 'courseware-1') {
  const { task } = createLearningTask(value, {
    ownerId: 'child_1', requestKey, taskType: 'courseware', sourceType: 'chapter', subject: '数学', grade: '四年级',
    title: '大数的认识·学生自学课件', bookId: 'book-1', chapterIds: ['c1'],
  }, 1000);
  updateLearningTaskGenerationStatus(value, task.id, 'running', { now: 1001 });
  value.prepare(`INSERT INTO classroom_items VALUES (?, 'courseware', ?, NULL)`).run(`courseware-${requestKey}`, 'child_1');
  completeLearningTask(value, task.id, [{ entityType: 'classroom_courseware', entityId: `courseware-${requestKey}`, role: 'primary' }], 1002);
  return task.id;
}

test('lists ready generated material by subject and retires only its owned task and entity', () => {
  const value = database();
  const taskId = readyCourseware(value);
  const page = listGeneratedLearningMaterials(value, 'child_1', { subject: '数学', progress: 'pending' });
  assert.deepEqual(page.items.map(item => ({ taskId: item.taskId, chapterTitles: item.chapterTitles, learningStatus: item.learningStatus })), [{ taskId, chapterTitles: ['大数的认识'], learningStatus: 'not_started' }]);

  assert.deepEqual(retireGeneratedLearningMaterial(value, taskId, 'child_1', 2000), { taskId, retiredEntityCount: 2 });
  assert.equal(listGeneratedLearningMaterials(value, 'child_1').items.length, 0);
  assert.equal((value.prepare(`SELECT COUNT(*) AS count FROM learning_tasks`).get() as { count: number }).count, 0);
  assert.equal((value.prepare(`SELECT COUNT(*) AS count FROM classroom_items`).get() as { count: number }).count, 0);
  assert.equal((value.prepare(`SELECT COUNT(*) AS count FROM retired_learning_content WHERE entityType = 'learning_task'`).get() as { count: number }).count, 1);
  assert.throws(() => retireGeneratedLearningMaterial(value, taskId, 'child_1'), (error: unknown) => error instanceof GeneratedMaterialError && error.code === 'learning_content_retired');
});

test('rejects deletion when another task references the same generated entity', () => {
  const value = database();
  const first = readyCourseware(value, 'first');
  const { task } = createLearningTask(value, {
    ownerId: 'child_1', requestKey: 'second', taskType: 'courseware', sourceType: 'chapter', subject: '数学', grade: '四年级',
    title: '大数的认识·副本', bookId: 'book-1', chapterIds: ['c1'],
  }, 1010);
  updateLearningTaskGenerationStatus(value, task.id, 'running', { now: 1011 });
  completeLearningTask(value, task.id, [{ entityType: 'classroom_courseware', entityId: 'courseware-first', role: 'primary' }], 1012);
  assert.throws(() => retireGeneratedLearningMaterial(value, first, 'child_1'), (error: unknown) => error instanceof GeneratedMaterialError && error.code === 'shared_generated_content');
  assert.equal((value.prepare(`SELECT COUNT(*) AS count FROM learning_tasks`).get() as { count: number }).count, 2);
});

test('rejects assessment deletion when submitted review snapshot is incomplete', () => {
  const value = database();
  const { task } = createLearningTask(value, {
    ownerId: 'child_1', requestKey: 'paper', taskType: 'assessment', sourceType: 'chapter', subject: '数学', grade: '四年级',
    title: '大数的认识·模拟考试', bookId: 'book-1', chapterIds: ['c1'],
  }, 1000);
  updateLearningTaskGenerationStatus(value, task.id, 'running', { now: 1001 });
  value.prepare(`INSERT INTO assessment_blueprints (id, ownerId, bookId, chapterIdsJson, examType, difficulty, sectionsJson, styleProfileId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('blueprint-1', 'child_1', 'book-1', '["c1"]', 'unit', 'standard', '[]', null, 1001);
  value.prepare(`INSERT INTO assessment_papers VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('paper-1', 'blueprint-1', 'child_1', 1, '{}', 100, 'completed', 1001);
  completeLearningTask(value, task.id, [{ entityType: 'assessment_paper', entityId: 'paper-1', role: 'paper' }], 1002);
  value.prepare(`INSERT INTO paper_attempts (id, paperId, ownerId, answersJson, reviewSnapshotJson, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 'submitted', ?, ?)`).run('attempt-1', 'paper-1', 'child_1', '{}', null, 1003, 1003);
  assert.throws(() => retireGeneratedLearningMaterial(value, task.id, 'child_1'), (error: unknown) => error instanceof GeneratedMaterialError && error.code === 'review_snapshot_incomplete');
  assert.equal((value.prepare(`SELECT COUNT(*) AS count FROM assessment_papers`).get() as { count: number }).count, 1);
});

test('keeps a submitted paper review readable after its generated paper is retired', () => {
  const value = database();
  const { task } = createLearningTask(value, {
    ownerId: 'child_1', requestKey: 'paper-with-snapshot', taskType: 'assessment', sourceType: 'chapter', subject: '数学', grade: '四年级',
    title: '大数的认识·模拟考试', bookId: 'book-1', chapterIds: ['c1'],
  }, 1000);
  updateLearningTaskGenerationStatus(value, task.id, 'running', { now: 1001 });
  value.prepare(`INSERT INTO assessment_blueprints (id, ownerId, bookId, chapterIdsJson, examType, difficulty, sectionsJson, styleProfileId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('blueprint-2', 'child_1', 'book-1', '["c1"]', 'unit', 'standard', '[]', null, 1001);
  value.prepare(`INSERT INTO assessment_papers VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('paper-2', 'blueprint-2', 'child_1', 1, '{}', 100, 'completed', 1001);
  completeLearningTask(value, task.id, [{ entityType: 'assessment_paper', entityId: 'paper-2', role: 'paper' }], 1002);
  const snapshot = JSON.stringify([{ questionId: 'q1', type: 'choice', question: '1 + 1 = ?', studentAnswer: '2', referenceAnswer: '2', explanation: '基础计算。', needsReinforcement: false }]);
  value.prepare(`INSERT INTO paper_attempts (id, paperId, ownerId, answersJson, reviewSnapshotJson, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 'submitted', ?, ?)`).run('attempt-2', 'paper-2', 'child_1', '{"q1":"2"}', snapshot, 1003, 1003);
  retireGeneratedLearningMaterial(value, task.id, 'child_1');
  assert.deepEqual(getPaperAttemptReview(value, 'attempt-2', 'child_1')?.items.map(item => item.questionId), ['q1']);
});
