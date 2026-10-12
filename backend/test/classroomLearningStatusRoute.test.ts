import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

test('API roundtrip projects listening, paper and course progress and preserves submitted answers', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'twinkle-learning-status-'));
  process.env.DATA_DIR = dataDir;
  for (const flag of ['LEARNING_TASKS_ENABLED', 'LEARNING_PACKAGES_ENABLED', 'LEARNING_ATTEMPTS_ENABLED']) process.env[flag] = 'true';
  const [database, tasks, classroom, packages, attempts, taskService] = await Promise.all([
    import('../src/services/databaseService.js'), import('../src/routes/learningTasks.js'),
    import('../src/routes/classroom.js'), import('../src/routes/learningPackages.js'),
    import('../src/routes/paperAttempts.js'), import('../src/services/learningTaskService.js'),
  ]);
  database.initDatabase();
  const db = database.default;
  const app = express();
  app.use(express.json());
  for (const router of [tasks.default, classroom.default, packages.default, attempts.default]) app.use('/api', router);
  const server = app.listen(0);
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  const call = async (url: string, method = 'GET', body?: unknown, status = 200) => {
    const response = await fetch(`${base}${url}`, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const value = await response.json() as any;
    assert.equal(response.status, status, JSON.stringify(value));
    return value.data;
  };
  const ready = (taskType: string, links: Parameters<typeof taskService.completeLearningTask>[2]) => {
    const { task } = taskService.createLearningTask(db, {
      ownerId: 'child_1', requestKey: taskType, taskType, sourceType: 'chapter', subject: '英语',
      grade: '四年级', title: taskType, bookId: 'book', chapterIds: ['c1'],
    });
    taskService.updateLearningTaskGenerationStatus(db, task.id, 'running');
    taskService.completeLearningTask(db, task.id, links);
    return task.id;
  };
  const detail = (id: string) => call(`/learning-tasks/${encodeURIComponent(id)}?ownerId=child_1`);
  try {
    const question = { id: 'q1', type: 'choice', question: 'Who is speaking?', options: ['Mia', 'Tom'], answer: 'Mia', explanation: 'Mia introduces herself.' };
    const listening = { listening: { script: 'Hello, I am Mia.', questions: [{ ...question, prompt: question.question, rubricPoints: ['识别人物'] }] } };
    db.prepare(`INSERT INTO learning_packages VALUES ('package', 'child_1', 'book', '["c1"]', 'english-listening', ?, 'completed', 1, 1, 1)`).run(JSON.stringify(listening));
    const listeningId = ready('english_listening', [{ entityType: 'learning_package', entityId: 'package', role: 'primary' }]);
    assert.equal((await detail(listeningId)).learningStatus, 'not_started');
    await call('/learning-packages/package/playback', 'POST', { ownerId: 'child_1', event: 'completed' });
    assert.equal((await detail(listeningId)).learningStatus, 'in_progress');
    await call('/learning-packages/package/playback', 'POST', { ownerId: 'child_1', event: 'submit', answers: { q1: 'Tom' } });
    const snapshot = db.prepare('SELECT * FROM learning_package_progress').all();
    assert.equal((await detail(listeningId)).learningStatus, 'completed');
    assert.equal((await detail('legacy:learning_package:package')).learningStatus, 'completed');
    assert.equal((await call('/learning-packages/package?ownerId=child_1')).playback.answers.q1, 'Tom');
    await call('/learning-packages/package?ownerId=child_2', 'GET', undefined, 404);
    assert.deepEqual(db.prepare('SELECT * FROM learning_package_progress').all(), snapshot);

    db.exec(`INSERT INTO assessment_blueprints (id, ownerId, bookId, chapterIdsJson, examType, difficulty, sectionsJson, createdAt) VALUES ('bp', 'child_1', 'book', '["c1"]', 'unit', 'standard', '[]', 1)`);
    db.prepare(`INSERT INTO assessment_papers VALUES ('paper', 'bp', 'child_1', 1, ?, 100, 'completed', 1)`).run(JSON.stringify({ sections: [{ questions: [question] }] }));
    const paperId = ready('assessment', [{ entityType: 'assessment_paper', entityId: 'paper', role: 'paper' }]);
    const attempt = await call('/paper-attempts', 'POST', { ownerId: 'child_1', paperId: 'paper' }, 201);
    assert.equal((await detail(paperId)).learningStatus, 'in_progress');
    await call(`/paper-attempts/${attempt.id}`, 'PATCH', { ownerId: 'child_1', action: 'submit', answers: { q1: 'Tom' } });
    const attemptsBefore = db.prepare('SELECT * FROM paper_attempts').all();
    for (let n = 0; n < 2; n++) {
      const completed = await detail(paperId);
      assert.equal(completed.learningStatus, 'completed');
      assert.equal(completed.primaryLink.entityType, 'paper_attempt');
      assert.equal(completed.primaryLink.entityId, attempt.id);
      assert.equal((await detail('legacy:assessment_paper:paper')).primaryLink.entityId, attempt.id);
      const review = await call(`/paper-attempts/${attempt.id}/review?ownerId=child_1`);
      assert.equal(review.items[0].studentAnswer, 'Tom');
      assert.equal(review.items[0].referenceAnswer, 'Mia');
    }
    await call(`/paper-attempts/${attempt.id}/review?ownerId=child_2`, 'GET', undefined, 404);
    assert.deepEqual(db.prepare('SELECT * FROM paper_attempts').all(), attemptsBefore, 'reading submitted history must not create a new draft');

    db.prepare(`INSERT INTO classroom_items (id, type, bookTitle, chapter, subject, ownerId, contentJson, createdAt) VALUES ('course', 'courseware', '英语四上', '第一章', '英语', 'child_1', '[]', 1)`).run();
    db.prepare(`INSERT INTO classroom_items (id, type, bookTitle, chapter, subject, ownerId, contentJson, createdAt) VALUES ('quiz', 'quiz', '英语四上', '第一章', '英语', 'child_1', ?, 1)`).run(JSON.stringify([question]));
    const courseId = ready('courseware', [
      { entityType: 'classroom_courseware', entityId: 'course', role: 'primary' },
      { entityType: 'classroom_quiz', entityId: 'quiz', role: 'practice' },
    ]);
    await call('/classroom/course/mark-studied', 'POST', { ownerId: 'child_1' });
    assert.equal((await detail(courseId)).learningStatus, 'in_progress');
    await call('/quiz-result/start', 'POST', { quizId: 'quiz', ownerId: 'child_1', questions: [question], answers: { q1: 'Tom' }, bookTitle: '英语四上', chapter: '第一章', subject: '英语' });
    const result = db.prepare(`SELECT id, resultsJson FROM quiz_results WHERE quizId = 'quiz'`).get() as { id: string; resultsJson: string };
    assert.ok(result);
    const completedCourse = await detail(courseId);
    assert.equal(completedCourse.learningStatus, 'completed');
    assert.equal(completedCourse.primaryLink.entityId, 'course');
    assert.ok(completedCourse.links.some((link: any) => link.entityType === 'quiz_result' && link.entityId === result.id));
    const review = await call(`/quiz-results/${result.id}?ownerId=child_1`);
    assert.equal(review.items[0].studentAnswer, 'Tom');
    assert.equal((db.prepare('SELECT resultsJson FROM quiz_results WHERE id = ?').get(result.id) as any).resultsJson, result.resultsJson);
    const index = await call('/learning-tasks?ownerId=child_1&limit=100');
    for (const id of [listeningId, paperId, courseId]) assert.equal(index.items.find((item: any) => item.id === id).learningStatus, 'completed');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
