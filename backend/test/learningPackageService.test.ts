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
  toc: Array<{ id: string; title: string; children?: unknown[] }>;
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

test('returns only reviewed, healthy and complete public video metadata', async () => {
  const database = createDatabase();
  addBook(database, {
    id: 'science-book', subject: '科学', toc: [{ id: 'sound', title: '第一单元 声音' }],
  });
  const insert = database.prepare(`
    INSERT INTO external_resources (
      id, title, subject, grade, knowledgeTagsJson, url, sourceName,
      durationSeconds, ageLabel, reviewedAt, status, linkHealthStatus, lastHealthCheckedAt, createdAt, updatedAt
    ) VALUES (?, ?, '科学', '小学四年级上册', '[]', ?, '公开来源', ?, ?, ?, 'approved', ?, ?, ?, ?)
  `);
  const now = Date.now();
  insert.run('healthy', '声音的产生', 'https://video.example.test/sound', 180, '适合 9-11 岁', now, 'healthy', now, now, now);
  insert.run('unhealthy', '失效视频', 'https://video.example.test/old', 180, '适合 9-11 岁', now, 'unhealthy', now, now, now);
  insert.run('unreviewed', '未审核视频', 'https://video.example.test/new', 180, '适合 9-11 岁', null, 'healthy', now, now, now);
  insert.run('incomplete', null, 'https://video.example.test/no-title', 180, '适合 9-11 岁', now, 'healthy', now, now, now);

  const result = await createLearningPackage({
    ownerId: 'child_1', bookId: 'science-book', chapterIds: ['sound'], kind: 'science-video',
  }, { database });
  const resources = (result.content as Record<string, any>).resources;
  assert.deepEqual(resources, [{
    id: 'healthy', title: '声音的产生', sourceName: '公开来源', durationSeconds: 180,
    ageLabel: '适合 9-11 岁', url: 'https://video.example.test/sound',
  }]);
});

test('rejects math resources for material without a labelled grade', async () => {
  const database = createDatabase();
  addBook(database, {
    id: 'olympiad-book', subject: '数学', grade: null, toc: [{ id: 'number', title: '数感' }],
  });

  await assert.rejects(
    () => createLearningPackage({
      ownerId: 'child_1', bookId: 'olympiad-book', chapterIds: ['number'], kind: 'math-thinking',
    }, { database }),
    (error: unknown) => error instanceof LearningPackageValidationError && error.field === 'grade',
  );
});
