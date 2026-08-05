import Database from 'better-sqlite3';

export const LEARNING_FEATURES = [
  'packages',
  'assessments',
  'attempts',
  'grading',
  'exports',
  'tasks',
] as const;

export type LearningFeature = typeof LEARNING_FEATURES[number];
export type LearningFeatureFlags = Record<LearningFeature, boolean>;

const FEATURE_ENV_NAMES: Record<LearningFeature, string> = {
  packages: 'LEARNING_PACKAGES_ENABLED',
  assessments: 'LEARNING_ASSESSMENTS_ENABLED',
  attempts: 'LEARNING_ATTEMPTS_ENABLED',
  grading: 'LEARNING_GRADING_ENABLED',
  exports: 'LEARNING_EXPORTS_ENABLED',
  tasks: 'LEARNING_TASKS_ENABLED',
};

export class LearningOwnerContextError extends Error {
  constructor() {
    super('ownerId is required for the local learning context');
    this.name = 'LearningOwnerContextError';
  }
}

/**
 * `ownerId` keeps records associated with the profile selected on this device.
 * It is intentionally not authentication: callers must not treat this check as
 * a server-side authorization boundary until a trusted identity exists.
 */
export function parseLearningOwnerId(value: unknown): string {
  if (typeof value !== 'string') throw new LearningOwnerContextError();
  const ownerId = value.trim();
  if (!ownerId || ownerId.length > 128) throw new LearningOwnerContextError();
  return ownerId;
}

export function readLearningFeatureFlags(env: NodeJS.ProcessEnv = process.env): LearningFeatureFlags {
  return Object.fromEntries(
    LEARNING_FEATURES.map(feature => [feature, env[FEATURE_ENV_NAMES[feature]] === 'true']),
  ) as LearningFeatureFlags;
}

/**
 * Creates only new learning-domain tables. Keeping this schema separate from
 * classroom tables preserves historical quiz semantics and makes each feature
 * safe to disable without a destructive rollback.
 */
