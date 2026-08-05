import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  LearningOwnerContextError,
  initLearningDomainDatabase,
  parseLearningOwnerId,
  readLearningFeatureFlags,
} from '../src/services/learningDomain.js';

test('creates the independent learning-domain schema idempotently', () => {
  const db = new Database(':memory:');
  initLearningDomainDatabase(db);
  initLearningDomainDatabase(db);

  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN (
      'learning_packages', 'external_resources', 'style_profiles',
      'assessment_blueprints', 'assessment_papers', 'paper_attempts',
      'attempt_item_results', 'review_events', 'export_jobs',
      'learning_tasks', 'learning_task_links', 'learning_task_events'
    )
    ORDER BY name
  `).all() as Array<{ name: string }>;

  assert.deepEqual(tables.map(table => table.name), [
    'assessment_blueprints',
    'assessment_papers',
    'attempt_item_results',
    'export_jobs',
    'external_resources',
    'learning_packages',
    'learning_task_events',
    'learning_task_links',
    'learning_tasks',
    'paper_attempts',
    'review_events',
    'style_profiles',
  ]);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_paper_attempts_owner_paper'").get());
  const playbackColumns = db.prepare('PRAGMA table_info(learning_package_progress)').all() as Array<{ name: string }>;
  assert.ok(playbackColumns.some(column => column.name === 'firstCompletedAt'));
  assert.ok(playbackColumns.some(column => column.name === 'answersJson'));
  const resourceColumns = db.prepare('PRAGMA table_info(external_resources)').all() as Array<{ name: string }>;
  assert.deepEqual(
    ['title', 'durationSeconds', 'ageLabel', 'linkHealthStatus', 'lastHealthCheckedAt', 'embedStatus', 'embedUrl', 'lastEmbedCheckedAt']
      .every(name => resourceColumns.some(column => column.name === name)),
    true,
  );
});

test('upgrades the existing playback table with additive listening fields', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE learning_package_progress (
      ownerId TEXT NOT NULL,
      packageId TEXT NOT NULL,
      completedPlays INTEGER NOT NULL DEFAULT 0,
      submittedAt INTEGER,
      updatedAt INTEGER NOT NULL,
      PRIMARY KEY (ownerId, packageId)
    );
  `);
  initLearningDomainDatabase(db);
  const columns = db.prepare('PRAGMA table_info(learning_package_progress)').all() as Array<{ name: string }>;
  assert.ok(columns.some(column => column.name === 'firstCompletedAt'));
  assert.ok(columns.some(column => column.name === 'answersJson'));
});

test('upgrades existing external resources without treating them as verified', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE external_resources (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      grade TEXT NOT NULL,
      knowledgeTagsJson TEXT NOT NULL,
      url TEXT NOT NULL,
      sourceName TEXT NOT NULL,
      reviewedAt INTEGER,
      status TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO external_resources (
      id, subject, grade, knowledgeTagsJson, url, sourceName,
      reviewedAt, status, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'legacy-resource', '科学', '小学四年级上册', '[]',
    'https://example.test/video', '示例来源', Date.now(), 'approved', Date.now(), Date.now(),
  );

  initLearningDomainDatabase(db);
  const row = db.prepare('SELECT linkHealthStatus FROM external_resources WHERE id = ?').get('legacy-resource') as { linkHealthStatus: string };
  assert.equal(row.linkHealthStatus, 'unknown');
  const columns = db.prepare('PRAGMA table_info(external_resources)').all() as Array<{ name: string }>;
  assert.ok(columns.some(column => column.name === 'lastHealthCheckedAt'));
  assert.ok(columns.some(column => column.name === 'embedStatus'));
  assert.ok(columns.some(column => column.name === 'embedUrl'));
});

test('accepts ownerId only as a bounded local learning context', () => {
  assert.equal(parseLearningOwnerId(' child_1 '), 'child_1');
  assert.throws(() => parseLearningOwnerId(''), LearningOwnerContextError);
  assert.throws(() => parseLearningOwnerId('x'.repeat(129)), LearningOwnerContextError);
  assert.throws(() => parseLearningOwnerId(undefined), LearningOwnerContextError);
});

test('keeps every learning capability disabled unless explicitly enabled', () => {
  assert.deepEqual(readLearningFeatureFlags({}), {
    packages: false,
    assessments: false,
    attempts: false,
    grading: false,
    exports: false,
    tasks: false,
  });
  assert.deepEqual(readLearningFeatureFlags({
    LEARNING_PACKAGES_ENABLED: 'true',
    LEARNING_EXPORTS_ENABLED: 'true',
  }), {
    packages: true,
    assessments: false,
    attempts: false,
    grading: false,
    exports: true,
    tasks: false,
  });
});
