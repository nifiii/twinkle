import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

test('learning task API returns a paged index and stable context and missing-target errors', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'twinkle-learning-tasks-'));
  process.env.DATA_DIR = dataDir;
  process.env.LEARNING_TASKS_ENABLED = 'true';
  const [{ default: db, initDatabase }, { default: router }, { default: classroomRouter }] = await Promise.all([
    import('../src/services/databaseService.js'),
    import('../src/routes/learningTasks.js'),
    import('../src/routes/classroom.js'),
  ]);
  initDatabase();
  db.prepare(`INSERT INTO classroom_items (id, type, bookTitle, chapter, subject, ownerId, contentJson, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'legacy-courseware', 'courseware', '四年级数学', '第一单元', '数学', 'child_1', '[]', 1000,
  );
  db.prepare(`INSERT INTO scanned_items (id, type, subject, ownerId, problemsJson, timestamp) VALUES (?, 'wrong_problem', '数学', 'child_1', ?, ?)`)
    .run('scan-candidate', JSON.stringify([{ content: '36 除以 6 等于多少？', answer: '6', knowledgePoints: ['除法'] }]), 1100);
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  app.use('/api', classroomRouter);
  const server = app.listen(0);
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}/api/learning-tasks`;

  try {
    const list = await fetch(`${baseUrl}?ownerId=child_1&limit=1`);
    const listBody = await list.json() as { success: boolean; data: { items: Array<{ id: string; source: string }>; nextCursor: string | null } };
    assert.equal(list.status, 200);
    assert.equal(listBody.success, true);
    assert.equal(listBody.data.items[0].id, 'legacy:classroom_courseware:legacy-courseware');
    assert.equal(listBody.data.items[0].source, 'legacy');

    const candidates = await fetch(`${baseUrl.replace('/learning-tasks', '/assistant/wrong-problems')}?ownerId=child_1&subject=数学`);
    const candidatesBody = await candidates.json() as { success: boolean; data: Array<{ source: string; scannedItemId?: string }> };
    assert.equal(candidates.status, 200);
    assert.deepEqual(candidatesBody.data, [{ source: 'scanned_item', scannedItemId: 'scan-candidate', problemIndex: 0, subject: '数学', title: '数学错题', contentExcerpt: '36 除以 6 等于多少？', knowledgePoints: ['除法'], createdAt: 1100 }]);

    const wrongBook = await fetch(`${baseUrl.replace('/learning-tasks', '/wrong-book')}?ownerId=child_1&source=scanned_item`);
    assert.equal(wrongBook.status, 200);
    assert.deepEqual((await wrongBook.json() as { data: { items: Array<{ id: string; source: string }> } }).data.items, [{ id: 'scanned_item:scan-candidate:0', source: 'scanned_item', reference: { scannedItemId: 'scan-candidate', problemIndex: 0 }, subject: '数学', contentExcerpt: '36 除以 6 等于多少？', knowledgePoints: ['除法'], createdAt: 1100, detailTarget: { kind: 'scanned_item', id: 'scan-candidate', problemIndex: 0 }, capabilities: { view: true, edit: false, delete: true } }]);

    const olympiadMaterials = await fetch(`${baseUrl.replace('/learning-tasks', '/assistant/olympiad-materials')}?ownerId=child_1`);
    assert.equal(olympiadMaterials.status, 200);
    assert.deepEqual((await olympiadMaterials.json() as { data: unknown[] }).data, []);

    const videoTask = await fetch(baseUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId: 'child_1', requestKey: 'retired-video', taskType: 'video', source: { kind: 'chapter', bookId: 'missing', chapterIds: ['chapter-1'] } }),
    });
    assert.equal(videoTask.status, 400);
    assert.equal((await videoTask.json() as { errorCode: string }).errorCode, 'capability_unavailable');

    const missingContext = await fetch(baseUrl);
    assert.equal(missingContext.status, 400);
    assert.equal((await missingContext.json() as { errorCode: string }).errorCode, 'invalid_context');

    db.prepare('DELETE FROM classroom_items WHERE id = ?').run('legacy-courseware');
    db.prepare(`INSERT INTO retired_learning_content (ownerId, entityType, entityId, retiredAt) VALUES ('child_1', 'classroom_courseware', 'legacy-courseware', 1001)`).run();
    const missingTarget = await fetch(`${baseUrl}/legacy:classroom_courseware:legacy-courseware?ownerId=child_1`);
    assert.equal(missingTarget.status, 410);
    assert.equal((await missingTarget.json() as { errorCode: string }).errorCode, 'learning_content_retired');

    const retiredClassroom = await fetch(`${baseUrl.replace('/learning-tasks', '/classroom/legacy-courseware')}?ownerId=child_1`);
    assert.equal(retiredClassroom.status, 410);
    assert.equal((await retiredClassroom.json() as { errorCode: string }).errorCode, 'learning_content_retired');

    const unknownTask = await fetch(`${baseUrl}/unknown-task?ownerId=child_1`);
    assert.equal(unknownTask.status, 404);
    assert.equal((await unknownTask.json() as { errorCode: string }).errorCode, 'task_not_found');

    const unknownClassroom = await fetch(`${baseUrl.replace('/learning-tasks', '/classroom/unknown-courseware')}?ownerId=child_1`);
    assert.equal(unknownClassroom.status, 404);

    const { completeLearningTask, createLearningTask, updateLearningTaskGenerationStatus } = await import('../src/services/learningTaskService.js');
    const { task } = createLearningTask(db, {
      ownerId: 'child_1', requestKey: 'review-roundtrip', taskType: 'math_thinking', sourceType: 'chapter',
      subject: '数学', grade: '四年级', title: '公顷和平方千米·思维训练', bookId: 'math-book', chapterIds: ['c1'],
    });
    updateLearningTaskGenerationStatus(db, task.id, 'running');
    const questions = [{ id: 'q1', type: 'choice', question: '1 公顷等于多少平方米？', options: ['1000', '10000'], answer: '10000', explanation: '1 公顷等于 10000 平方米。' }];
    db.prepare(`INSERT INTO classroom_items (id, type, bookTitle, chapter, subject, ownerId, contentJson, createdAt) VALUES ('review-quiz', 'quiz', '数学四上', '公顷和平方千米', '数学', 'child_1', ?, 1000)`).run(JSON.stringify(questions));
    completeLearningTask(db, task.id, [{ entityType: 'classroom_quiz', entityId: 'review-quiz', role: 'primary' }]);
    const submission = await fetch(baseUrl.replace('/learning-tasks', '/quiz-result/start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quizId: 'review-quiz', questions, answers: { q1: '1000' }, bookTitle: '数学四上', chapter: '公顷和平方千米', subject: '数学', ownerId: 'child_1', userName: '大宝' }),
    });
    assert.equal(submission.status, 200);
    const submitted = await submission.json() as { id: string; status: string };
    assert.equal(submitted.status, 'submitted');
    assert.ok(db.prepare(`SELECT id FROM classroom_items WHERE id = 'review-quiz'`).get(), 'submitting must not delete generated quiz');
    const snapshot = (db.prepare('SELECT resultsJson FROM quiz_results WHERE id = ?').get(submitted.id) as { resultsJson: string }).resultsJson;
    // Old submissions removed the quiz. Its original task must still open the saved review.
    db.prepare(`DELETE FROM classroom_items WHERE id = 'review-quiz'`).run();
    const taskDetail = await fetch(`${baseUrl}/${task.id}?ownerId=child_1`);
    assert.equal(taskDetail.status, 200);
    const detailBody = await taskDetail.json() as { data: { learningStatus: string; primaryLink: { entityType: string; entityId: string } } };
    assert.equal(detailBody.data.learningStatus, 'completed');
    assert.deepEqual({ entityType: detailBody.data.primaryLink.entityType, entityId: detailBody.data.primaryLink.entityId }, { entityType: 'quiz_result', entityId: submitted.id });
    const history = await fetch(`${baseUrl}/${encodeURIComponent(`legacy:quiz_result:${submitted.id}`)}?ownerId=child_1`);
    assert.equal(history.status, 200);
    const historyBody = await history.json() as { data: { generationStatus: string; learningStatus: string } };
    assert.equal(historyBody.data.generationStatus, 'ready');
    assert.equal(historyBody.data.learningStatus, 'completed');
    for (let read = 0; read < 2; read++) {
      const reviewResponse = await fetch(`${baseUrl.replace('/learning-tasks', `/quiz-results/${submitted.id}`)}?ownerId=child_1`);
      assert.equal(reviewResponse.status, 200);
      const reviewBody = await reviewResponse.json() as { data: { items: Array<{ question: string; studentAnswer: string; referenceAnswer: string; explanation: string }> } };
      assert.equal(reviewBody.data.items[0].studentAnswer, '1000');
      assert.equal(reviewBody.data.items[0].referenceAnswer, '10000');
      assert.equal(reviewBody.data.items[0].question, questions[0].question);
      assert.equal(reviewBody.data.items[0].explanation, questions[0].explanation);
    }
    const otherStudent = await fetch(`${baseUrl.replace('/learning-tasks', `/quiz-results/${submitted.id}`)}?ownerId=child_2`);
    assert.equal(otherStudent.status, 404);
    assert.equal((db.prepare('SELECT resultsJson FROM quiz_results WHERE id = ?').get(submitted.id) as { resultsJson: string }).resultsJson, snapshot);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
