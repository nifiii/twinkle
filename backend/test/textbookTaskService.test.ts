import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initLearningDomainDatabase } from '../src/services/learningDomain.js';
import { getLearningTask } from '../src/services/learningTaskService.js';
import { createOlympiadAssessmentTask, createTextbookTask, getChapterActions, getOlympiadMaterials, TextbookTaskUnavailableError } from '../src/services/textbookTaskService.js';

function createDatabase(): Database.Database {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT, subject TEXT, grade TEXT, ownerId TEXT, status TEXT, mdPath TEXT, tableOfContents TEXT, category TEXT, tags TEXT);
    CREATE TABLE classroom_items (id TEXT PRIMARY KEY, type TEXT, bookTitle TEXT, chapter TEXT, subject TEXT, ownerId TEXT, userName TEXT, contentJson TEXT, slideCount INTEGER, questionCount INTEGER, createdAt INTEGER);
  `);
  initLearningDomainDatabase(database);
  const contents = JSON.stringify([{ id: 'chapter-1', title: '第一单元 大数的认识' }]);
  for (const [id, title, subject] of [['math-book', '数学四年级上册', '数学'], ['chinese-book', '语文四年级上册', '语文'], ['english-book', '英语四年级上册', '英语']] as const) {
    database.prepare(`INSERT INTO books (id, title, subject, grade, ownerId, status, mdPath, tableOfContents) VALUES (?, ?, ?, '四年级', 'shared', 'completed', '/tmp/book.md', ?)`).run(id, title, subject, contents);
  }
  database.prepare(`INSERT INTO external_resources (id, title, subject, grade, knowledgeTagsJson, url, sourceName, durationSeconds, ageLabel, reviewedAt, status, linkHealthStatus, embedStatus, embedUrl, createdAt, updatedAt) VALUES (?, ?, '数学', '四年级', '[]', 'https://source.example/video', '公开来源', 180, '适合 9-11 岁', 1, 'approved', 'healthy', 'allowed', 'https://embed.example/video', 1, 1)`).run('math-video', '大数认识视频');
  return database;
}

test('reports textbook chapter actions without video or Olympiad chapter coupling', () => {
  const database = createDatabase();
  const actions = getChapterActions('child_1', 'math-book', 'chapter-1', database);
  assert.equal(actions.some(action => action.action === 'video'), false);
  assert.equal(actions.find(action => action.action === 'math_thinking')?.available, true);
  database.prepare(`INSERT INTO books (id, title, subject, grade, ownerId, status, mdPath, tableOfContents, category) VALUES ('olympiad-4', '希望杯资料', '数学', '四年级', 'child_1', 'completed', '/tmp/olympiad.md', '[]', '奥数')`).run();
  assert.deepEqual(getOlympiadMaterials('child_1', database), [{ id: 'olympiad-4', title: '希望杯资料', grade: '四年级' }]);
  assert.equal(getChapterActions('child_1', 'chinese-book', 'chapter-1', database).some(action => action.action === 'video'), false);
});

test('accepts numeric chapter IDs after browser route parameters convert them to strings', async () => {
  const database = createDatabase();
  database.prepare(`UPDATE books SET tableOfContents = ? WHERE id = 'chinese-book'`).run(JSON.stringify([{ id: 1, title: '第一单元' }]));

  assert.equal(getChapterActions('child_1', 'chinese-book', '1', database).some(action => action.action === 'courseware'), true);
  const task = await createTextbookTask({
    ownerId: 'child_1', requestKey: 'numeric-chapter-id', taskType: 'courseware', userName: '大宝',
    source: { kind: 'chapter', bookId: 'chinese-book', chapterIds: ['1'] },
  }, {
    database,
    readMarkdown: async () => '# 第一单元\n这是足够用于测试的教材章节正文。'.repeat(10),
    generate: async () => ({ slides: [{ title: '第一单元重点', content: '归纳本单元内容。', notes: '复习。' }] }),
  });

  assert.equal(task.generationStatus, 'ready');
  assert.deepEqual(getLearningTask(database, task.id, 'child_1')?.chapterIds, ['1']);
});

test('creates an Olympiad assessment from an independent material source without chapters', async () => {
  const database = createDatabase();
  database.prepare(`INSERT INTO books (id, title, subject, grade, ownerId, status, mdPath, tableOfContents, category) VALUES ('olympiad-4', '希望杯资料', '数学', '四年级', 'child_1', 'completed', '/tmp/olympiad.md', '[]', '奥数')`).run();
  const blueprintCalls: Record<string, unknown>[] = [];
  const task = await createOlympiadAssessmentTask({
    ownerId: 'child_1', requestKey: 'olympiad-assessment', taskType: 'assessment',
    source: { kind: 'olympiad', olympiadBookId: 'olympiad-4', options: { examType: 'unit', difficulty: 'challenge' } },
  }, {
    database,
    createAssessmentBlueprint: async (input: Record<string, unknown>) => { blueprintCalls.push(input); return { id: 'blueprint-1' } as any; },
    createAssessmentPaper: async () => ({ id: 'paper-1' } as any),
  });
  assert.equal(task.generationStatus, 'ready');
  assert.equal(blueprintCalls[0].examMode, 'olympiad');
  assert.equal(blueprintCalls[0].olympiadBookId, 'olympiad-4');
  assert.equal('chapterIds' in blueprintCalls[0], false);
  assert.equal(getLearningTask(database, task.id, 'child_1')?.sourceType, 'olympiad');
  assert.deepEqual(getLearningTask(database, task.id, 'child_1')?.chapterIds, []);
  assert.equal((database.prepare(`SELECT entityType FROM learning_task_links WHERE taskId = ?`).get(task.id) as { entityType: string }).entityType, 'assessment_paper');
  await assert.rejects(() => createOlympiadAssessmentTask({
    ownerId: 'child_1', requestKey: 'olympiad-assessment-mismatch', taskType: 'assessment',
    source: { kind: 'olympiad', olympiadBookId: 'missing' },
  }, { database }), TextbookTaskUnavailableError);
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM learning_tasks WHERE requestKey = 'olympiad-assessment-mismatch'`).get() as { count: number }).count, 0);
});

