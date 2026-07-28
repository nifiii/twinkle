import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initLearningDomainDatabase } from '../src/services/learningDomain.js';
import { completeLearningTask, createLearningTask, updateLearningTaskGenerationStatus } from '../src/services/learningTaskService.js';
import { getClassroomTask, learningTaskTargetExists, listClassroomTasks } from '../src/services/classroomTaskQueryService.js';

function createDatabase(): Database.Database {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT NOT NULL, subject TEXT, grade TEXT, ownerId TEXT NOT NULL, tableOfContents TEXT);
    CREATE TABLE classroom_items (id TEXT PRIMARY KEY, type TEXT NOT NULL, bookTitle TEXT NOT NULL, chapter TEXT NOT NULL, subject TEXT NOT NULL, ownerId TEXT NOT NULL, createdAt INTEGER NOT NULL);
  `);
  initLearningDomainDatabase(database);
  return database;
}

function seedLegacyContent(database: Database.Database): void {
  database.prepare(`INSERT INTO books VALUES (?, ?, ?, ?, ?, ?)`).run(
    'book-1', '义务教育教科书·数学四年级上册', '数学', '四年级', 'shared',
    JSON.stringify([{ id: 'chapter-1', title: '第一单元 大数的认识' }]),
  );
  database.prepare(`INSERT INTO classroom_items VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    'classroom-1', 'courseware', '义务教育教科书·数学四年级上册', '第一单元 大数的认识', '数学', 'child_1', 1000,
  );
  database.prepare(`INSERT INTO learning_packages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'package-1', 'child_1', 'book-1', JSON.stringify(['chapter-1']), 'math-thinking', '{}', 'completed', 1, 1100, 1200,
  );
  database.prepare(`INSERT INTO assessment_blueprints (id, ownerId, bookId, chapterIdsJson, examType, difficulty, sectionsJson, styleProfileId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'blueprint-1', 'child_1', 'book-1', JSON.stringify(['chapter-1']), 'unit', 'standard', '[]', null, 1300,
  );
  database.prepare(`INSERT INTO assessment_papers VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'paper-1', 'blueprint-1', 'child_1', 1, '{}', 100, 'completed', 1400,
  );
}

test('unifies current tasks with classroom, package, and paper legacy summaries', () => {
  const database = createDatabase();
  seedLegacyContent(database);
  const { task } = createLearningTask(database, {
    ownerId: 'child_1', requestKey: 'task-1', taskType: 'courseware', sourceType: 'chapter',
    subject: '数学', grade: '四年级', title: '第一单元·课件', bookId: 'book-1', chapterIds: ['chapter-1'],
  }, 1500);
  const result = listClassroomTasks(database, 'child_1', { limit: 2 });

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].id, task.id);
  assert.equal(result.items[0].book?.title, '义务教育教科书·数学四年级上册');
  assert.equal(result.items[0].chapterTitles[0], '第一单元 大数的认识');
  assert.ok(result.nextCursor);
  const secondPage = listClassroomTasks(database, 'child_1', { limit: 2, cursor: result.nextCursor || undefined });
  assert.deepEqual(secondPage.items.map(item => item.source), ['legacy', 'legacy']);
  assert.deepEqual(secondPage.items.map(item => item.taskType), ['math_thinking', 'courseware']);
  assert.equal(listClassroomTasks(database, 'child_1', { subject: '数学', taskType: 'courseware' }).items.length, 2);
});

test('resolves legacy targets read-only and detects removed primary entities', () => {
  const database = createDatabase();
  seedLegacyContent(database);
  const legacy = getClassroomTask(database, 'legacy:learning_package:package-1', 'child_1');
  assert.equal(legacy?.source, 'legacy');
  assert.equal(legacy?.links[0].entityType, 'learning_package');
  assert.equal(learningTaskTargetExists(database, 'child_1', legacy!.links[0]), true);
  database.prepare('DELETE FROM learning_packages WHERE id = ?').run('package-1');
  assert.equal(getClassroomTask(database, 'legacy:learning_package:package-1', 'child_1'), null);
});

test('indexes a historical classroom quiz result and resolves its native detail reference', () => {
  const database = createDatabase();
  database.exec(`CREATE TABLE quiz_results (id TEXT PRIMARY KEY, quizId TEXT, bookTitle TEXT, chapter TEXT, subject TEXT, ownerId TEXT, correctCount INTEGER, total INTEGER, percentage INTEGER, status TEXT, createdAt INTEGER)`);
  database.prepare(`INSERT INTO quiz_results VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('result-1', 'quiz-1', '数学四年级上册', '第一单元', '数学', 'child_1', 8, 10, 80, 'completed', 2000);

  const result = listClassroomTasks(database, 'child_1', { taskType: 'quiz_result' });
  assert.equal(result.items[0]?.id, 'legacy:quiz_result:result-1');
  assert.equal(result.items[0]?.primaryLink?.entityType, 'quiz_result');
  assert.equal(getClassroomTask(database, 'legacy:quiz_result:result-1', 'child_1')?.learningStatus, 'completed');
  assert.equal(learningTaskTargetExists(database, 'child_1', result.items[0]!.primaryLink!), true);
});

