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
    JSON.stringify([{ id: 1, title: '第一单元 大数的认识' }]),
  );
  database.prepare(`INSERT INTO classroom_items VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    'classroom-1', 'courseware', '义务教育教科书·数学四年级上册', '第一单元 大数的认识', '数学', 'child_1', 1000,
  );
  database.prepare(`INSERT INTO learning_packages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'package-1', 'child_1', 'book-1', JSON.stringify(['1']), 'math-thinking', '{}', 'completed', 1, 1100, 1200,
  );
  database.prepare(`INSERT INTO assessment_blueprints (id, ownerId, bookId, chapterIdsJson, examType, difficulty, sectionsJson, styleProfileId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'blueprint-1', 'child_1', 'book-1', JSON.stringify(['1']), 'unit', 'standard', '[]', null, 1300,
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
    subject: '数学', grade: '四年级', title: '第一单元·课件', bookId: 'book-1', chapterIds: ['1'],
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

test('hides legacy rows once their entities are linked to a unified task', () => {
  const database = createDatabase();
  seedLegacyContent(database);
  const { task } = createLearningTask(database, {
    ownerId: 'child_1', requestKey: 'linked-legacy', taskType: 'courseware', sourceType: 'chapter',
    subject: '数学', grade: '四年级', title: '第一单元·学生自学课件', bookId: 'book-1', chapterIds: ['1'],
  }, 1500);
  updateLearningTaskGenerationStatus(database, task.id, 'running', { now: 1600 });
  completeLearningTask(database, task.id, [
    { entityType: 'classroom_courseware', entityId: 'classroom-1', role: 'primary' },
    { entityType: 'learning_package', entityId: 'package-1', role: 'resource' },
  ], 1700);

  const items = listClassroomTasks(database, 'child_1').items;
  assert.equal(items.filter(item => item.primaryLink?.entityId === 'classroom-1').length, 1);
  assert.equal(items.filter(item => item.primaryLink?.entityId === 'package-1').length, 0);
});

test('changes generation stuck beyond five minutes into a retryable failure', () => {
  const database = createDatabase();
  const now = Date.now();
  const { task } = createLearningTask(database, {
    ownerId: 'child_1', requestKey: 'stale-running', taskType: 'math_thinking', sourceType: 'chapter',
    subject: '数学', grade: '四年级', title: '大数的认识·思维训练', bookId: 'book-1', chapterIds: ['1'],
  }, now - 6 * 60_000);
  updateLearningTaskGenerationStatus(database, task.id, 'running', { now: now - 6 * 60_000 });

  const item = listClassroomTasks(database, 'child_1').items.find(value => value.id === task.id);
  assert.equal(item?.generationStatus, 'failed');
  assert.equal(getClassroomTask(database, task.id, 'child_1')?.errorCode, 'generation_timeout');
});

test('hides failed source-paper tasks that have no classroom content', () => {
  const database = createDatabase();
  const { task } = createLearningTask(database, {
    ownerId: 'child_1', requestKey: 'failed-source-paper', taskType: 'assessment', sourceType: 'source_paper',
    subject: '英语', grade: '小学四年级', title: '小学四年级英语原创测试', bookId: 'book-1', chapterIds: [],
  }, 2000);
  assert.equal(listClassroomTasks(database, 'child_1', { subject: '英语', taskType: 'assessment' }).items.some(item => item.id === task.id), true);
  updateLearningTaskGenerationStatus(database, task.id, 'running', { now: 2100 });
  updateLearningTaskGenerationStatus(database, task.id, 'failed', { now: 2200, errorCode: 'source_incomplete', errorMessage: '母卷视觉材料不完整' });

  assert.equal(listClassroomTasks(database, 'child_1', { subject: '英语', taskType: 'assessment' }).items.some(item => item.id === task.id), false);
  assert.equal(getClassroomTask(database, task.id, 'child_1')?.generationStatus, 'failed');
  database.close();
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

test('submitted quiz records are ready completed history without changing their stored status', () => {
  const database = createDatabase();
  database.exec(`CREATE TABLE quiz_results (id TEXT PRIMARY KEY, quizId TEXT, bookTitle TEXT, chapter TEXT, subject TEXT, ownerId TEXT, status TEXT, createdAt INTEGER)`);
  for (const status of ['submitted', 'completed', 'grading', 'failed']) {
    database.prepare(`INSERT INTO quiz_results VALUES (?, 'quiz-1', '数学四上', '公顷和平方千米', '数学', 'child_1', ?, 2000)`).run(status, status);
  }
  const results = listClassroomTasks(database, 'child_1', { taskType: 'quiz_result' }).items;
  for (const status of ['submitted', 'completed']) {
    const result = results.find(item => item.id === `legacy:quiz_result:${status}`)!;
    assert.equal(result.generationStatus, 'ready');
    assert.equal(result.learningStatus, 'completed');
    assert.equal(getClassroomTask(database, result.id, 'child_1')?.generationStatus, 'ready');
    assert.equal(getClassroomTask(database, result.id, 'child_2'), null);
  }
  for (const status of ['grading', 'failed']) {
    assert.notEqual(results.find(item => item.id === `legacy:quiz_result:${status}`)?.learningStatus, 'completed');
  }
  assert.equal((database.prepare(`SELECT status FROM quiz_results WHERE id = 'submitted'`).get() as { status: string }).status, 'submitted');
  database.close();
});

test('completed quiz tasks project an owned review link even when a previous submission removed the quiz', () => {
  const database = createDatabase();
  database.exec(`CREATE TABLE quiz_results (id TEXT PRIMARY KEY, quizId TEXT, bookTitle TEXT, chapter TEXT, subject TEXT, ownerId TEXT, status TEXT, createdAt INTEGER)`);
  const { task } = createLearningTask(database, {
    ownerId: 'child_1', requestKey: 'finished-thinking', taskType: 'math_thinking', sourceType: 'chapter',
    subject: '数学', grade: '四年级', title: '公顷和平方千米·思维训练', bookId: 'book-1', chapterIds: ['1'],
  }, 1000);
  updateLearningTaskGenerationStatus(database, task.id, 'running', { now: 1100 });
  completeLearningTask(database, task.id, [{ entityType: 'classroom_quiz', entityId: 'missing-quiz', role: 'primary' }], 1200);
  // Another student's newer result must not unlock or replace this student's task.
  database.prepare(`INSERT INTO quiz_results VALUES ('other-result', 'missing-quiz', '数学四上', '公顷和平方千米', '数学', 'child_2', 'submitted', 3000)`).run();
  assert.equal(getClassroomTask(database, task.id, 'child_1')?.learningStatus, 'not_started');
  database.prepare(`INSERT INTO quiz_results VALUES ('own-result', 'missing-quiz', '数学四上', '公顷和平方千米', '数学', 'child_1', 'submitted', 2000)`).run();
  const detail = getClassroomTask(database, task.id, 'child_1')!;
  assert.equal(detail.learningStatus, 'completed');
  assert.equal(detail.primaryLink?.entityType, 'quiz_result');
  assert.equal(detail.primaryLink?.entityId, 'own-result');
  assert.ok(detail.links.some(link => link.entityType === 'quiz_result' && link.entityId === 'own-result'));
  assert.equal(learningTaskTargetExists(database, 'child_1', detail.primaryLink!), true);
  assert.equal(listClassroomTasks(database, 'child_1').items.find(item => item.id === task.id)?.learningStatus, 'completed');
  assert.equal(listClassroomTasks(database, 'child_1').items.filter(item => item.primaryLink?.entityId === 'own-result').length, 1, 'review adopted by its original task appears once');
  assert.equal((database.prepare('SELECT learningStatus FROM learning_tasks WHERE id = ?').get(task.id) as { learningStatus: string }).learningStatus, 'not_started');
  assert.equal((database.prepare('SELECT entityType FROM learning_task_links WHERE taskId = ?').get(task.id) as { entityType: string }).entityType, 'classroom_quiz');
  database.close();
});

test('a standalone completed quiz remains reviewable without a duplicate pending quiz or history entry', () => {
  const database = createDatabase();
  database.exec(`CREATE TABLE quiz_results (id TEXT PRIMARY KEY, quizId TEXT, bookTitle TEXT, chapter TEXT, subject TEXT, ownerId TEXT, status TEXT, createdAt INTEGER)`);
  database.prepare(`INSERT INTO classroom_items VALUES ('standalone-quiz', 'quiz', '数学四上', '公顷和平方千米', '数学', 'child_1', 1000)`).run();
  database.prepare(`INSERT INTO quiz_results VALUES ('standalone-result', 'standalone-quiz', '数学四上', '公顷和平方千米', '数学', 'child_1', 'submitted', 2000)`).run();
  const page = listClassroomTasks(database, 'child_1');
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].learningStatus, 'completed');
  assert.equal(page.items[0].primaryLink?.entityId, 'standalone-result');
  assert.equal(getClassroomTask(database, 'legacy:classroom_quiz:standalone-quiz', 'child_1')?.primaryLink?.entityType, 'quiz_result');
  assert.equal(getClassroomTask(database, 'legacy:quiz_result:standalone-result', 'child_1')?.learningStatus, 'completed', 'previous history links stay valid');
  database.close();
});

test('courseware retains its reader while its completed practice remains accessible as history', () => {
  const database = createDatabase();
  seedLegacyContent(database);
  database.exec(`CREATE TABLE quiz_results (id TEXT PRIMARY KEY, quizId TEXT, bookTitle TEXT, chapter TEXT, subject TEXT, ownerId TEXT, status TEXT, createdAt INTEGER)`);
  database.prepare(`INSERT INTO classroom_items VALUES ('practice-quiz', 'quiz', '数学四上', '第一单元', '数学', 'child_1', 1000)`).run();
  database.prepare(`INSERT INTO quiz_results VALUES ('practice-result', 'practice-quiz', '数学四上', '第一单元', '数学', 'child_1', 'submitted', 2000)`).run();
  const { task } = createLearningTask(database, {
    ownerId: 'child_1', requestKey: 'courseware-practice', taskType: 'courseware', sourceType: 'chapter',
    subject: '数学', grade: '四年级', title: '第一单元·课件', bookId: 'book-1', chapterIds: ['1'],
  }, 1000);
  updateLearningTaskGenerationStatus(database, task.id, 'running', { now: 1100 });
  completeLearningTask(database, task.id, [
    { entityType: 'classroom_courseware', entityId: 'classroom-1', role: 'primary' },
    { entityType: 'classroom_quiz', entityId: 'practice-quiz', role: 'practice' },
  ], 1200);
  const items = listClassroomTasks(database, 'child_1').items;
  assert.equal(items.find(item => item.id === task.id)?.learningStatus, 'completed');
  assert.equal(items.find(item => item.id === task.id)?.primaryLink?.entityType, 'classroom_courseware');
  assert.equal(items.filter(item => item.taskType === 'classroom_quiz').length, 0, 'practice does not duplicate its parent task');
  assert.equal(items.find(item => item.id === 'legacy:quiz_result:practice-result')?.primaryLink?.entityType, 'quiz_result', 'courseware practice history still has an entry');
  database.close();
});

test('returns task source, links, and events without embedding original content', () => {
  const database = createDatabase();
  seedLegacyContent(database);
  const { task } = createLearningTask(database, {
    ownerId: 'child_1', requestKey: 'task-2', taskType: 'courseware', sourceType: 'chapter',
    subject: '数学', grade: '四年级', title: '第一单元·课件', bookId: 'book-1', chapterIds: ['1'],
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

test('preserves historical video task records without exposing playback data', () => {
  const database = createDatabase();
  seedLegacyContent(database);
  database.prepare(`INSERT INTO external_resources
    (id, title, subject, grade, knowledgeTagsJson, url, sourceName, durationSeconds, ageLabel, reviewedAt, status, linkHealthStatus, embedStatus, embedUrl, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('video-1', '大数的认识动画', '数学', '四年级', '[]', 'https://video.example/watch', '示例平台', 120, '适合四年级', 1000, 'approved', 'healthy', 'allowed', 'https://video.example/embed/1', 1000, 1000);
  const { task } = createLearningTask(database, {
    ownerId: 'child_1', requestKey: 'video-task', taskType: 'video', sourceType: 'chapter',
    subject: '数学', grade: '四年级', title: '第一单元·视频', bookId: 'book-1', chapterIds: ['1'],
  }, 1500);
  updateLearningTaskGenerationStatus(database, task.id, 'running', { now: 1550 });
  completeLearningTask(database, task.id, [{ entityType: 'external_resource', entityId: 'video-1', role: 'resource' }], 1600);

  const detail = getClassroomTask(database, task.id, 'child_1');

  assert.equal(detail?.generationStatus, 'ready');
  assert.equal(detail?.errorCode, 'video_discontinued');
  assert.match(String(detail?.errorMessage), /视频学习已取消/);
  assert.equal(detail?.videoResource, null);
  assert.equal(learningTaskTargetExists(database, 'child_1', detail!.primaryLink!), false);
});