test('rejects direct video task creation without creating a task', async () => {
  const database = createDatabase();
  await assert.rejects(() => createTextbookTask({
    ownerId: 'child_1', requestKey: 'math-video-task', taskType: 'video',
    source: { kind: 'chapter', bookId: 'math-book', chapterIds: ['chapter-1'], options: { resourceId: 'math-video' } },
  }, { database }), TextbookTaskUnavailableError);
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM learning_tasks WHERE requestKey = 'math-video-task'`).get() as { count: number }).count, 0);
});

test('archives generated courseware as one textbook task with its original entity link', async () => {
  const database = createDatabase();
  const task = await createTextbookTask({
    ownerId: 'child_1', requestKey: 'courseware-task', taskType: 'courseware', userName: '大宝',
    source: { kind: 'chapter', bookId: 'math-book', chapterIds: ['chapter-1'] },
  }, { database, readMarkdown: async () => '# 第一单元 大数的认识\n这是足够用于测试的教材章节正文。'.repeat(10), generate: async () => ({ slides: [{ title: '认识大数', content: '从数位和计数单位理解大数。', notes: '复盘数位顺序。' }] }) });
  assert.equal(task.generationStatus, 'ready');
  assert.equal(getLearningTask(database, task.id, 'child_1')?.taskType, 'courseware');
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM classroom_items WHERE type = 'courseware'`).get() as { count: number }).count, 1);
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM learning_task_links WHERE taskId = ? AND entityType = 'classroom_courseware'`).get(task.id) as { count: number }).count, 1);
});
