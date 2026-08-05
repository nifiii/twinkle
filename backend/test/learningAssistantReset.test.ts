import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { runLearningAssistantResetApply, runLearningAssistantResetDryRun } from '../src/scripts/learningAssistantReset.js';

test('dry-run backs up only learning-assistant candidates while preserving uploaded source records', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'twinkle-learning-reset-'));
  const database = new Database(path.join(dataDir, 'hlos.db'));
  const textbookPath = path.join(dataDir, 'originals', 'books', 'textbook.pdf');
  const examPath = path.join(dataDir, 'obsidian', 'Exams_Homework', 'exam.md');
  const sharedImage = path.join(dataDir, 'originals', 'images', 'shared.jpg');
  const wrongMarkdown = path.join(dataDir, 'obsidian', 'Wrong_Problems', 'wrong.md');
  const wrongImage = path.join(dataDir, 'originals', 'images', 'wrong-only.jpg');
  const legacyMissingPath = '/opt/hl-os/data/obsidian/Wrong_Problems/missing-legacy.md';

  try {
    for (const filePath of [textbookPath, examPath, sharedImage, wrongMarkdown, wrongImage]) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, path.basename(filePath));
    }
    await fs.writeFile(path.join(dataDir, 'metadata.json'), JSON.stringify([{ id: 'exam-1', type: 'exam_paper' }, { id: 'wrong-1', type: 'wrong_problem' }, { id: 'wrong-legacy', type: 'wrong_problem' }]), 'utf8');
    database.exec(`
      CREATE TABLE books (id TEXT PRIMARY KEY, filePath TEXT, mdPath TEXT, coverPath TEXT);
      CREATE TABLE scanned_items (id TEXT PRIMARY KEY, type TEXT, mdPath TEXT, imagePath TEXT, allImagesJson TEXT);
      CREATE TABLE classroom_items (id TEXT PRIMARY KEY, type TEXT, ownerId TEXT);
      CREATE TABLE quiz_results (id TEXT PRIMARY KEY, ownerId TEXT);
      CREATE TABLE wrong_problem_quiz_links (id TEXT PRIMARY KEY, scannedItemId TEXT, problemIndex INTEGER);
      CREATE TABLE learning_tasks (id TEXT PRIMARY KEY, ownerId TEXT);
      CREATE TABLE learning_task_links (taskId TEXT, entityType TEXT, entityId TEXT, role TEXT);
      CREATE TABLE learning_task_events (id TEXT PRIMARY KEY);
      CREATE TABLE learning_packages (id TEXT PRIMARY KEY, ownerId TEXT);
      CREATE TABLE learning_package_progress (ownerId TEXT, packageId TEXT);
      CREATE TABLE assessment_blueprints (id TEXT PRIMARY KEY);
      CREATE TABLE assessment_papers (id TEXT PRIMARY KEY, ownerId TEXT);
      CREATE TABLE paper_attempts (id TEXT PRIMARY KEY);
      CREATE TABLE attempt_item_results (attemptId TEXT, questionId TEXT);
      CREATE TABLE review_events (id TEXT PRIMARY KEY);
      CREATE TABLE export_jobs (id TEXT PRIMARY KEY);
      CREATE TABLE retired_learning_content (ownerId TEXT, entityType TEXT, entityId TEXT, retiredAt INTEGER, PRIMARY KEY (ownerId, entityType, entityId));
    `);
    database.prepare('INSERT INTO books VALUES (?, ?, ?, ?)').run('book-1', textbookPath, null, null);
    database.prepare('INSERT INTO scanned_items VALUES (?, ?, ?, ?, ?)').run('exam-1', 'exam_paper', examPath, sharedImage, JSON.stringify([sharedImage]));
    database.prepare('INSERT INTO scanned_items VALUES (?, ?, ?, ?, ?)').run('wrong-1', 'wrong_problem', wrongMarkdown, wrongImage, JSON.stringify([wrongImage, sharedImage]));
    database.prepare('INSERT INTO scanned_items VALUES (?, ?, ?, ?, ?)').run('wrong-legacy', 'wrong_problem', legacyMissingPath, null, '[]');
    database.prepare('INSERT INTO classroom_items VALUES (?, ?, ?)').run('courseware-1', 'courseware', 'child_1');
    database.prepare('INSERT INTO classroom_items VALUES (?, ?, ?)').run('quiz-1', 'quiz', 'child_1');
    database.prepare('INSERT INTO quiz_results VALUES (?, ?)').run('result-1', 'child_1');
    database.prepare('INSERT INTO wrong_problem_quiz_links VALUES (?, ?, ?)').run('link-1', 'wrong-1', 0);
    database.prepare('INSERT INTO learning_tasks VALUES (?, ?)').run('task-1', 'child_1');
    database.prepare('INSERT INTO learning_task_links VALUES (?, ?, ?, ?)').run('task-1', 'classroom_courseware', 'courseware-1', 'primary');
    database.prepare('INSERT INTO learning_task_events VALUES (?)').run('event-1');
    database.prepare('INSERT INTO learning_packages VALUES (?, ?)').run('package-1', 'child_1');
    database.prepare('INSERT INTO learning_package_progress VALUES (?, ?)').run('child_1', 'package-1');
    database.prepare('INSERT INTO assessment_blueprints VALUES (?)').run('blueprint-1');
    database.prepare('INSERT INTO assessment_papers VALUES (?, ?)').run('paper-1', 'child_1');
    database.prepare('INSERT INTO paper_attempts VALUES (?)').run('attempt-1');
    database.prepare('INSERT INTO attempt_item_results VALUES (?, ?)').run('attempt-1', 'question-1');
    database.prepare('INSERT INTO review_events VALUES (?)').run('review-1');
    database.prepare('INSERT INTO export_jobs VALUES (?)').run('export-1');

    const manifest = await runLearningAssistantResetDryRun({ database, dataDir, now: new Date('2026-08-04T00:00:00.000Z') });

    assert.equal(manifest.blockers.length, 0);
    assert.equal(manifest.delete.wrongProblems.count, 2);
    assert.deepEqual(manifest.delete.tables.find(table => table.table === 'classroom_items'), { table: 'classroom_items', count: 2, identifiers: ['id=courseware-1', 'id=quiz-1'] });
    assert.equal(manifest.delete.files.candidates.some(file => file.path === wrongMarkdown), true);
    assert.equal(manifest.delete.files.candidates.some(file => file.path === wrongImage), true);
    assert.equal(manifest.delete.files.missing.some(file => file.recordId === 'wrong-legacy' && file.path === path.join(dataDir, 'obsidian', 'Wrong_Problems', 'missing-legacy.md')), true);
    assert.equal(manifest.delete.files.sharedWithRetained.some(file => file.path === sharedImage), true);
    assert.deepEqual(manifest.delete.retiredContent.map(item => `${item.entityType}:${item.entityId}`), [
      'assessment_paper:paper-1', 'classroom_courseware:courseware-1', 'classroom_quiz:quiz-1', 'learning_package:package-1', 'learning_task:task-1', 'quiz_result:result-1',
    ]);
    assert.equal(manifest.retain.books.identifiers.includes('id=book-1'), true);
    assert.equal(manifest.retain.scannedItems.identifiers.includes('id=exam-1'), true);
    assert.equal(await fs.stat(manifest.backup.databasePath).then(stat => stat.isFile()), true);
    assert.equal(await fs.stat(path.join(manifest.backup.directory, 'manifest.json')).then(stat => stat.isFile()), true);
    assert.equal(await fs.stat(textbookPath).then(stat => stat.isFile()), true);
    assert.equal(await fs.stat(examPath).then(stat => stat.isFile()), true);
    assert.deepEqual(database.prepare('SELECT COUNT(*) AS count FROM scanned_items').get(), { count: 3 });
  } finally {
    database.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('apply removes only approved learning-assistant data and stages exclusive wrong-problem files', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'twinkle-learning-reset-apply-'));
  const database = new Database(path.join(dataDir, 'hlos.db'));
  const textbookPath = path.join(dataDir, 'originals', 'books', 'textbook.pdf');
  const examPath = path.join(dataDir, 'obsidian', 'Exams_Homework', 'exam.md');
  const wrongPath = path.join(dataDir, 'obsidian', 'Wrong_Problems', 'wrong.md');
  const legacyMissingPath = '/opt/hl-os/data/obsidian/Wrong_Problems/missing-legacy.md';

  try {
    for (const filePath of [textbookPath, examPath, wrongPath]) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, path.basename(filePath));
    }
    await fs.writeFile(path.join(dataDir, 'metadata.json'), JSON.stringify([{ id: 'exam-1', type: 'exam_paper' }, { id: 'wrong-1', type: 'wrong_problem' }, { id: 'wrong-legacy', type: 'wrong_problem' }]), 'utf8');
    database.exec(`
      CREATE TABLE books (id TEXT PRIMARY KEY, filePath TEXT, mdPath TEXT, coverPath TEXT);
      CREATE TABLE scanned_items (id TEXT PRIMARY KEY, type TEXT, mdPath TEXT, imagePath TEXT, allImagesJson TEXT);
      CREATE TABLE classroom_items (id TEXT PRIMARY KEY, type TEXT, ownerId TEXT);
      CREATE TABLE quiz_results (id TEXT PRIMARY KEY, ownerId TEXT);
      CREATE TABLE wrong_problem_quiz_links (id TEXT PRIMARY KEY, scannedItemId TEXT, problemIndex INTEGER);
      CREATE TABLE learning_tasks (id TEXT PRIMARY KEY, ownerId TEXT);
      CREATE TABLE learning_task_links (taskId TEXT, entityType TEXT, entityId TEXT, role TEXT);
      CREATE TABLE learning_task_events (id TEXT PRIMARY KEY);
      CREATE TABLE learning_packages (id TEXT PRIMARY KEY, ownerId TEXT);
      CREATE TABLE learning_package_progress (ownerId TEXT, packageId TEXT);
      CREATE TABLE assessment_blueprints (id TEXT PRIMARY KEY);
      CREATE TABLE assessment_papers (id TEXT PRIMARY KEY, ownerId TEXT);
      CREATE TABLE paper_attempts (id TEXT PRIMARY KEY);
      CREATE TABLE attempt_item_results (attemptId TEXT, questionId TEXT);
      CREATE TABLE review_events (id TEXT PRIMARY KEY);
      CREATE TABLE export_jobs (id TEXT PRIMARY KEY);
      CREATE TABLE retired_learning_content (ownerId TEXT, entityType TEXT, entityId TEXT, retiredAt INTEGER, PRIMARY KEY (ownerId, entityType, entityId));
    `);
    database.prepare('INSERT INTO books VALUES (?, ?, ?, ?)').run('book-1', textbookPath, null, null);
    database.prepare('INSERT INTO scanned_items VALUES (?, ?, ?, ?, ?)').run('exam-1', 'exam_paper', examPath, null, '[]');
    database.prepare('INSERT INTO scanned_items VALUES (?, ?, ?, ?, ?)').run('wrong-1', 'wrong_problem', wrongPath, null, '[]');
    database.prepare('INSERT INTO scanned_items VALUES (?, ?, ?, ?, ?)').run('wrong-legacy', 'wrong_problem', legacyMissingPath, null, '[]');
    database.prepare('INSERT INTO classroom_items VALUES (?, ?, ?)').run('courseware-1', 'courseware', 'child_1');
    database.prepare('INSERT INTO quiz_results VALUES (?, ?)').run('result-1', 'child_1');
    database.prepare('INSERT INTO learning_tasks VALUES (?, ?)').run('task-1', 'child_1');
    database.prepare('INSERT INTO assessment_papers VALUES (?, ?)').run('paper-1', 'child_1');

    const manifest = await runLearningAssistantResetDryRun({ database, dataDir, now: new Date('2026-08-04T00:00:00.000Z') });
    const result = await runLearningAssistantResetApply({ database, dataDir, approvedManifestPath: path.join(manifest.backup.directory, 'manifest.json'), now: new Date('2026-08-04T00:00:01.000Z') });

    assert.equal(result.deletedWrongProblems, 2);
    assert.equal(result.stagedFiles, 1);
    assert.deepEqual(database.prepare('SELECT id FROM books').all(), [{ id: 'book-1' }]);
    assert.deepEqual(database.prepare('SELECT id FROM scanned_items').all(), [{ id: 'exam-1' }]);
    assert.deepEqual(database.prepare('SELECT COUNT(*) AS count FROM classroom_items').get(), { count: 0 });
    assert.deepEqual(database.prepare('SELECT COUNT(*) AS count FROM quiz_results').get(), { count: 0 });
    assert.deepEqual(database.prepare('SELECT COUNT(*) AS count FROM learning_tasks').get(), { count: 0 });
    assert.deepEqual(database.prepare('SELECT COUNT(*) AS count FROM assessment_papers').get(), { count: 0 });
    assert.deepEqual(database.prepare('SELECT ownerId, entityType, entityId FROM retired_learning_content ORDER BY entityType').all(), [
      { ownerId: 'child_1', entityType: 'assessment_paper', entityId: 'paper-1' },
      { ownerId: 'child_1', entityType: 'classroom_courseware', entityId: 'courseware-1' },
      { ownerId: 'child_1', entityType: 'learning_task', entityId: 'task-1' },
      { ownerId: 'child_1', entityType: 'quiz_result', entityId: 'result-1' },
    ]);
    assert.equal(await fs.stat(textbookPath).then(stat => stat.isFile()), true);
    assert.equal(await fs.stat(examPath).then(stat => stat.isFile()), true);
    await assert.rejects(fs.stat(wrongPath));
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir, 'metadata.json'), 'utf8')), [{ id: 'exam-1', type: 'exam_paper' }]);
  } finally {
    database.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('dry-run keeps arbitrary external wrong-problem paths blocked', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'twinkle-learning-reset-unsafe-'));
  const database = new Database(path.join(dataDir, 'hlos.db'));
  try {
    database.exec('CREATE TABLE scanned_items (id TEXT PRIMARY KEY, type TEXT, mdPath TEXT, imagePath TEXT, allImagesJson TEXT);');
    database.prepare('INSERT INTO scanned_items VALUES (?, ?, ?, ?, ?)').run('wrong-unsafe', 'wrong_problem', '/outside/the-data-volume/wrong.md', null, '[]');

    const manifest = await runLearningAssistantResetDryRun({ database, dataDir, now: new Date('2026-08-04T00:00:00.000Z') });

    assert.deepEqual(manifest.blockers, [{
      code: 'unsafe_file_path', message: '错题文件不在数据卷内', recordId: 'wrong-unsafe', field: 'mdPath', value: '/outside/the-data-volume/wrong.md',
    }]);
  } finally {
    database.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('dry-run keeps retained scanned-item paths outside the data volume blocked', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'twinkle-learning-reset-retained-unsafe-'));
  const database = new Database(path.join(dataDir, 'hlos.db'));
  try {
    database.exec('CREATE TABLE scanned_items (id TEXT PRIMARY KEY, type TEXT, mdPath TEXT, imagePath TEXT, allImagesJson TEXT);');
    database.prepare('INSERT INTO scanned_items VALUES (?, ?, ?, ?, ?)').run(
      'exam-legacy',
      'exam_paper',
      '/opt/hl-os/data/obsidian/Exams_Homework/exam.md',
      null,
      '[]',
    );

    const manifest = await runLearningAssistantResetDryRun({ database, dataDir, now: new Date('2026-08-04T00:00:00.000Z') });

    assert.deepEqual(manifest.blockers, [{
      code: 'unsafe_file_path',
      message: '保留资料文件不在数据卷内',
      recordId: 'exam-legacy',
      field: 'mdPath',
      value: '/opt/hl-os/data/obsidian/Exams_Homework/exam.md',
    }]);
  } finally {
    database.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
