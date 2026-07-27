import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initLearningDomainDatabase } from '../src/services/learningDomain.js';
import { createPaperAttempt, getPaperAttempt, updatePaperAttempt } from '../src/services/paperAttemptService.js';

function setup() {
  const database = new Database(':memory:'); initLearningDomainDatabase(database);
  database.prepare(`INSERT INTO assessment_papers VALUES ('paper-1', 'blueprint-1', 'child_1', 1, ?, 10, 'completed', ?)`)
    .run(JSON.stringify({ sections: [{ questions: [{ id: 'q1' }, { id: 'q2' }] }] }), Date.now());
  return database;
}

test('creates one recoverable draft and saves only valid paper answers', () => {
  const database = setup(); const first = createPaperAttempt({ ownerId: 'child_1', paperId: 'paper-1' }, database); const second = createPaperAttempt({ ownerId: 'child_1', paperId: 'paper-1' }, database);
  assert.equal(first.id, second.id); const saved = updatePaperAttempt(first.id, { ownerId: 'child_1', action: 'save', answers: { q1: '答案' } }, database);
  assert.deepEqual(saved.answers, { q1: '答案' }); assert.equal(getPaperAttempt(first.id, 'child_2', database), null);
  assert.throws(() => updatePaperAttempt(first.id, { ownerId: 'child_1', action: 'save', answers: { invalid: 'x' } }, database));
});

test('submits once and preserves submitted answers', () => {
  const database = setup(); const attempt = createPaperAttempt({ ownerId: 'child_1', paperId: 'paper-1' }, database);
  const submitted = updatePaperAttempt(attempt.id, { ownerId: 'child_1', action: 'submit', answers: { q1: 'A', q2: '过程' } }, database);
  assert.equal(submitted.status, 'submitted'); assert.ok(submitted.submittedAt);
  assert.throws(() => updatePaperAttempt(attempt.id, { ownerId: 'child_1', action: 'submit', answers: { q1: 'B' } }, database));
  assert.deepEqual(getPaperAttempt(attempt.id, 'child_1', database)?.answers, { q1: 'A', q2: '过程' });
});