export function initLearningDomainDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS learning_packages (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL,
      bookId TEXT NOT NULL,
      chapterIdsJson TEXT NOT NULL,
      kind TEXT NOT NULL,
      contentJson TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_learning_packages_owner_book
      ON learning_packages(ownerId, bookId, createdAt DESC);

    CREATE TABLE IF NOT EXISTS learning_tasks (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL,
      requestKey TEXT NOT NULL,
      taskType TEXT NOT NULL,
      sourceType TEXT NOT NULL,
      subject TEXT NOT NULL,
      grade TEXT NOT NULL,
      bookId TEXT,
      chapterIdsJson TEXT NOT NULL,
      wrongProblemRefsJson TEXT NOT NULL,
      title TEXT NOT NULL,
      generationStatus TEXT NOT NULL,
      learningStatus TEXT NOT NULL,
      errorCode TEXT,
      errorMessage TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      UNIQUE(ownerId, requestKey)
    );
    CREATE INDEX IF NOT EXISTS idx_learning_tasks_owner_created
      ON learning_tasks(ownerId, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_learning_tasks_owner_generation
      ON learning_tasks(ownerId, generationStatus, updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_learning_tasks_owner_subject_type
      ON learning_tasks(ownerId, subject, taskType, createdAt DESC);

    CREATE TABLE IF NOT EXISTS learning_task_links (
      taskId TEXT NOT NULL,
      entityType TEXT NOT NULL,
      entityId TEXT NOT NULL,
      role TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      PRIMARY KEY (taskId, entityType, entityId, role)
    );
    CREATE INDEX IF NOT EXISTS idx_learning_task_links_task
      ON learning_task_links(taskId, createdAt ASC);

    CREATE TABLE IF NOT EXISTS learning_task_events (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      eventType TEXT NOT NULL,
      detailJson TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_learning_task_events_task
      ON learning_task_events(taskId, createdAt ASC);

    CREATE TABLE IF NOT EXISTS retired_learning_content (
      ownerId TEXT NOT NULL,
      entityType TEXT NOT NULL,
      entityId TEXT NOT NULL,
      retiredAt INTEGER NOT NULL,
      PRIMARY KEY (ownerId, entityType, entityId)
    );
    CREATE INDEX IF NOT EXISTS idx_retired_learning_content_lookup
      ON retired_learning_content(ownerId, entityId);

    CREATE TABLE IF NOT EXISTS learning_package_progress (
      ownerId TEXT NOT NULL,
      packageId TEXT NOT NULL,
      completedPlays INTEGER NOT NULL DEFAULT 0,
      firstCompletedAt INTEGER,
      submittedAt INTEGER,
      updatedAt INTEGER NOT NULL,
      PRIMARY KEY (ownerId, packageId)
    );

    CREATE TABLE IF NOT EXISTS external_resources (
      id TEXT PRIMARY KEY,
      title TEXT,
      subject TEXT NOT NULL,
      grade TEXT NOT NULL,
      knowledgeTagsJson TEXT NOT NULL,
      url TEXT NOT NULL,
      sourceName TEXT NOT NULL,
      durationSeconds INTEGER,
      ageLabel TEXT,
      reviewedAt INTEGER,
      status TEXT NOT NULL,
      linkHealthStatus TEXT NOT NULL DEFAULT 'unknown',
      lastHealthCheckedAt INTEGER,
      embedStatus TEXT NOT NULL DEFAULT 'unknown',
      embedUrl TEXT,
      lastEmbedCheckedAt INTEGER,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_external_resources_lookup
      ON external_resources(subject, grade, status);

    CREATE TABLE IF NOT EXISTS style_profiles (
      id TEXT PRIMARY KEY,
      ownerId TEXT,
      sourceType TEXT NOT NULL,
      sourceUrl TEXT NOT NULL,
      capturedAt INTEGER NOT NULL,
      scopeJson TEXT NOT NULL,
      summaryJson TEXT NOT NULL,
      reviewStatus TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_style_profiles_owner_review
      ON style_profiles(ownerId, reviewStatus, capturedAt DESC);

    CREATE TABLE IF NOT EXISTS assessment_blueprints (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL,
      bookId TEXT NOT NULL,
      chapterIdsJson TEXT NOT NULL,
      examType TEXT NOT NULL,
      examMode TEXT NOT NULL DEFAULT 'textbook',
      olympiadBookId TEXT,
      difficulty TEXT NOT NULL,
      sectionsJson TEXT NOT NULL,
      styleProfileId TEXT,
      createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assessment_blueprints_owner_book
      ON assessment_blueprints(ownerId, bookId, createdAt DESC);

    CREATE TABLE IF NOT EXISTS assessment_papers (
      id TEXT PRIMARY KEY,
      blueprintId TEXT NOT NULL,
      ownerId TEXT NOT NULL,
      schemaVersion INTEGER NOT NULL,
      contentJson TEXT NOT NULL,
      totalScore REAL NOT NULL,
      status TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assessment_papers_owner_blueprint
      ON assessment_papers(ownerId, blueprintId, createdAt DESC);

    CREATE TABLE IF NOT EXISTS paper_attempts (
      id TEXT PRIMARY KEY,
      paperId TEXT NOT NULL,
      ownerId TEXT NOT NULL,
      answersJson TEXT NOT NULL,
      reviewSnapshotJson TEXT,
      status TEXT NOT NULL,
      diagnosticScore REAL,
      submittedAt INTEGER,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_paper_attempts_owner_paper
      ON paper_attempts(ownerId, paperId, createdAt DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_attempts_single_draft
      ON paper_attempts(ownerId, paperId) WHERE status = 'draft';

    CREATE TABLE IF NOT EXISTS attempt_item_results (
      attemptId TEXT NOT NULL,
      questionId TEXT NOT NULL,
      score REAL NOT NULL,
      maxScore REAL NOT NULL,
      rubricJson TEXT NOT NULL,
      evidenceJson TEXT NOT NULL,
      confidence REAL,
      verdict TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      PRIMARY KEY (attemptId, questionId)
    );
    CREATE INDEX IF NOT EXISTS idx_attempt_item_results_attempt
      ON attempt_item_results(attemptId);

    CREATE TABLE IF NOT EXISTS review_events (
      id TEXT PRIMARY KEY,
      attemptId TEXT NOT NULL,
      questionId TEXT NOT NULL,
      actorType TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      beforeJson TEXT NOT NULL,
      afterJson TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_review_events_attempt_question
      ON review_events(attemptId, questionId, createdAt DESC);

    CREATE TABLE IF NOT EXISTS answer_review_flags (
      ownerId TEXT NOT NULL,
      sourceType TEXT NOT NULL,
      sourceId TEXT NOT NULL,
      questionId TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      PRIMARY KEY (ownerId, sourceType, sourceId, questionId)
    );
    CREATE INDEX IF NOT EXISTS idx_answer_review_flags_source
      ON answer_review_flags(ownerId, sourceType, sourceId);

    CREATE TABLE IF NOT EXISTS export_jobs (
      id TEXT PRIMARY KEY,
      paperId TEXT NOT NULL,
      variant TEXT NOT NULL,
      status TEXT NOT NULL,
      filePath TEXT,
      error TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_export_jobs_paper_variant
      ON export_jobs(paperId, variant, createdAt DESC);
  `);

  // Why: deployed databases already have this table. The column is additive so
  // old playback records remain readable while the first-completion gate moves
  // from a play-count limit to a durable timestamp.
  const progressColumns = db.prepare('PRAGMA table_info(learning_package_progress)').all() as Array<{ name: string }>;
  if (!progressColumns.some(column => column.name === 'firstCompletedAt')) {
    db.exec('ALTER TABLE learning_package_progress ADD COLUMN firstCompletedAt INTEGER');
  }

  const attemptColumns = db.prepare('PRAGMA table_info(paper_attempts)').all() as Array<{ name: string }>;
  if (!attemptColumns.some(column => column.name === 'reviewSnapshotJson')) {
    db.exec('ALTER TABLE paper_attempts ADD COLUMN reviewSnapshotJson TEXT');
  }

  // Existing local databases may have the T-001 base table without the
  // externally visible resource metadata. Additive columns keep old rows
  // intact; they remain ineligible until a reviewer fills and verifies them.
  const resourceColumns = db.prepare('PRAGMA table_info(external_resources)').all() as Array<{ name: string }>;
  const existingColumns = new Set(resourceColumns.map(column => column.name));
  const additions = [
    ['title', 'TEXT'],
    ['durationSeconds', 'INTEGER'],
    ['ageLabel', 'TEXT'],
    ['linkHealthStatus', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['lastHealthCheckedAt', 'INTEGER'],
    ['embedStatus', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['embedUrl', 'TEXT'],
    ['lastEmbedCheckedAt', 'INTEGER'],
  ] as const;
  for (const [name, definition] of additions) {
    if (!existingColumns.has(name)) {
      db.exec(`ALTER TABLE external_resources ADD COLUMN ${name} ${definition}`);
    }
  }

  const blueprintColumns = db.prepare('PRAGMA table_info(assessment_blueprints)').all() as Array<{ name: string }>;
  const existingBlueprintColumns = new Set(blueprintColumns.map(column => column.name));
  const blueprintAdditions = [
    ['examMode', "TEXT NOT NULL DEFAULT 'textbook'"],
    ['olympiadBookId', 'TEXT'],
  ] as const;
  for (const [name, definition] of blueprintAdditions) {
    if (!existingBlueprintColumns.has(name)) {
      db.exec(`ALTER TABLE assessment_blueprints ADD COLUMN ${name} ${definition}`);
    }
  }
}
