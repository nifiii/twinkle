import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

test('source-paper public API roundtrip: accepted requests, owner context, review, completion and deletion preserve source', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'twinkle-source-http-'));
  process.env.DATA_DIR = directory;
  for (const key of ['TASKS', 'ASSESSMENTS', 'ATTEMPTS', 'EXPORTS']) process.env[`LEARNING_${key}_ENABLED`] = 'true';
  const [{ default: db, initDatabase }, { default: router }, { default: papers }, { default: attempts }, service] = await Promise.all([
    import('../src/services/databaseService.js'), import('../src/routes/learningTasks.js'), import('../src/routes/assessmentPapers.js'), import('../src/routes/paperAttempts.js'), import('../src/services/sourcePaperPracticeService.js'),
  ]);
  initDatabase();
  const mdPath = path.join(directory, 'synthetic.md'); await writeFile(mdPath, '完整合成英语试卷材料。'.repeat(30));
  db.prepare("UPDATE users SET baseGrade=4,baseGradeSetAt=? WHERE id='child_1'").run(new Date().toISOString().slice(0, 7));
  db.prepare("INSERT INTO books (id,title,ownerId,subject,category,status,mdPath,tags) VALUES ('source','合成试卷','shared','英语','试卷','completed',?,'[]')").run(mdPath);
  const app = express(); app.use(express.json()); app.use('/api', router); app.use('/api', papers); app.use('/api', attempts);
  const server = app.listen(0); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  const call = async (url: string, body?: any, method = 'POST') => {
    const response = await fetch(base + url, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    return { status: response.status, ...(await response.json() as any) };
  };
  try {
    assert.equal((await call('/assistant/source-papers')).status, 400);
    assert.equal((await call('/assistant/source-papers?ownerId=child_1')).data[0].id, 'source');
    assert.equal((await call('/assistant/source-paper-analyses?ownerId=child_1&requestKey=unknown')).status, 404);
    const accepted = await call('/assistant/source-paper-analyses', { ownerId: 'child_1', bookId: 'source', requestKey: 'http-analysis' });
    assert.equal(accepted.status, 202); assert.ok(accepted.data.id);
    assert.equal((await call(`/assistant/source-paper-analyses/${accepted.data.id}?ownerId=child_2`)).status, 404);
    // Deterministic provider only; the real route, service validation and SQL remain in use.
    const jobs: Array<() => Promise<void>> = [];
    const dependencies = { database: db, schedule: (work: () => Promise<void>) => jobs.push(work), model: async (prompt: string) => prompt.startsWith('分析') ? { scope: 'full', coveredThroughEnd: true, gradeAppropriate: true, knowledgePoints: ['句意理解'], issues: [], sections: [{ title: '阅读选择', questionKind: '阅读选择', responseType: 'choice', questionCount: 1, groupCount: 1, requiresMaterial: true }] } : { questions: [{ stem: 'Where does Ann read?', material: 'Ann reads books in her small garden. Her brother enjoys watering the flowers there every afternoon.', groupId: 'g1', options: ['A. In the garden.', 'B. At the station.'], answer: 'A. In the garden.', explanation: '材料第一句说明了阅读地点。' }] } };
    const analysis = await service.requestSourcePaperAnalysis({ ownerId: 'child_1', bookId: 'source', requestKey: 'happy' }, dependencies); await jobs.shift()!();
    const task = await service.createSourcePaperTask({ ownerId: 'child_1', requestKey: 'happy-task', taskType: 'assessment', source: { kind: 'source_paper', analysisId: analysis.id, counts: [1] } }, dependencies); await jobs.shift()!();
    const acceptedAgain = await call('/learning-tasks', { ownerId: 'child_1', requestKey: 'happy-task', taskType: 'assessment', source: { kind: 'source_paper', analysisId: analysis.id, counts: [1] } });
    assert.equal(acceptedAgain.status, 202); assert.equal(acceptedAgain.data.id, task.id);
    const detail = (await call(`/learning-tasks/${task.id}?ownerId=child_1`)).data;
    assert.equal(detail.sourceSnapshot.sourceType, 'source_paper'); assert.equal(detail.generationStatus, 'ready');
    const paperId = detail.primaryLink.entityId;
    assert.equal((await call(`/assessment-papers/${paperId}?ownerId=child_2`)).status, 404);
    const attempt = (await call('/paper-attempts', { ownerId: 'child_1', paperId })).data;
    assert.equal((await call(`/paper-attempts/${attempt.id}`, { ownerId: 'child_1', action: 'submit', answers: { 's1-q1': 'B. At the station.' } }, 'PATCH')).status, 200);
    const review = (await call(`/paper-attempts/${attempt.id}/review?ownerId=child_1`)).data;
    assert.equal(review.items[0].options.length, 2); assert.match(review.items[0].material, /Ann reads/); assert.equal(review.items[0].studentAnswer, 'B. At the station.');
    const completed = (await call(`/learning-tasks/${task.id}?ownerId=child_1`)).data;
    assert.equal(completed.learningStatus, 'completed'); assert.equal(completed.primaryLink.entityType, 'paper_attempt');
    assert.equal((await call(`/generated-learning-materials/${task.id}`, { ownerId: 'child_1' }, 'DELETE')).status, 200);
    assert.equal((await call(`/learning-tasks/${task.id}?ownerId=child_1`)).status, 410);
    assert.equal((await call('/assistant/source-papers?ownerId=child_1')).data.length, 1);
    assert.equal((await call(`/paper-attempts/${attempt.id}/review?ownerId=child_1`)).data.items[0].material, review.items[0].material);
    assert.equal((await call(`/assistant/source-paper-analyses/${analysis.id}?ownerId=child_1`)).data.taskRetired, true);
  } finally { server.close(); db.close(); await rm(directory, { recursive: true, force: true }); }
});
