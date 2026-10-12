import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initLearningDomainDatabase } from '../src/services/learningDomain.js';
import { completeLearningTask, createLearningTask, updateLearningTaskGenerationStatus } from '../src/services/learningTaskService.js';
import { getClassroomTask, learningTaskTargetExists, listClassroomTasks } from '../src/services/classroomTaskQueryService.js';
import { listGeneratedLearningMaterials } from '../src/services/generatedLearningMaterialService.js';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT, subject TEXT, grade TEXT, ownerId TEXT, tableOfContents TEXT);
    CREATE TABLE classroom_items (id TEXT PRIMARY KEY, type TEXT, bookTitle TEXT, chapter TEXT, subject TEXT, ownerId TEXT, createdAt INTEGER, lastStudiedAt INTEGER);
    CREATE TABLE quiz_results (id TEXT PRIMARY KEY, quizId TEXT, bookTitle TEXT, chapter TEXT, subject TEXT, ownerId TEXT, status TEXT, createdAt INTEGER);
  `);
  initLearningDomainDatabase(db);
  db.exec(`
    INSERT INTO books VALUES ('book', '四年级教材', '英语', '四年级', 'shared', '[]');
    INSERT INTO learning_packages VALUES ('package', 'child_1', 'book', '[]', 'english-listening', '{}', 'completed', 1, 1, 1);
    INSERT INTO classroom_items VALUES ('course', 'courseware', '四年级教材', '第一章', '英语', 'child_1', 1, NULL);
    INSERT INTO classroom_items VALUES ('quiz', 'quiz', '四年级教材', '第一章', '英语', 'child_1', 1, NULL);
    INSERT INTO assessment_blueprints (id, ownerId, bookId, chapterIdsJson, examType, difficulty, sectionsJson, createdAt)
      VALUES ('blueprint', 'child_1', 'book', '[]', 'unit', 'standard', '[]', 1);
    INSERT INTO assessment_papers VALUES ('paper', 'blueprint', 'child_1', 1, '{}', 100, 'completed', 1);
  `);
  return db;
}

function ready(db: Database.Database, taskType: string, links: Array<{ entityType: string; entityId: string; role: 'primary' | 'practice' | 'explanation' | 'paper' }>) {
  const { task } = createLearningTask(db, {
    ownerId: 'child_1', requestKey: taskType, taskType, sourceType: 'chapter',
    subject: '英语', grade: '四年级', title: taskType, bookId: 'book', chapterIds: ['c1'],
  }, 1000);
  updateLearningTaskGenerationStatus(db, task.id, 'running', { now: 1001 });
  completeLearningTask(db, task.id, links, 1002);
  return task.id;
}

test('listening progress distinguishes untouched, played and submitted in current and legacy indexes without writes', () => {
  const db = fixture();
  try {
    const legacyId = 'legacy:learning_package:package';
    assert.equal(getClassroomTask(db, legacyId, 'child_1')?.learningStatus, 'not_started');
    db.exec(`INSERT INTO learning_package_progress VALUES ('child_2', 'package', 1, 1, 2, '{"q1":"other"}', 2)`);
    assert.equal(getClassroomTask(db, legacyId, 'child_1')?.learningStatus, 'not_started');
    db.exec(`INSERT INTO learning_package_progress VALUES ('child_1', 'package', 6, 1, NULL, NULL, 2)`);
    assert.equal(getClassroomTask(db, legacyId, 'child_1')?.learningStatus, 'in_progress');
    const taskId = ready(db, 'english_listening', [{ entityType: 'learning_package', entityId: 'package', role: 'primary' }]);
    assert.equal(getClassroomTask(db, taskId, 'child_1')?.learningStatus, 'in_progress');
    db.exec(`UPDATE learning_package_progress SET submittedAt = 3, answersJson = '{"q1":"original"}' WHERE ownerId = 'child_1'`);
    const before = db.prepare('SELECT * FROM learning_package_progress').all();
    const links = db.prepare('SELECT * FROM learning_task_links').all();
    for (let n = 0; n < 2; n++) {
      assert.equal(getClassroomTask(db, legacyId, 'child_1')?.learningStatus, 'completed');
      assert.equal(getClassroomTask(db, taskId, 'child_1')?.learningStatus, 'completed');
      assert.equal(listClassroomTasks(db, 'child_1').items.find(x => x.id === taskId)?.learningStatus, 'completed');
      assert.equal(listGeneratedLearningMaterials(db, 'child_1', { progress: 'completed' }).items[0]?.taskId, taskId);
      assert.equal(listGeneratedLearningMaterials(db, 'child_1', { progress: 'pending' }).items.length, 0);
    }
    assert.deepEqual(db.prepare('SELECT * FROM learning_package_progress').all(), before);
    assert.deepEqual(db.prepare('SELECT * FROM learning_task_links').all(), links);
    assert.equal((db.prepare('SELECT learningStatus FROM learning_tasks WHERE id = ?').get(taskId) as any).learningStatus, 'not_started');
    assert.equal(getClassroomTask(db, taskId, 'child_2'), null);
  } finally { db.close(); }
});

test('papers project the latest owned submitted attempt while a draft is only in progress', () => {
  const db = fixture();
  try {
    const legacyId = 'legacy:assessment_paper:paper';
    const taskId = ready(db, 'assessment', [{ entityType: 'assessment_paper', entityId: 'paper', role: 'paper' }]);
    db.exec(`INSERT INTO paper_attempts (id, paperId, ownerId, answersJson, status, createdAt, updatedAt) VALUES ('other', 'paper', 'child_2', '{}', 'submitted', 10, 10)`);
    assert.equal(getClassroomTask(db, taskId, 'child_1')?.learningStatus, 'not_started');
    db.exec(`INSERT INTO paper_attempts (id, paperId, ownerId, answersJson, status, createdAt, updatedAt) VALUES ('own', 'paper', 'child_1', '{"q1":"mine"}', 'draft', 2, 2)`);
    assert.equal(getClassroomTask(db, taskId, 'child_1')?.learningStatus, 'in_progress');
    assert.equal(getClassroomTask(db, legacyId, 'child_1')?.learningStatus, 'in_progress');
    db.exec(`UPDATE paper_attempts SET status = 'submitted' WHERE id = 'own'`);
    const before = db.prepare('SELECT * FROM paper_attempts').all();
    for (const id of [taskId, legacyId]) {
      const detail = getClassroomTask(db, id, 'child_1')!;
      assert.equal(detail.learningStatus, 'completed');
      assert.equal(detail.primaryLink?.entityType, 'paper_attempt');
      assert.equal(detail.primaryLink?.entityId, 'own');
      assert.ok(detail.links.some(x => x.entityType === 'paper_attempt' && x.entityId === 'own'));
      assert.equal(learningTaskTargetExists(db, 'child_1', detail.primaryLink!), true);
      assert.equal(learningTaskTargetExists(db, 'child_2', detail.primaryLink!), false);
    }
    assert.equal(listGeneratedLearningMaterials(db, 'child_1', { progress: 'completed' }).items[0]?.taskId, taskId);
    assert.deepEqual(db.prepare('SELECT * FROM paper_attempts').all(), before);
  } finally { db.close(); }
});

for (const taskType of ['courseware', 'wrong_review', 'math_thinking']) {
  test(`${taskType} reading is not completion; an owned submitted practice completes and exposes history`, () => {
    const db = fixture();
    try {
      const taskId = ready(db, taskType, [
        { entityType: 'classroom_courseware', entityId: 'course', role: 'primary' },
        { entityType: 'classroom_quiz', entityId: 'quiz', role: 'practice' },
      ]);
      db.exec(`UPDATE classroom_items SET lastStudiedAt = 4 WHERE id = 'course'`);
      assert.equal(getClassroomTask(db, taskId, 'child_1')?.learningStatus, 'in_progress');
      assert.equal(getClassroomTask(db, 'legacy:classroom_courseware:course', 'child_1')?.learningStatus, 'in_progress');
      assert.equal(listGeneratedLearningMaterials(db, 'child_1', { progress: 'completed' }).items.length, 0);
      db.exec(`INSERT INTO quiz_results VALUES ('other', 'quiz', '教材', '第一章', '英语', 'child_2', 'submitted', 8)`);
      assert.equal(getClassroomTask(db, taskId, 'child_1')?.learningStatus, 'in_progress');
      db.exec(`INSERT INTO quiz_results VALUES ('own', 'quiz', '教材', '第一章', '英语', 'child_1', 'submitted', 5)`);
      const detail = getClassroomTask(db, taskId, 'child_1')!;
      assert.equal(detail.learningStatus, 'completed');
      assert.equal(detail.primaryLink?.entityType, 'classroom_courseware');
      assert.ok(detail.links.some(x => x.entityType === 'quiz_result' && x.entityId === 'own'));
      assert.equal(listGeneratedLearningMaterials(db, 'child_1', { progress: 'completed' }).items[0]?.taskId, taskId);
    } finally { db.close(); }
  });
}

test('failed generation is not hidden by a matching submitted progress record', () => {
  const db = fixture();
  try {
    const taskId = ready(db, 'english_listening', [{ entityType: 'learning_package', entityId: 'package', role: 'primary' }]);
    db.exec(`UPDATE learning_tasks SET generationStatus = 'failed' WHERE id = '${taskId}'`);
    db.exec(`INSERT INTO learning_package_progress VALUES ('child_1', 'package', 1, 1, 2, '{}', 2)`);
    const detail = getClassroomTask(db, taskId, 'child_1')!;
    assert.equal(detail.generationStatus, 'failed');
    assert.equal(detail.learningStatus, 'not_started');
    assert.equal(listGeneratedLearningMaterials(db, 'child_1').items.length, 0);
  } finally { db.close(); }
});