test('returns task source, links, and events without embedding original content', () => {
  const database = createDatabase();
  seedLegacyContent(database);
  const { task } = createLearningTask(database, {
    ownerId: 'child_1', requestKey: 'task-2', taskType: 'courseware', sourceType: 'chapter',
    subject: '数学', grade: '四年级', title: '第一单元·课件', bookId: 'book-1', chapterIds: ['chapter-1'],
  }, 1500);
  updateLearningTaskGenerationStatus(database, task.id, 'running', { now: 1600 });
  completeLearningTask(database, task.id, [{ entityType: 'classroom_courseware', entityId: 'classroom-1', role: 'primary' }], 1700);
  const detail = getClassroomTask(database, task.id, 'child_1');

  assert.equal(detail?.sourceSnapshot.sourceType, 'chapter');
  assert.equal(detail?.links.length, 1);
  assert.equal(detail?.events[0].eventType, 'ready');
  database.prepare('DELETE FROM classroom_items WHERE id = ?').run('classroom-1');
  assert.equal(learningTaskTargetExists(database, 'child_1', detail!.primaryLink!), false);
});

test('marks a previously approved video task unavailable when its reviewed resource changes state', () => {
  const database = createDatabase();
  seedLegacyContent(database);
  database.prepare(`INSERT INTO external_resources
    (id, title, subject, grade, knowledgeTagsJson, url, sourceName, durationSeconds, ageLabel, reviewedAt, status, linkHealthStatus, embedStatus, embedUrl, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('video-1', '大数的认识动画', '数学', '四年级', '[]', 'https://video.example/watch', '示例平台', 120, '适合四年级', 1000, 'approved', 'healthy', 'allowed', 'https://video.example/embed/1', 1000, 1000);
  const { task } = createLearningTask(database, {
    ownerId: 'child_1', requestKey: 'video-task', taskType: 'video', sourceType: 'chapter',
    subject: '数学', grade: '四年级', title: '第一单元·视频', bookId: 'book-1', chapterIds: ['chapter-1'],
  }, 1500);
  updateLearningTaskGenerationStatus(database, task.id, 'running', { now: 1550 });
  completeLearningTask(database, task.id, [{ entityType: 'external_resource', entityId: 'video-1', role: 'resource' }], 1600);

  assert.equal(getClassroomTask(database, task.id, 'child_1')?.videoResource?.embedUrl, 'https://video.example/embed/1');
  database.prepare("UPDATE external_resources SET linkHealthStatus = 'blocked' WHERE id = ?").run('video-1');
  const detail = getClassroomTask(database, task.id, 'child_1');

  assert.equal(detail?.generationStatus, 'resource_unavailable');
  assert.equal(detail?.errorCode, 'resource_unavailable');
  assert.equal(detail?.videoResource, null);
  assert.equal(learningTaskTargetExists(database, 'child_1', detail!.primaryLink!), false);
});
