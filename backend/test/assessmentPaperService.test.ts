import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initLearningDomainDatabase } from '../src/services/learningDomain.js';
import { createAssessmentBlueprint, createAssessmentPaper, getAssessmentPaper } from '../src/services/assessmentPaperService.js';

function setup() {
  const database = new Database(':memory:');
  database.exec('CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT, ownerId TEXT, subject TEXT, grade TEXT, tableOfContents TEXT, mdPath TEXT, status TEXT, category TEXT, tags TEXT)');
  initLearningDomainDatabase(database);
  database.prepare(`INSERT INTO books (id, title, ownerId, subject, grade, tableOfContents, mdPath, status) VALUES ('math', '数学教材', 'shared', '数学', '小学四年级上册', ?, '/tmp/math.md', 'completed')`).run(JSON.stringify([{ id: 'unit-1', title: '第一单元' }, { id: 'unit-2', title: '第二单元' }]));
  return database;
}

function generated(input: Record<string, unknown>) {
  return { title: '原创数学试卷', sections: (input.sections as Array<any>).map(section => ({ title: section.type, questions: Array.from({ length: section.questionCount }, (_, index) => ({ stem: `${section.type}-${index}`, options: section.type === 'choice' ? ['A', 'B'] : undefined, answer: 'A', explanation: '原创解析', rubric: section.type === 'essay' ? [{ id: 'process', score: section.scorePerQuestion / 2, description: '过程正确', dimension: 'process' }, { id: 'result', score: section.scorePerQuestion / 2, description: '结果正确', dimension: 'result' }] : undefined })) })) };
}

test('creates a standard blueprint by default and ignores an unreviewed style profile', async () => {
  const database = setup();
  database.prepare(`INSERT INTO style_profiles VALUES ('pending', NULL, 'guangzhou', 'https://example.test', ?, '{}', '{"sourceQuestion":"must not leak"}', 'pending', ?)` ).run(Date.now(), Date.now());
  const blueprint = await createAssessmentBlueprint({ ownerId: 'child_1', bookId: 'math', chapterIds: ['unit-2'], examType: 'unit', styleProfileId: 'pending' }, { database });
  assert.equal(blueprint.difficulty, 'standard');
  assert.equal(blueprint.totalScore, 22);
  assert.equal(blueprint.style, null);
});

test('generates immutable paper versions from selected chapter text without exposing style sample text', async () => {
  const database = setup();
  const blueprint = await createAssessmentBlueprint({ ownerId: 'child_1', bookId: 'math', chapterIds: ['unit-2'], examType: 'unit' }, { database });
  const calls: Record<string, unknown>[] = [];
  const dependencies = { database, readMarkdown: async () => '# 第一单元\n第一单元正文足够长，用于确保错误的范围不会被命题服务使用。这里继续补足内容，并加入数位、计算和比较等知识点说明，保证章节正文长度超过最小校验阈值。\n# 第二单元\n第二单元正文足够长，用于验证试卷只依据选中的教材章节生成原创题目。这里继续补足内容，并加入图形、测量和应用题等知识点说明，保证章节正文长度超过最小校验阈值。', generatePaper: async (input: Record<string, unknown>) => { calls.push(input); return generated(input); } };
  const first = await createAssessmentPaper({ ownerId: 'child_1', blueprintId: blueprint.id }, dependencies);
  const second = await createAssessmentPaper({ ownerId: 'child_1', blueprintId: blueprint.id }, dependencies);
  assert.equal(first.generationVersion, 1);
  assert.equal(second.generationVersion, 2);
  assert.notEqual(first.id, second.id);
  assert.match(String(calls[0].textbookExcerpt), /第二单元正文/);
  assert.doesNotMatch(String(calls[0].textbookExcerpt), /第一单元正文/);
  assert.equal(getAssessmentPaper(first.id, 'child_1', database)?.generationVersion, 1);
  assert.equal(getAssessmentPaper(first.id, 'child_2', database), null);
});

test('matches a Chinese unit title to its numbered textbook heading without crossing into the next unit', async () => {
  const database = setup();
  database.prepare(`UPDATE books SET tableOfContents = ? WHERE id = 'math'`).run(JSON.stringify([{ id: 'unit-1', title: '第一单元 大数的认识' }]));
  const blueprint = await createAssessmentBlueprint({ ownerId: 'child_1', bookId: 'math', chapterIds: ['unit-1'], examType: 'unit' }, { database });
  const calls: Record<string, unknown>[] = [];
  await createAssessmentPaper({ ownerId: 'child_1', blueprintId: blueprint.id }, {
    database,
    readMarkdown: async () => '# 1 大数的认识\n本单元教材正文足够长，包含数位、读写大数和近似数知识点，确保命题服务只使用这一单元的内容生成原创试题。\n## 做一做\n更多第一单元练习内容。\n# 2 公顷和平方千米\n第二单元正文不得进入第一单元命题上下文。',
    generatePaper: async (input: Record<string, unknown>) => { calls.push(input); return generated(input); },
  });
  assert.match(String(calls[0].textbookExcerpt), /数位、读写大数/);
  assert.doesNotMatch(String(calls[0].textbookExcerpt), /第二单元正文/);
});

test('uses only matching Olympiad material metadata for an original math paper', async () => {
  const database = setup();
  database.prepare(`INSERT INTO books (id, title, ownerId, subject, grade, tableOfContents, mdPath, status, category, tags) VALUES ('olympiad', '希望杯四年级', 'child_1', '数学', '小学四年级上册', '[]', '/tmp/olympiad.md', 'completed', '奥数', '["数感","数形结合"]')`).run();
  const blueprint = await createAssessmentBlueprint({ ownerId: 'child_1', bookId: 'math', chapterIds: ['unit-1'], examType: 'unit', examMode: 'olympiad', olympiadBookId: 'olympiad' }, { database });
  const calls: Record<string, unknown>[] = [];
  await createAssessmentPaper({ ownerId: 'child_1', blueprintId: blueprint.id }, {
    database,
    readMarkdown: async () => '# 第一单元\n教材正文足够长，用于生成原创题目，不引用奥数资料原题。'.repeat(8),
    generatePaper: async (input: Record<string, unknown>) => { calls.push(input); return generated(input); },
  });
  assert.equal(blueprint.examMode, 'olympiad');
  assert.equal(blueprint.olympiadMaterial?.id, 'olympiad');
  assert.deepEqual(calls[0].olympiadStyle, { id: 'olympiad', title: '希望杯四年级', category: '奥数', tags: '["数感","数形结合"]' });
  assert.doesNotMatch(JSON.stringify(calls[0]), /olympiad\.md/);
});

test('rejects an Olympiad material with a different grade', async () => {
  const database = setup();
  database.prepare(`INSERT INTO books (id, title, ownerId, subject, grade, tableOfContents, mdPath, status, category) VALUES ('olympiad-five', '希望杯五年级', 'child_1', '数学', '小学五年级上册', '[]', '/tmp/olympiad-five.md', 'completed', '奥数')`).run();
  await assert.rejects(
    () => createAssessmentBlueprint({ ownerId: 'child_1', bookId: 'math', chapterIds: ['unit-1'], examType: 'unit', examMode: 'olympiad', olympiadBookId: 'olympiad-five' }, { database }),
    (error: unknown) => error instanceof Error && /年级匹配/.test(error.message),
  );
});
