import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initLearningDomainDatabase } from '../src/services/learningDomain.js';
import { createLearningTask, getLearningTask, updateLearningTaskGenerationStatus } from '../src/services/learningTaskService.js';
import { createOlympiadAssessmentTask, createTextbookTask, getChapterActions, getOlympiadMaterials, TextbookTaskUnavailableError } from '../src/services/textbookTaskService.js';

function studentCourseware(subject: string) {
  const knowledgePoint = `${subject}章节知识点`;
  return {
    schemaVersion: 1 as const,
    audience: 'student' as const,
    objectives: [`理解${knowledgePoint}`],
    steps: [
      { id: 'step-1', kind: 'objective' as const, knowledgePoint, title: '学习目标', content: `完成${knowledgePoint}的自主学习。` },
      { id: 'step-2', kind: 'explanation' as const, knowledgePoint, title: '分步讲解', content: `用本章内容理解${knowledgePoint}。` },
      { id: 'step-3', kind: 'example' as const, knowledgePoint, title: '跟着示例做', content: '先观察题目条件，再完成推理。', example: { prompt: `${subject}示例`, walkthrough: ['读题', '找出关键条件'], answer: '示例答案' } },
      { id: 'step-4', kind: 'self_check' as const, knowledgePoint, title: '马上自检', content: '独立判断是否掌握。', selfCheck: { id: 'check-1', prompt: `${subject}自检题`, options: ['A', 'B'], answer: 'A', explanation: '结合本章知识点判断。' } },
      { id: 'step-5', kind: 'misconception' as const, knowledgePoint, title: '容易混淆的地方', content: '注意题目中的关键信息。' },
      { id: 'step-6', kind: 'summary' as const, knowledgePoint, title: '本章小结', content: '回顾本节的核心方法。' },
    ],
    summary: [`${knowledgePoint}要点`],
    studyTip: '先完成自检，再进入随堂测验。',
  };
}

function generatedStudentCourseware(subject: string) {
  return { courseware: studentCourseware(subject), questions: [{ type: 'choice', question: `${subject}随堂测验题`, options: ['A', 'B'], answer: 'A', explanation: '原创解析' }] };
}

function createDatabase(): Database.Database {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT, subject TEXT, grade TEXT, ownerId TEXT, status TEXT, mdPath TEXT, tableOfContents TEXT, category TEXT, tags TEXT);
    CREATE TABLE classroom_items (id TEXT PRIMARY KEY, type TEXT, bookTitle TEXT, chapter TEXT, subject TEXT, ownerId TEXT, userName TEXT, contentJson TEXT, slideCount INTEGER, questionCount INTEGER, createdAt INTEGER);
  `);
  initLearningDomainDatabase(database);
  const contents = JSON.stringify([{ id: 'chapter-1', title: '第一单元 大数的认识' }]);
  for (const [id, title, subject] of [['math-book', '数学四年级上册', '数学'], ['chinese-book', '语文四年级上册', '语文'], ['english-book', '英语四年级上册', '英语'], ['science-book', '科学四年级上册', '科学']] as const) {
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

test('keeps Olympiad and math competition materials out of textbook chapter learning', () => {
  const database = createDatabase();
  database.prepare(`INSERT INTO books (id, title, subject, grade, ownerId, status, mdPath, tableOfContents, tags) VALUES ('competition-4', '数学竞赛训练', '数学', '四年级', 'child_1', 'completed', '/tmp/competition.md', '[]', '["数学竞赛"]')`).run();

  assert.deepEqual(getOlympiadMaterials('child_1', database), [{ id: 'competition-4', title: '数学竞赛训练', grade: '四年级' }]);
  assert.throws(() => getChapterActions('child_1', 'competition-4', 'chapter-1', database), TextbookTaskUnavailableError);
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
    generate: async () => generatedStudentCourseware('语文'),
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

test('creates a student courseware and its practice quiz for each textbook subject', async () => {
  const database = createDatabase();
  for (const [bookId, subject] of [['math-book', '数学'], ['english-book', '英语'], ['chinese-book', '语文'], ['science-book', '科学']] as const) {
    const task = await createTextbookTask({
      ownerId: 'child_1', requestKey: `courseware-${bookId}`, taskType: 'courseware', userName: '大宝',
      source: { kind: 'chapter', bookId, chapterIds: ['chapter-1'] },
    }, { database, readMarkdown: async () => `# 第一单元 ${subject}章节\n这是足够用于测试的教材章节正文。`.repeat(10), generate: async () => generatedStudentCourseware(subject) });
    const links = database.prepare(`SELECT entityType, role FROM learning_task_links WHERE taskId = ?`).all(task.id) as Array<{ entityType: string; role: string }>;
    const content = JSON.parse((database.prepare(`SELECT contentJson FROM classroom_items WHERE id = (SELECT entityId FROM learning_task_links WHERE taskId = ? AND role = 'primary')`).get(task.id) as { contentJson: string }).contentJson);
    assert.equal(task.generationStatus, 'ready');
    assert.equal(getLearningTask(database, task.id, 'child_1')?.taskType, 'courseware');
    assert.equal(content.audience, 'student');
    assert.equal(content.steps.length, 6);
    assert.deepEqual(new Set(links.map(link => `${link.entityType}:${link.role}`)), new Set(['classroom_courseware:primary', 'classroom_quiz:practice']));
  }
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM classroom_items WHERE type = 'courseware'`).get() as { count: number }).count, 4);
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM classroom_items WHERE type = 'quiz'`).get() as { count: number }).count, 4);
});

