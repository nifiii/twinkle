import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { parseLearningOwnerId } from './learningDomain.js';

export const LEARNING_TASK_TYPES = [
  'courseware',
  'classroom_quiz',
  'wrong_review',
  'english_listening',
  'video',
  'math_thinking',
  'assessment',
] as const;

export const LEARNING_TASK_GENERATION_STATUSES = [
  'queued',
  'running',
  'ready',
  'failed',
  'resource_unavailable',
] as const;

export const LEARNING_TASK_LEARNING_STATUSES = [
  'not_started',
  'in_progress',
  'completed',
] as const;

export type LearningTaskType = typeof LEARNING_TASK_TYPES[number];
export type LearningTaskGenerationStatus = typeof LEARNING_TASK_GENERATION_STATUSES[number];
export type LearningTaskLearningStatus = typeof LEARNING_TASK_LEARNING_STATUSES[number];
export type LearningTaskSourceType = 'chapter' | 'wrong_problems';
export type WrongProblemRef =
  | { source: 'scanned_item'; scannedItemId: string; problemIndex: number }
  | { source: 'quiz_result'; quizResultId: string; problemIndex: number };

export interface LearningTaskRecord {
  id: string;
  ownerId: string;
  requestKey: string;
  taskType: LearningTaskType;
  sourceType: LearningTaskSourceType;
  subject: string;
  grade: string;
  bookId: string | null;
  chapterIds: string[];
  wrongProblemRefs: WrongProblemRef[];
  title: string;
  generationStatus: LearningTaskGenerationStatus;
  learningStatus: LearningTaskLearningStatus;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateLearningTaskInput {
  ownerId: unknown;
  requestKey: unknown;
  taskType: unknown;
  sourceType: unknown;
  subject: unknown;
  grade: unknown;
  title: unknown;
  bookId?: unknown;
  chapterIds?: unknown;
  wrongProblemRefs?: unknown;
}

export interface LearningTaskLinkInput {
  entityType: string;
  entityId: string;
  role: 'primary' | 'explanation' | 'practice' | 'resource' | 'paper';
}

export class LearningTaskValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = 'LearningTaskValidationError';
  }
}

interface LearningTaskRow {
  id: string;
  ownerId: string;
  requestKey: string;
  taskType: LearningTaskType;
  sourceType: LearningTaskSourceType;
  subject: string;
  grade: string;
  bookId: string | null;
  chapterIdsJson: string;
  wrongProblemRefsJson: string;
  title: string;
  generationStatus: LearningTaskGenerationStatus;
  learningStatus: LearningTaskLearningStatus;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
}

function requireText(value: unknown, field: string, label: string, maxLength = 256): string {
  if (typeof value !== 'string') throw new LearningTaskValidationError(field, `${label}不能为空`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new LearningTaskValidationError(field, `${label}不能为空或过长`);
  return normalized;
}

function parseTaskType(value: unknown): LearningTaskType {
  if (typeof value !== 'string' || !LEARNING_TASK_TYPES.includes(value as LearningTaskType)) {
    throw new LearningTaskValidationError('taskType', '学习任务类型不支持');
  }
  return value as LearningTaskType;
}

function parseSourceType(value: unknown): LearningTaskSourceType {
  if (value !== 'chapter' && value !== 'wrong_problems') {
    throw new LearningTaskValidationError('sourceType', '学习任务来源不支持');
  }
  return value;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new LearningTaskValidationError(field, '列表格式不正确');
  }
  return [...new Set(value.map(item => item.trim()))];
}

