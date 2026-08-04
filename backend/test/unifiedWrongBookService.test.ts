import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { getUnifiedWrongBook, WrongBookUnavailableError, WrongBookValidationError } from '../src/services/unifiedWrongBookService.js';

function createDatabase(includeQuizResults = true): Database.Database {
  const database = new Database(':memory:');
  database.exec(`CREATE TABLE scanned_items (id TEXT PRIMARY KEY, type TEXT, subject TEXT, ownerId TEXT, problemsJson TEXT, timestamp INTEGER);`);
  if (includeQuizResults) database.exec(`CREATE TABLE quiz_results (id TEXT PRIMARY KEY, subject TEXT, chapter TEXT, ownerId TEXT, resultsJson TEXT, status TEXT, createdAt INTEGER);`);
  database.exec(`CREATE TABLE answer_review_flags (ownerId TEXT, sourceType TEXT, sourceId TEXT, questionId TEXT, createdAt INTEGER, PRIMARY KEY (ownerId, sourceType, sourceId, questionId));`);
  database.exec(`CREATE TABLE paper_attempts (id TEXT PRIMARY KEY, paperId TEXT, ownerId TEXT, status TEXT, createdAt INTEGER, reviewSnapshotJson TEXT); CREATE TABLE assessment_papers (id TEXT PRIMARY KEY, blueprintId TEXT, ownerId TEXT, contentJson TEXT); CREATE TABLE assessment_blueprints (id TEXT PRIMARY KEY, ownerId TEXT, bookId TEXT, chapterIdsJson TEXT); CREATE TABLE books (id TEXT PRIMARY KEY, ownerId TEXT, subject TEXT, tableOfContents TEXT);`);
  database.prepare(`INSERT INTO scanned_items VALUES ('scan-1', 'wrong_problem', '数学', 'child_1', ?, 1000)`).run(JSON.stringify([
    { content: '36 除以 6 等于多少？', answer: '6', knowledgePoints: ['除法'] },
    { content: '', answer: '无效题目' },
  ]));
  database.prepare(`INSERT INTO scanned_items VALUES ('scan-2', 'wrong_problem', '语文', 'child_1', ?, 3000)`).run(JSON.stringify([{ content: '给词语造句。', knowledgePoints: ['造句'] }]));
  if (includeQuizResults) {
    database.prepare(`INSERT INTO quiz_results VALUES ('result-1', '数学', '第一单元', 'child_1', ?, 'completed', 2000)`).run(JSON.stringify([
      { id: 'q1', question: '36 除以 6 等于多少？', correctAnswer: '6', studentAnswer: '5', explanation: '复习除法' },
      { id: 'q2', question: '10 加 2 等于多少？', correctAnswer: '12', studentAnswer: '12' },
      { question: '题干完整但无答案', studentAnswer: 'x', isCorrect: false },
    ]));
    database.prepare(`INSERT INTO answer_review_flags VALUES ('child_1', 'quiz_result', 'result-1', 'q1', 2000)`).run();
    database.prepare(`INSERT INTO books VALUES ('book-1', 'child_1', '数学', ?)`)
      .run(JSON.stringify([{ id: 'chapter-1', title: '第一单元' }]));
    database.prepare(`INSERT INTO assessment_blueprints VALUES ('blueprint-1', 'child_1', 'book-1', ?)`)
      .run(JSON.stringify(['chapter-1']));
    database.prepare(`INSERT INTO assessment_papers VALUES ('paper-1', 'blueprint-1', 'child_1', ?)`)
      .run(JSON.stringify({ blueprint: { subject: '数学', chapterTitles: ['第一单元'] } }));
    database.prepare(`INSERT INTO paper_attempts VALUES ('attempt-1', 'paper-1', 'child_1', 'submitted', 2500, ?)`)
      .run(JSON.stringify([{ questionId: 'p1', question: '48 除以 6 等于多少？', referenceAnswer: '8', studentAnswer: '7', explanation: '复习除法' }]));
    database.prepare(`INSERT INTO answer_review_flags VALUES ('child_1', 'paper_attempt', 'attempt-1', 'p1', 2500)`).run();
    database.prepare(`INSERT INTO quiz_results VALUES ('result-pending', '数学', '第二单元', 'child_1', ?, 'grading', 4000)`).run(JSON.stringify([{ question: '不应显示', correctAnswer: 'x', isCorrect: false }]));
  }
  return database;
}

test('aggregates scanned and explicitly marked classroom problems read-only without deduplication', () => {
  const database = createDatabase();
  const before = database.prepare('SELECT total_changes() AS count').get() as { count: number };
  const result = getUnifiedWrongBook({ ownerId: 'child_1', source: 'all', limit: '50' }, database);
  const after = database.prepare('SELECT total_changes() AS count').get() as { count: number };
  assert.deepEqual(result.items.map(item => item.id), ['scanned_item:scan-2:0', 'paper_attempt:attempt-1:0', 'quiz_result:result-1:0', 'scanned_item:scan-1:0']);
  assert.equal(result.items[0]?.capabilities.edit, false);
  assert.equal(result.items[1]?.capabilities.edit, false);
  assert.equal(result.items[3]?.capabilities.delete, true);
  assert.deepEqual(result.sources, {
    scanned_item: { status: 'ok', count: 2, skippedCount: 1 },
    quiz_result: { status: 'ok', count: 1, skippedCount: 0 },
    paper_attempt: { status: 'ok', count: 1, skippedCount: 0 },
  });
  assert.equal(after.count, before.count);
});

test('applies source, subject, time, keyword and cursor filters to the unified view', () => {
  const database = createDatabase();
  const math = getUnifiedWrongBook({ ownerId: 'child_1', subject: '数学', source: 'all', from: '1970-01-01T00:00:00.500Z', query: '36', limit: '1' }, database);
  assert.deepEqual(math.items.map(item => item.id), ['quiz_result:result-1:0']);
  assert.ok(math.nextCursor);
  const next = getUnifiedWrongBook({ ownerId: 'child_1', subject: '数学', source: 'all', from: '1970-01-01T00:00:00.500Z', query: '36', limit: '1', cursor: math.nextCursor! }, database);
  assert.deepEqual(next.items.map(item => item.id), ['scanned_item:scan-1:0']);
  assert.deepEqual(getUnifiedWrongBook({ ownerId: 'child_1', source: 'quiz_result', limit: '50' }, database).items.map(item => item.source), ['quiz_result']);
  assert.throws(() => getUnifiedWrongBook({ ownerId: 'child_1', limit: '101' }, database), WrongBookValidationError);
});

test('returns partial success when one source is unavailable and fails only when all selected sources are unavailable', () => {
  const partialDatabase = createDatabase(false);
  const partial = getUnifiedWrongBook({ ownerId: 'child_1', source: 'all' }, partialDatabase);
  assert.deepEqual(partial.items.map(item => item.source), ['scanned_item', 'scanned_item']);
  assert.equal(partial.sources.scanned_item.status, 'ok');
  assert.equal(partial.sources.quiz_result.status, 'unavailable');
  assert.throws(() => getUnifiedWrongBook({ ownerId: 'child_1', source: 'quiz_result' }, partialDatabase), WrongBookUnavailableError);
  const unavailableDatabase = new Database(':memory:');
  assert.throws(() => getUnifiedWrongBook({ ownerId: 'child_1', source: 'all' }, unavailableDatabase), WrongBookUnavailableError);
});
