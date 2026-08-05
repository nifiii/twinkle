import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initLearningDomainDatabase } from '../src/services/learningDomain.js';
import {
  createLearningPackage,
  getLearningPackage,
  LearningPackageValidationError,
  requireEnglishListeningGradeProfile,
  updateLearningPackagePlayback,
} from '../src/services/learningPackageService.js';

const developmentScript = 'Hello, I am Mia. Welcome to our classroom today. Our teacher has a new book about school friends. We open the book and look at its bright pictures. Tom reads the first page. Anna listens carefully. Then we say hello to every friend in our class. Before the lesson starts, we put our pencils on the desk and smile together. The teacher asks us to listen for one important word in the story and choose the correct answer after we hear it.';

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
    generateEnglishListening: async input => {
      assert.equal(input.textbookGrade, '小学四年级上册');
      assert.equal(input.gradeProfile.id, 'g3_4');
      return {
      script: developmentScript,
      questions: [
        { id: 'q1', type: 'fact', prompt: 'Who is speaking?', options: ['Mia', 'Tom'], answer: 'Mia', explanation: 'Mia introduces herself.', rubricPoints: ['识别人物'] },
        { id: 'q2', type: 'fact', prompt: 'Where are they?', options: ['Classroom', 'Park'], answer: 'Classroom', explanation: 'They are in class.', rubricPoints: ['识别场景'] },
        { id: 'q3', type: 'inference', prompt: 'What do they do before class?', options: ['Read', 'Run'], answer: 'Read', explanation: 'They read the new book.', rubricPoints: ['理解活动'] },
      ],
    }; },
  });

  const content = result.content as Record<string, any>;
  assert.equal(content.original, true);
  assert.equal(content.gradeProfile.id, 'g3_4');
  assert.equal(content.gradeProfile.defaultSpeed, 'standard');
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
    generateEnglishListening: async () => ({ script: developmentScript, questions: [
      { id: 'q1', type: 'fact', prompt: 'Where are they?', answer: 'Classroom', explanation: 'They are starting an English lesson.', rubricPoints: ['识别场景'] },
      { id: 'q2', type: 'fact', prompt: 'Who is speaking?', answer: 'Teacher', explanation: 'The teacher says hello.', rubricPoints: ['识别人物'] },
      { id: 'q3', type: 'inference', prompt: 'What will they do?', answer: 'Listen', explanation: 'They listen to a story.', rubricPoints: ['理解活动'] },
    ] }),
  });
  assert.deepEqual(result.chapterIds, ['1']);
  assert.equal(result.status, 'completed');
});

test('maps textbook grades to the three fixed English listening profiles', () => {
  assert.equal(requireEnglishListeningGradeProfile('小学一年级上册').id, 'g1_2');
  assert.equal(requireEnglishListeningGradeProfile('三年级下册').id, 'g3_4');
  assert.equal(requireEnglishListeningGradeProfile('小学六年级').id, 'g5_6');
  assert.throws(() => requireEnglishListeningGradeProfile('适用儿童'), LearningPackageValidationError);
});

test('rejects English listening before generation when the textbook grade is not one of grades 1 through 6', async () => {
  const database = createDatabase();
  addBook(database, { id: 'english-without-grade', subject: '英语', grade: '适用儿童', toc: [{ id: 'unit-1', title: 'Unit One' }] });
  let generatorCalled = false;

  await assert.rejects(
    () => createLearningPackage({ ownerId: 'child_1', bookId: 'english-without-grade', chapterIds: ['unit-1'], kind: 'english-listening' }, {
      database,
      generateEnglishListening: async () => { generatorCalled = true; throw new Error('must not run'); },
    }),
    (error: unknown) => error instanceof LearningPackageValidationError && error.field === 'grade',
  );

  assert.equal(generatorCalled, false);
  assert.equal((database.prepare('SELECT COUNT(*) AS count FROM learning_packages').get() as { count: number }).count, 0);
});

test('does not persist listening output that violates its textbook grade profile', async () => {
  const database = createDatabase();
  addBook(database, { id: 'english-grade-one', subject: '英语', grade: '小学一年级上册', toc: [{ id: 'unit-1', title: 'Unit One' }] });

  await assert.rejects(
    () => createLearningPackage({ ownerId: 'child_1', bookId: 'english-grade-one', chapterIds: ['unit-1'], kind: 'english-listening' }, {
      database,
      readMarkdown: async () => '# Unit One\nThis source chapter contains enough original classroom learning context for the generated listening exercise.',
      generateEnglishListening: async () => ({ script: developmentScript, questions: [
        { id: 'q1', type: 'fact', prompt: 'Question one', answer: 'A', explanation: 'Fact.', rubricPoints: ['point'] },
        { id: 'q2', type: 'inference', prompt: 'Question two', answer: 'B', explanation: 'Inference is not allowed for Grade One.', rubricPoints: ['point'] },
      ] }),
    }),
  );

  assert.equal((database.prepare('SELECT COUNT(*) AS count FROM learning_packages').get() as { count: number }).count, 0);
});

test('persists at most two completed listening plays and submission', async () => {
  const database = createDatabase();
  addBook(database, { id: 'english-progress', subject: '英语', toc: [{ id: 'unit-1', title: 'Unit 1 Come on In!' }] });
  const result = await createLearningPackage({ ownerId: 'child_1', bookId: 'english-progress', chapterIds: ['unit-1'], kind: 'english-listening' }, {
    database,
    readMarkdown: async () => '# Unit 1\nEnough content for listening progress verification in this source chapter.',
    generateEnglishListening: async () => ({ script: developmentScript, questions: [
      { id: 'q1', type: 'fact', prompt: 'Question one', answer: 'A', explanation: 'First fact.', rubricPoints: ['point'] },
      { id: 'q2', type: 'fact', prompt: 'Question two', answer: 'B', explanation: 'Second fact.', rubricPoints: ['point'] },
      { id: 'q3', type: 'inference', prompt: 'Question three', answer: 'C', explanation: 'Simple inference.', rubricPoints: ['point'] },
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