function parseWrongProblemRefs(value: unknown): WrongProblemRef[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new LearningTaskValidationError('wrongProblemRefs', '错题引用格式不正确');
  const refs = value.map((item): WrongProblemRef => {
    if (!item || typeof item !== 'object') throw new LearningTaskValidationError('wrongProblemRefs', '错题引用格式不正确');
    const source = item as { source?: unknown; scannedItemId?: unknown; quizResultId?: unknown; problemIndex?: unknown };
    if (!Number.isInteger(source.problemIndex) || (source.problemIndex as number) < 0) {
      throw new LearningTaskValidationError('wrongProblemRefs', '错题序号不正确');
    }
    // Existing T-001 records did not need a source discriminator. Treat that
    // persisted shape as a scanned-item reference so old tasks remain readable.
    if (source.source === undefined || source.source === 'scanned_item') {
      return {
        source: 'scanned_item',
        scannedItemId: requireText(source.scannedItemId, 'wrongProblemRefs', '错题本来源'),
        problemIndex: source.problemIndex as number,
      };
    }
    if (source.source === 'quiz_result') {
      return {
        source: 'quiz_result',
        quizResultId: requireText(source.quizResultId, 'wrongProblemRefs', '课堂作答来源'),
        problemIndex: source.problemIndex as number,
      };
    }
    throw new LearningTaskValidationError('wrongProblemRefs', '错题来源类型不支持');
  });
  const unique = new Map(refs.map(ref => [
    ref.source === 'scanned_item'
      ? `${ref.source}:${ref.scannedItemId}:${ref.problemIndex}`
      : `${ref.source}:${ref.quizResultId}:${ref.problemIndex}`,
    ref,
  ]));
  return [...unique.values()];
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toRecord(row: LearningTaskRow): LearningTaskRecord {
  return {
    ...row,
    chapterIds: parseJson<string[]>(row.chapterIdsJson, []),
    wrongProblemRefs: parseWrongProblemRefs(parseJson<unknown[]>(row.wrongProblemRefsJson, [])),
  };
}

function getTask(database: Database.Database, taskId: string): LearningTaskRow | undefined {
  return database.prepare('SELECT * FROM learning_tasks WHERE id = ?').get(taskId) as LearningTaskRow | undefined;
}

export function getLearningTask(database: Database.Database, taskId: string, ownerId: unknown): LearningTaskRecord | null {
  const owner = parseLearningOwnerId(ownerId);
  const row = database.prepare('SELECT * FROM learning_tasks WHERE id = ? AND ownerId = ?').get(taskId, owner) as LearningTaskRow | undefined;
  return row ? toRecord(row) : null;
}

export function listLearningTasks(database: Database.Database, ownerId: unknown): LearningTaskRecord[] {
  const owner = parseLearningOwnerId(ownerId);
  const rows = database.prepare('SELECT * FROM learning_tasks WHERE ownerId = ? ORDER BY updatedAt DESC, id DESC').all(owner) as LearningTaskRow[];
  return rows.map(toRecord);
}

function appendEvent(database: Database.Database, taskId: string, eventType: string, detail: Record<string, unknown>, createdAt: number): void {
  database.prepare(`
    INSERT INTO learning_task_events (id, taskId, eventType, detailJson, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), taskId, eventType, JSON.stringify(detail), createdAt);
}

export function createLearningTask(database: Database.Database, input: CreateLearningTaskInput, now = Date.now()): { task: LearningTaskRecord; created: boolean } {
  const ownerId = parseLearningOwnerId(input.ownerId);
  const requestKey = requireText(input.requestKey, 'requestKey', '请求标识', 128);
  const taskType = parseTaskType(input.taskType);
  const sourceType = parseSourceType(input.sourceType);
  const subject = requireText(input.subject, 'subject', '学科', 64);
  const grade = requireText(input.grade, 'grade', '年级', 64);
  const title = requireText(input.title, 'title', '任务标题', 256);
  const bookId = input.bookId === undefined || input.bookId === null ? null : requireText(input.bookId, 'bookId', '教材');
  const chapterIds = parseStringArray(input.chapterIds, 'chapterIds');
  const wrongProblemRefs = parseWrongProblemRefs(input.wrongProblemRefs);

  if (sourceType === 'chapter' && (!bookId || chapterIds.length === 0 || wrongProblemRefs.length > 0)) {
    throw new LearningTaskValidationError('sourceType', '教材任务必须包含教材和章节，且不能包含错题引用');
  }
  if (sourceType === 'wrong_problems' && (bookId || chapterIds.length > 0 || wrongProblemRefs.length === 0)) {
    throw new LearningTaskValidationError('sourceType', '错题任务必须包含错题引用，且不能包含教材章节');
  }

  const existing = database.prepare('SELECT * FROM learning_tasks WHERE ownerId = ? AND requestKey = ?').get(ownerId, requestKey) as LearningTaskRow | undefined;
  if (existing) return { task: toRecord(existing), created: false };

  const id = randomUUID();
  const create = database.transaction(() => {
    database.prepare(`
      INSERT INTO learning_tasks (
        id, ownerId, requestKey, taskType, sourceType, subject, grade, bookId,
        chapterIdsJson, wrongProblemRefsJson, title, generationStatus, learningStatus,
        createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'not_started', ?, ?)
    `).run(
      id, ownerId, requestKey, taskType, sourceType, subject, grade, bookId,
      JSON.stringify(chapterIds), JSON.stringify(wrongProblemRefs), title, now, now,
    );
    appendEvent(database, id, 'created', { taskType, sourceType }, now);
  });
  create();

  const created = getTask(database, id);
  if (!created) throw new Error('学习任务创建后无法读取');
  return { task: toRecord(created), created: true };
}

export function updateLearningTaskGenerationStatus(
  database: Database.Database,
  taskId: string,
  status: Exclude<LearningTaskGenerationStatus, 'ready'>,
  options: { errorCode?: string; errorMessage?: string; now?: number } = {},
): LearningTaskRecord {
  const task = getTask(database, taskId);
  if (!task) throw new LearningTaskValidationError('taskId', '学习任务不存在');
  const allowed: Record<LearningTaskGenerationStatus, LearningTaskGenerationStatus[]> = {
    queued: ['running', 'failed', 'resource_unavailable'],
    running: ['failed', 'resource_unavailable'],
    ready: [],
    failed: ['queued'],
    resource_unavailable: ['queued'],
  };
  if (!allowed[task.generationStatus].includes(status)) {
    throw new LearningTaskValidationError('generationStatus', '学习任务状态不能这样变更');
  }
  const now = options.now ?? Date.now();
  database.transaction(() => {
    database.prepare(`
      UPDATE learning_tasks
      SET generationStatus = ?, errorCode = ?, errorMessage = ?, updatedAt = ?
      WHERE id = ?
    `).run(status, options.errorCode ?? null, options.errorMessage ?? null, now, taskId);
    appendEvent(database, taskId, status, {
      errorCode: options.errorCode ?? null,
      errorMessage: options.errorMessage ?? null,
    }, now);
  })();
  const updated = getTask(database, taskId);
  if (!updated) throw new Error('学习任务状态更新后无法读取');
  return toRecord(updated);
}

export function completeLearningTask(
  database: Database.Database,
  taskId: string,
  links: LearningTaskLinkInput[],
  now = Date.now(),
): LearningTaskRecord {
  const task = getTask(database, taskId);
  if (!task) throw new LearningTaskValidationError('taskId', '学习任务不存在');
  if (task.generationStatus !== 'running') {
    throw new LearningTaskValidationError('generationStatus', '只有生成中的任务可以完成');
  }
  if (links.length === 0 || links.some(link => !link.entityType.trim() || !link.entityId.trim())) {
    throw new LearningTaskValidationError('links', '学习任务缺少原内容链接');
  }

  database.transaction(() => {
    const insert = database.prepare(`
      INSERT INTO learning_task_links (taskId, entityType, entityId, role, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const link of links) insert.run(taskId, link.entityType, link.entityId, link.role, now);
    database.prepare(`
      UPDATE learning_tasks
      SET generationStatus = 'ready', errorCode = NULL, errorMessage = NULL, updatedAt = ?
      WHERE id = ?
    `).run(now, taskId);
    appendEvent(database, taskId, 'ready', { linkCount: links.length }, now);
  })();
  const completed = getTask(database, taskId);
  if (!completed) throw new Error('学习任务完成后无法读取');
  return toRecord(completed);
}

export function retryLearningTask(database: Database.Database, taskId: string, ownerId: unknown, now = Date.now()): LearningTaskRecord {
  const task = getLearningTask(database, taskId, ownerId);
  if (!task) throw new LearningTaskValidationError('taskId', '学习任务不存在');
  if (task.generationStatus !== 'failed' && task.generationStatus !== 'resource_unavailable') {
    throw new LearningTaskValidationError('generationStatus', '当前学习任务不能重试');
  }
  const linkCount = database.prepare('SELECT COUNT(*) AS count FROM learning_task_links WHERE taskId = ?').get(taskId) as { count: number };
  if (linkCount.count > 0) throw new LearningTaskValidationError('generationStatus', '已有学习内容的任务不能重试');
  database.transaction(() => {
    database.prepare(`
      UPDATE learning_tasks
      SET generationStatus = 'queued', errorCode = NULL, errorMessage = NULL, updatedAt = ?
      WHERE id = ?
    `).run(now, taskId);
    appendEvent(database, taskId, 'retry_requested', {}, now);
  })();
  const retried = getTask(database, taskId);
  if (!retried) throw new Error('学习任务重试后无法读取');
  return toRecord(retried);
}