test('normalizes model choice aliases before persisting a courseware practice quiz', async () => {
  const database = createDatabase();
  const task = await createTextbookTask({
    ownerId: 'child_1', requestKey: 'english-choice-alias', taskType: 'courseware', userName: '大宝',
    source: { kind: 'chapter', bookId: 'english-book', chapterIds: ['chapter-1'] },
  }, {
    database,
    readMarkdown: async () => '# Unit 1\n这是足够用于测试的英语教材章节正文。'.repeat(10),
    generate: async () => ({ courseware: studentCourseware('英语'), questions: [{ type: 'single_choice', question: '请选择正确表达。', options: ['A. Hello', 'B. Goodbye'], answer: 'A', explanation: 'A 是正确表达。' }] }),
  });

  const quiz = database.prepare(`SELECT contentJson FROM classroom_items WHERE id = (SELECT entityId FROM learning_task_links WHERE taskId = ? AND entityType = 'classroom_quiz')`).get(task.id) as { contentJson: string };
  assert.deepEqual(JSON.parse(quiz.contentJson), [{ id: 'q1', type: 'choice', question: '请选择正确表达。', options: ['A. Hello', 'B. Goodbye'], answer: 'A', explanation: 'A 是正确表达。' }]);
});

test('rejects a generated choice question without visible options', async () => {
  const database = createDatabase();
  await assert.rejects(() => createTextbookTask({
    ownerId: 'child_1', requestKey: 'choice-without-options', taskType: 'courseware', userName: '大宝',
    source: { kind: 'chapter', bookId: 'english-book', chapterIds: ['chapter-1'] },
  }, {
    database,
    readMarkdown: async () => '# Unit 1\n这是足够用于测试的英语教材章节正文。'.repeat(10),
    generate: async () => ({ courseware: studentCourseware('英语'), questions: [{ type: 'single_choice', question: '没有选项的题。', answer: 'A', explanation: '不可保存。' }] }),
  }));
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM classroom_items`).get() as { count: number }).count, 0);
});

test('rejects invalid student courseware without retaining a courseware or practice quiz', async () => {
  const database = createDatabase();
  await assert.rejects(() => createTextbookTask({
    ownerId: 'child_1', requestKey: 'invalid-courseware', taskType: 'courseware', userName: '大宝',
    source: { kind: 'chapter', bookId: 'math-book', chapterIds: ['chapter-1'] },
  }, {
    database,
    readMarkdown: async () => '# 第一单元 大数的认识\n这是足够用于测试的教材章节正文。'.repeat(10),
    generate: async () => ({ courseware: { ...studentCourseware('数学'), steps: studentCourseware('数学').steps.map((step, index) => index === 1 ? { ...step, kind: 'teacherNotes' } : step) }, questions: [{ question: '不会保存的题' }] }),
  }));
  const task = database.prepare(`SELECT generationStatus, errorCode FROM learning_tasks WHERE requestKey = 'invalid-courseware'`).get() as { generationStatus: string; errorCode: string };
  assert.deepEqual(task, { generationStatus: 'failed', errorCode: 'generation_failed' });
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM classroom_items`).get() as { count: number }).count, 0);
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM learning_task_links`).get() as { count: number }).count, 0);
});

test('does not duplicate a student courseware task for the same owner and request key', async () => {
  const database = createDatabase();
  let generatedCount = 0;
  const request = {
    ownerId: 'child_1', requestKey: 'courseware-idempotent', taskType: 'courseware', userName: '大宝',
    source: { kind: 'chapter', bookId: 'math-book', chapterIds: ['chapter-1'] },
  };
  const dependencies = {
    database,
    readMarkdown: async () => '# 第一单元 大数的认识\n这是足够用于测试的教材章节正文。'.repeat(10),
    generate: async () => { generatedCount += 1; return generatedStudentCourseware('数学'); },
  };
  const first = await createTextbookTask(request, dependencies);
  const second = await createTextbookTask(request, dependencies);
  assert.equal(first.id, second.id);
  assert.equal(generatedCount, 1);
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM classroom_items`).get() as { count: number }).count, 2);
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM learning_task_links WHERE taskId = ?`).get(first.id) as { count: number }).count, 2);
});

test('retries a failed textbook task on the same task record and uses a student-facing title', async () => {
  const database = createDatabase();
  const { task } = createLearningTask(database, {
    ownerId: 'child_1', requestKey: 'retry-courseware', taskType: 'courseware', sourceType: 'chapter',
    subject: '数学', grade: '四年级', title: '大数的认识·学生自学课件', bookId: 'math-book', chapterIds: ['chapter-1'],
  });
  updateLearningTaskGenerationStatus(database, task.id, 'running');
  updateLearningTaskGenerationStatus(database, task.id, 'failed', { errorCode: 'generation_failed', errorMessage: 'temporary failure' });

  const retried = await createTextbookTask({
    ownerId: 'child_1', retryTaskId: task.id, taskType: 'courseware',
    source: { kind: 'chapter', bookId: 'math-book', chapterIds: ['chapter-1'] },
  }, {
    database,
    readMarkdown: async () => '# 第一单元 大数的认识\n这是足够用于测试的教材章节正文。'.repeat(10),
    generate: async () => generatedStudentCourseware('数学'),
  });

  assert.equal(retried.id, task.id);
  assert.equal(retried.generationStatus, 'ready');
  assert.equal(getLearningTask(database, task.id, 'child_1')?.title, '大数的认识·学生自学课件');
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM learning_tasks WHERE id = ?`).get(task.id) as { count: number }).count, 1);
});
