import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initLearningDomainDatabase } from '../src/services/learningDomain.js';
import { gradeAttempt, reviewItem } from '../src/services/gradingService.js';

function setup(content: object, answers: Record<string, string>) {
  const database = new Database(':memory:');
  initLearningDomainDatabase(database);
  database.prepare(`INSERT INTO assessment_papers (id, blueprintId, ownerId, schemaVersion, contentJson, totalScore, status, createdAt) VALUES ('paper', 'blueprint', 'child_1', 1, ?, 20, 'ready', ?)`)
    .run(JSON.stringify(content), Date.now());
  database.prepare(`INSERT INTO paper_attempts (id, paperId, ownerId, answersJson, status, createdAt, updatedAt) VALUES ('attempt', 'paper', 'child_1', ?, 'submitted', ?, ?)`)
    .run(JSON.stringify(answers), Date.now(), Date.now());
  return database;
}

test('normalizes equivalent objective answers without accepting substring matches', async () => {
  const database = setup({ sections: [{ questions: [
    { id: 'fill-equivalent', type: 'fill', stem: '计算', answer: 'A×B', score: 4 },
    { id: 'choice', type: 'choice', stem: '选择', answer: 'A. 正确', score: 3 },
    { id: 'not-substring', type: 'fill', stem: '填空', answer: '12', score: 3 },
  ] }] }, { 'fill-equivalent': 'ａ x Ｂ', choice: 'a', 'not-substring': '112' });
  const diagnosis = await gradeAttempt('attempt', 'child_1', { database });
  assert.deepEqual(diagnosis.items.map((item: any) => item.score), [4, 3, 0]);
});

test('keeps process evidence and score when the final result is wrong', async () => {
  const answer = '先列式 8 + 5，再计算得到 12。';
  const database = setup({ sections: [{ questions: [{ id: 'essay', type: 'essay', stem: '计算 8+5', answer: '13', score: 10, rubric: [
    { id: 'process', score: 6, description: '列式并计算', dimension: 'process' },
    { id: 'result', score: 4, description: '结果为13', dimension: 'result' },
  ] }] }] }, { essay: answer });
  const diagnosis = await gradeAttempt('attempt', 'child_1', { database, gradeEssay: async () => ({ confidence: 0.92, points: [
    { id: 'process', earnedScore: 6, evidence: '先列式 8 + 5，再计算', reason: '过程正确' },
    { id: 'result', earnedScore: 0, evidence: '得到 12', reason: '最终计算错误' },
  ] }) });
  assert.equal(diagnosis.items[0].score, 6);
  assert.equal((diagnosis.items[0].evidence as any[])[0].reason, '过程正确');
});

test('marks low-confidence and unsupported essay grading for review', async () => {
  const answer = '我先用分配律计算。';
  const content = { sections: [{ questions: [{ id: 'essay', type: 'essay', stem: '计算', answer: '结果', score: 10, rubric: [
    { id: 'process', score: 5, description: '过程', dimension: 'process' },
    { id: 'result', score: 5, description: '结果', dimension: 'result' },
  ] }] }] };
  const lowConfidence = await gradeAttempt('attempt', 'child_1', { database: setup(content, { essay: answer }), gradeEssay: async () => ({ confidence: 0.5, points: [
    { id: 'process', earnedScore: 5, evidence: '用分配律计算', reason: '同义过程成立' },
    { id: 'result', earnedScore: 0, evidence: '我先', reason: '未给出结果' },
  ] }) });
  assert.equal(lowConfidence.items[0].verdict, 'review');
  const unsupported = await gradeAttempt('attempt', 'child_1', { database: setup(content, { essay: answer }), gradeEssay: async () => ({ confidence: 0.9, points: [
    { id: 'process', earnedScore: 5, evidence: '模型虚构证据', reason: '错误' },
    { id: 'result', earnedScore: 0, evidence: '我先', reason: '未给出结果' },
  ] }) });
  assert.equal(unsupported.items[0].score, 0);
  assert.equal(unsupported.items[0].confidence, 0);
  assert.equal(unsupported.items[0].verdict, 'review');
});

test('records a non-destructive override audit trail and recomputes the diagnostic score', async () => {
  const database = setup({ sections: [{ questions: [{ id: 'fill', type: 'fill', stem: '填空', answer: '2', score: 5 }] }] }, { fill: '3' });
  await gradeAttempt('attempt', 'child_1', { database });
  const diagnosis = reviewItem('attempt', { ownerId: 'child_1', questionId: 'fill', action: 'override', score: 4, reason: '家长核对计算过程后改判' }, database);
  assert.equal(diagnosis.diagnosticScore, 4);
  assert.equal(diagnosis.events.length, 1);
  assert.equal((diagnosis.events[0] as any).actorType, 'parent');
  assert.equal(JSON.parse((diagnosis.events[0] as any).beforeJson).score, 0);
  assert.equal(JSON.parse((diagnosis.events[0] as any).afterJson).score, 4);
});
