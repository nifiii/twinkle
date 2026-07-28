import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initLearningDomainDatabase } from '../src/services/learningDomain.js';
import {
  completeLearningTask,
  createLearningTask,
  LearningTaskValidationError,
  getLearningTask,
  retryLearningTask,
  updateLearningTaskGenerationStatus,
} from '../src/services/learningTaskService.js';

function createDatabase(): Database.Database {
  const database = new Database(':memory:');
  initLearningDomainDatabase(database);
  return database;
}

test('creates one immutable task for an idempotent chapter request', () => {
  const database = createDatabase();
  const input = {
    ownerId: 'child_1', requestKey: 'request-1', taskType: 'courseware', sourceType: 'chapter',
    subject: '数学', grade: '四年级', title: '大数的认识·课件', bookId: 'book-1', chapterIds: ['chapter-1'],
  };
  const first = createLearningTask(database, input, 1000);
  const repeated = createLearningTask(database, { ...input, title: '不应覆盖' }, 2000);

  assert.equal(first.created, true);
  assert.equal(repeated.created, false);
  assert.equal(repeated.task.id, first.task.id);
  assert.equal(repeated.task.title, '大数的认识·课件');
  assert.equal((database.prepare('SELECT COUNT(*) AS count FROM learning_tasks').get() as { count: number }).count, 1);
  assert.equal((database.prepare('SELECT COUNT(*) AS count FROM learning_task_events').get() as { count: number }).count, 1);
});

test('only completes a running task together with its original entity link', () => {
  const database = createDatabase();
  const { task } = createLearningTask(database, {
    ownerId: 'child_1', requestKey: 'request-2', taskType: 'wrong_review', sourceType: 'wrong_problems',
    subject: '数学', grade: '四年级', title: '小数除法·错题讲解与测验',
    wrongProblemRefs: [{ scannedItemId: 'scan-1', problemIndex: 0 }],
  }, 1000);

  assert.equal(updateLearningTaskGenerationStatus(database, task.id, 'running', { now: 1100 }).generationStatus, 'running');
  const ready = completeLearningTask(database, task.id, [
    { entityType: 'classroom_courseware', entityId: 'courseware-1', role: 'explanation' },
    { entityType: 'classroom_quiz', entityId: 'quiz-1', role: 'practice' },
  ], 1200);

  assert.equal(ready.generationStatus, 'ready');
  assert.equal((database.prepare('SELECT COUNT(*) AS count FROM learning_task_links WHERE taskId = ?').get(task.id) as { count: number }).count, 2);
  assert.throws(
    () => updateLearningTaskGenerationStatus(database, task.id, 'failed'),
    LearningTaskValidationError,
  );
});

test('rejects a task source that mixes textbook chapters and wrong problems', () => {
  const database = createDatabase();
  assert.throws(() => createLearningTask(database, {
    ownerId: 'child_1', requestKey: 'request-3', taskType: 'wrong_review', sourceType: 'wrong_problems',
    subject: '数学', grade: '四年级', title: '无效任务', bookId: 'book-1',
    wrongProblemRefs: [{ scannedItemId: 'scan-1', problemIndex: 0 }],
  }), LearningTaskValidationError);
});

test('retries only an unlinked failed task in the same family profile', () => {
  const database = createDatabase();
  const { task } = createLearningTask(database, {
    ownerId: 'child_1', requestKey: 'request-4', taskType: 'video', sourceType: 'chapter', subject: '科学', grade: '四年级', title: '声音·视频', bookId: 'book-1', chapterIds: ['sound'],
  });
  updateLearningTaskGenerationStatus(database, task.id, 'failed');
  assert.equal(retryLearningTask(database, task.id, 'child_1').generationStatus, 'queued');
  assert.equal((database.prepare(`SELECT eventType FROM learning_task_events WHERE taskId = ? ORDER BY createdAt DESC LIMIT 1`).get(task.id) as { eventType: string }).eventType, 'retry_requested');
  assert.equal(getLearningTask(database, task.id, 'child_2'), null);
});
