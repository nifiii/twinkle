import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initLearningDomainDatabase } from '../src/services/learningDomain.js';
import {
  createLearningPackage,
  getLearningPackage,
  LearningPackageValidationError,
  updateLearningPackagePlayback,
} from '../src/services/learningPackageService.js';

function createDatabase(): Database.Database {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE books (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL,
      subject TEXT,
      grade TEXT,
      tableOfContents TEXT,
      mdPath TEXT,
      status TEXT
    );
  `);
  initLearningDomainDatabase(database);
  return database;
}

function addBook(database: Database.Database, values: {
  id: string;
  subject: string;
  grade?: string | null;
  toc: Array<{ id: string | number; title: string; children?: unknown[] }>;
}): void {
  database.prepare(`
    INSERT INTO books (id, ownerId, subject, grade, tableOfContents, mdPath, status)
    VALUES (?, 'shared', ?, ?, ?, '/tmp/textbook.md', 'completed')
  `).run(
    values.id,
    values.subject,
    Object.prototype.hasOwnProperty.call(values, 'grade') ? values.grade : '小学四年级上册',
    JSON.stringify(values.toc),
  );
}

test('creates an original English listening package anchored to chapter text', async () => {
  const database = createDatabase();
  addBook(database, {
    id: 'english-book',
    subject: '英语',
    toc: [{ id: 'unit-1', title: 'Unit 1 Come on In!' }],
  });

  const result = await createLearningPackage({
    ownerId: 'child_1', bookId: 'english-book', chapterIds: ['unit-1'], kind: 'english-listening',
  }, {
    database,
    readMarkdown: async () => '# Unit 1\nThis chapter teaches classroom greetings and simple introductions for young learners.',
    generateEnglishListening: async () => ({
      script: 'Hello, I am Mia. Welcome to our classroom.',
      questions: [
        { id: 'q1', prompt: 'Who is speaking?', options: ['Mia', 'Tom'], answer: 'Mia', rubricPoints: ['识别人物'] },
        { id: 'q2', prompt: 'Where are they?', options: ['Classroom', 'Park'], answer: 'Classroom', rubricPoints: ['识别场景'] },
      ],
    }),
  });

  const content = result.content as Record<string, any>;
  assert.equal(content.original, true);
  assert.equal(content.listening.script, 'Hello, I am Mia. Welcome to our classroom.');
  assert.deepEqual(content.audio, {
    endpoint: '/api/tts',
    request: { text: content.listening.script, coursewareId: result.id, chunkIdx: 0 },
  });
  assert.ok(getLearningPackage(result.id, 'child_1', database));
  assert.equal(getLearningPackage(result.id, 'child_2', database), null);
});

test('accepts a numeric English catalog ID submitted by the browser as text', async () => {
  const database = createDatabase();
  addBook(database, { id: 'english-numeric-id', subject: '英语', toc: [{ id: 1, title: 'Unit 1 Come on In!' }] });
  const result = await createLearningPackage({
    ownerId: 'child_1', bookId: 'english-numeric-id', chapterIds: ['1'], kind: 'english-listening',
  }, {
    database,
    readMarkdown: async () => '# Unit 1 Come on In!\nThis source chapter contains enough classroom greeting, introduction and dialogue practice context to generate a short original listening exercise.',
    generateEnglishListening: async () => ({ script: 'Welcome to class.', questions: [
      { id: 'q1', prompt: 'Where are they?', answer: 'Classroom', rubricPoints: ['识别场景'] },
      { id: 'q2', prompt: 'Who is speaking?', answer: 'Teacher', rubricPoints: ['识别人物'] },
    ] }),
  });
  assert.deepEqual(result.chapterIds, ['1']);
  assert.equal(result.status, 'completed');
});

test('persists at most two completed listening plays and submission', async () => {
  const database = createDatabase();
  addBook(database, { id: 'english-progress', subject: '英语', toc: [{ id: 'unit-1', title: 'Unit 1 Come on In!' }] });
  const result = await createLearningPackage({ ownerId: 'child_1', bookId: 'english-progress', chapterIds: ['unit-1'], kind: 'english-listening' }, {
    database,
    readMarkdown: async () => '# Unit 1\nEnough content for listening progress verification in this source chapter.',
    generateEnglishListening: async () => ({ script: 'A short original script.', questions: [
      { id: 'q1', prompt: 'Question one', answer: 'A', rubricPoints: ['point'] },
      { id: 'q2', prompt: 'Question two', answer: 'B', rubricPoints: ['point'] },
    ] }),
  });
  assert.equal(updateLearningPackagePlayback(result.id, 'child_1', 'completed', database).completedPlays, 1);
  assert.equal(updateLearningPackagePlayback(result.id, 'child_1', 'completed', database).canPlay, false);
  assert.throws(() => updateLearningPackagePlayback(result.id, 'child_1', 'completed', database), LearningPackageValidationError);
  assert.ok(updateLearningPackagePlayback(result.id, 'child_1', 'submit', database).submittedAt);
});

test('rejects English listening when the selected chapter has no parsed body', async () => {
  const database = createDatabase();
  addBook(database, {
    id: 'english-book', subject: '英语', toc: [{ id: 'unit-1', title: 'Unit One' }],
  });

  await assert.rejects(
    () => createLearningPackage({
      ownerId: 'child_1', bookId: 'english-book', chapterIds: ['unit-1'], kind: 'english-listening',
    }, { database, readMarkdown: async () => '# Different Unit\nNo matching chapter body is present.' }),
    (error: unknown) => error instanceof LearningPackageValidationError && error.field === 'chapterIds',
  );
});

test('rejects all new video learning package kinds', async () => {
  const database = createDatabase();
  addBook(database, { id: 'math-book', subject: '数学', toc: [{ id: 'number', title: '数感' }] });
  for (const kind of ['english-video', 'math-video', 'chinese-video', 'science-video']) {
    await assert.rejects(
      () => createLearningPackage({ ownerId: 'child_1', bookId: 'math-book', chapterIds: ['number'], kind }, { database }),
      (error: unknown) => error instanceof LearningPackageValidationError && error.field === 'kind',
    );
  }
});

test('keeps math thinking as original training instead of video resources', async () => {
  const database = createDatabase();
  addBook(database, {
    id: 'math-thinking-book', subject: '数学', toc: [{ id: 'equation', title: '方程思维' }],
  });

  const result = await createLearningPackage({
    ownerId: 'child_1', bookId: 'math-thinking-book', chapterIds: ['equation'], kind: 'math-thinking',
  }, { database });
  const content = result.content as Record<string, any>;

  assert.equal(content.original, true);
  assert.deepEqual(content.chapterTitles, ['方程思维']);
  assert.deepEqual(content.training.focus, ['数感', '数形结合', '方程思维']);
  assert.equal('resources' in content, false);
});
