import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initLearningDomainDatabase } from '../src/services/learningDomain.js';
import { createReviewItems, getQuizResultReview, setAnswerReviewReinforcement } from '../src/services/answerReviewService.js';

test('review snapshots preserve reference answers when read again and keep legacy formats readable', () => {
  const snapshot = createReviewItems([
    { id: 'q1', type: 'choice', question: '1 + 1 = ?', correctAnswer: '2', explanation: '相加。' },
    { id: 'q2', type: 'essay', question: '说明过程', answer: '先换算再相加', explanation: '单位相同后计算。' },
  ], { q1: '3', q2: '学生的过程' });
  const answers = Object.fromEntries(snapshot.map(item => [item.questionId, item.studentAnswer]));
  assert.deepEqual(createReviewItems(snapshot, answers), snapshot);
  assert.deepEqual(snapshot.map(item => item.referenceAnswer), ['2', '先换算再相加']);
});

test('completed quiz history retains every review field and reinforcement flags without rewriting answers', () => {
  const database = new Database(':memory:');
  database.exec(`CREATE TABLE quiz_results (id TEXT PRIMARY KEY, quizId TEXT, bookTitle TEXT, chapter TEXT, subject TEXT, ownerId TEXT, userName TEXT, resultsJson TEXT, createdAt INTEGER)`);
  initLearningDomainDatabase(database);
  const snapshot = JSON.stringify([{ questionId: 'q1', type: 'choice', question: '1 公顷等于多少平方米？', studentAnswer: '1000', referenceAnswer: '10000', explanation: '1 公顷等于 10000 平方米。', needsReinforcement: false }]);
  database.prepare(`INSERT INTO quiz_results VALUES ('result-1', 'quiz-1', '数学四上', '公顷和平方千米', '数学', 'child_1', '大宝', ?, 1000)`).run(snapshot);
  try {
    const initial = getQuizResultReview(database, 'result-1', 'child_1')!;
    assert.equal(initial.items[0].referenceAnswer, '10000');
    assert.equal(initial.items[0].studentAnswer, '1000');
    assert.equal(getQuizResultReview(database, 'result-1', 'child_2'), null);
    setAnswerReviewReinforcement(database, { ownerId: 'child_1', sourceType: 'quiz_result', sourceId: 'result-1', questionId: 'q1', needsReinforcement: true });
    const restored = getQuizResultReview(database, 'result-1', 'child_1')!;
    assert.deepEqual(restored.items[0], { ...initial.items[0], needsReinforcement: true });
    assert.equal((database.prepare(`SELECT resultsJson FROM quiz_results WHERE id = 'result-1'`).get() as { resultsJson: string }).resultsJson, snapshot);
  } finally { database.close(); }
});
