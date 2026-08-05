import Database from 'better-sqlite3';
import { expireStaleLearningTasks, getLearningTask, LearningTaskLinkInput, LearningTaskRecord, listLearningTasks, WrongProblemRef } from './learningTaskService.js';
import { parseLearningOwnerId } from './learningDomain.js';

const PRIMARY_LINK_ORDER = ['primary', 'explanation', 'practice', 'resource', 'paper'];
const LEGACY_ENTITY_TYPES = [
  'classroom_courseware',
  'classroom_quiz',
  'learning_package',
  'assessment_paper',
  'quiz_result',
] as const;

type LegacyEntityType = typeof LEGACY_ENTITY_TYPES[number];

interface BookRow {
  id: string;
  title: string;
  subject: string | null;
  grade: string | null;
  tableOfContents: string | null;
}

interface TaskLink extends LearningTaskLinkInput {
  createdAt: number;
}

interface TaskEvent {
  eventType: string;
  detail: Record<string, unknown>;
  createdAt: number;
}

export interface ClassroomTaskSummary {
  id: string;
  source: 'task' | 'legacy';
  taskType: string;
  title: string;
  subject: string;
  grade: string | null;
  book: { id: string; title: string } | null;
  chapterTitles: string[];
  generationStatus: string;
  learningStatus: string;
  createdAt: number;
  updatedAt: number;
  primaryLink: TaskLink | null;
}

export interface ClassroomTaskDetail extends ClassroomTaskSummary {
  sourceSnapshot: {
    sourceType: 'chapter' | 'olympiad' | 'wrong_problems' | 'legacy';
    bookId?: string;
    chapterIds?: string[];
    wrongProblemRefs?: WrongProblemRef[];
  };
  links: TaskLink[];
  events: TaskEvent[];
  errorCode: string | null;
  errorMessage: string | null;
  videoResource: null;
}

export interface ClassroomTaskFilters {
  generationStatus?: string;
  subject?: string;
  taskType?: string;
  bookId?: string;
  cursor?: string;
  limit?: number;
}

export interface ClassroomTaskPage {
  items: ClassroomTaskSummary[];
  nextCursor: string | null;
}

function parseJson<T>(value: string | null, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function chapterTitles(book: BookRow | null, chapterIds: string[]): string[] {
  if (!book) return [];
  const nodes = parseJson<Array<{ id?: string | number; title?: string; children?: unknown }>>(book.tableOfContents, []);
  const found = new Map<string, string>();
  const visit = (items: Array<{ id?: string | number; title?: string; children?: unknown }>) => {
    for (const item of items) {
      if ((typeof item.id === 'string' || typeof item.id === 'number') && typeof item.title === 'string') found.set(String(item.id), item.title);
      if (Array.isArray(item.children)) visit(item.children as Array<{ id?: string | number; title?: string; children?: unknown }>);
    }
  };
  visit(nodes);
  return chapterIds.map(id => found.get(id)).filter((title): title is string => Boolean(title));
}

function findBook(database: Database.Database, ownerId: string, bookId: string | null): BookRow | null {
  if (!bookId) return null;
  return database.prepare(`
    SELECT id, title, subject, grade, tableOfContents
    FROM books WHERE id = ? AND (ownerId = ? OR ownerId = 'shared')
  `).get(bookId, ownerId) as BookRow | undefined || null;
}

function readTaskLinks(database: Database.Database, taskId: string): TaskLink[] {
  return database.prepare(`
    SELECT entityType, entityId, role, createdAt
    FROM learning_task_links WHERE taskId = ? ORDER BY createdAt ASC
  `).all(taskId) as TaskLink[];
}

function selectPrimaryLink(links: TaskLink[]): TaskLink | null {
  return [...links].sort((left, right) => PRIMARY_LINK_ORDER.indexOf(left.role) - PRIMARY_LINK_ORDER.indexOf(right.role))[0] || null;
}

function toTaskSummary(database: Database.Database, task: LearningTaskRecord): ClassroomTaskSummary {
  const book = findBook(database, task.ownerId, task.bookId);
  const links = readTaskLinks(database, task.id);
  const primaryLink = selectPrimaryLink(links);
  return {
    id: task.id,
    source: 'task',
    taskType: task.taskType,
    title: task.title,
    subject: task.subject,
    grade: task.grade,
    book: book ? { id: book.id, title: book.title } : null,
    chapterTitles: chapterTitles(book, task.chapterIds),
    generationStatus: task.generationStatus,
    learningStatus: task.learningStatus,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    primaryLink,
  };
}

function packageTaskType(kind: string): string {
  if (kind === 'english-listening') return 'english_listening';
  if (kind === 'math-thinking') return 'math_thinking';
  if (kind.endsWith('-video')) return 'video';
  return 'courseware';
}

function hasTable(database: Database.Database, name: string): boolean {
  return Boolean(database.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name));
}

function legacySummaries(database: Database.Database, ownerId: string): ClassroomTaskSummary[] {
  const classroom = database.prepare(`
    SELECT id, type, bookTitle, chapter, subject, createdAt
    FROM classroom_items WHERE ownerId = ?
  `).all(ownerId) as Array<{ id: string; type: 'courseware' | 'quiz'; bookTitle: string; chapter: string; subject: string; createdAt: number }>;
  const packages = database.prepare(`
    SELECT package.id, package.kind, package.bookId, package.chapterIdsJson, package.status,
           package.createdAt, package.updatedAt, book.title AS bookTitle, book.subject, book.grade, book.tableOfContents
    FROM learning_packages package
    LEFT JOIN books book ON book.id = package.bookId AND (book.ownerId = ? OR book.ownerId = 'shared')
    WHERE package.ownerId = ?
  `).all(ownerId, ownerId) as Array<{
    id: string; kind: string; bookId: string; chapterIdsJson: string; status: string; createdAt: number; updatedAt: number;
    bookTitle: string | null; subject: string | null; grade: string | null; tableOfContents: string | null;
  }>;
  const papers = database.prepare(`
    SELECT paper.id, paper.status, paper.createdAt, blueprint.bookId,
           book.title AS bookTitle, book.subject, book.grade, book.tableOfContents, blueprint.chapterIdsJson
    FROM assessment_papers paper
    JOIN assessment_blueprints blueprint ON blueprint.id = paper.blueprintId
    LEFT JOIN books book ON book.id = blueprint.bookId AND (book.ownerId = ? OR book.ownerId = 'shared')
    WHERE paper.ownerId = ?
  `).all(ownerId, ownerId) as Array<{
    id: string; status: string; createdAt: number; bookId: string; bookTitle: string | null;
    subject: string | null; grade: string | null; tableOfContents: string | null; chapterIdsJson: string;
  }>;
  const quizResults = hasTable(database, 'quiz_results')
    ? database.prepare(`
      SELECT id, quizId, bookTitle, chapter, subject, status, createdAt
      FROM quiz_results WHERE ownerId = ?
    `).all(ownerId) as Array<{
      id: string; quizId: string; bookTitle: string; chapter: string; subject: string;
      status: string; createdAt: number;
    }>
    : [];

  return [
    ...classroom.map(item => ({
      id: `legacy:classroom_${item.type === 'quiz' ? 'quiz' : 'courseware'}:${item.id}`,
      source: 'legacy' as const,
      taskType: item.type === 'quiz' ? 'classroom_quiz' : 'courseware',
      title: `${item.bookTitle}·${item.chapter}`,
      subject: item.subject,
      grade: null,
      book: null,
      chapterTitles: item.chapter ? [item.chapter] : [],
      generationStatus: 'ready',
      learningStatus: 'not_started',
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
      primaryLink: { entityType: `classroom_${item.type === 'quiz' ? 'quiz' : 'courseware'}`, entityId: item.id, role: 'primary' as const, createdAt: item.createdAt },
    })),
    ...packages.map(item => {
      const book: BookRow | null = item.bookTitle ? {
        id: item.bookId, title: item.bookTitle, subject: item.subject, grade: item.grade, tableOfContents: item.tableOfContents,
      } : null;
      return {
        id: `legacy:learning_package:${item.id}`,
        source: 'legacy' as const,
        taskType: packageTaskType(item.kind),
        title: `${book?.title || '学习资料'}·${item.kind}`,
        subject: item.subject || '',
        grade: item.grade,
        book: book ? { id: book.id, title: book.title } : null,
        chapterTitles: chapterTitles(book, parseJson<string[]>(item.chapterIdsJson, [])),
        generationStatus: item.status === 'completed' ? 'ready' : item.status,
        learningStatus: 'not_started',
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        primaryLink: { entityType: 'learning_package', entityId: item.id, role: 'primary' as const, createdAt: item.createdAt },
      };
    }),
    ...papers.map(item => {
      const book: BookRow | null = item.bookTitle ? {
        id: item.bookId, title: item.bookTitle, subject: item.subject, grade: item.grade, tableOfContents: item.tableOfContents,
      } : null;
      return {
        id: `legacy:assessment_paper:${item.id}`,
        source: 'legacy' as const,
        taskType: 'assessment',
        title: `${book?.title || '模拟考试'}·模拟考试`,
        subject: item.subject || '',
        grade: item.grade,
        book: book ? { id: book.id, title: book.title } : null,
        chapterTitles: chapterTitles(book, parseJson<string[]>(item.chapterIdsJson, [])),
        generationStatus: item.status === 'completed' ? 'ready' : item.status,
        learningStatus: 'not_started',
        createdAt: item.createdAt,
        updatedAt: item.createdAt,
        primaryLink: { entityType: 'assessment_paper', entityId: item.id, role: 'paper' as const, createdAt: item.createdAt },
      };
    }),
    ...quizResults.map(item => ({
      id: `legacy:quiz_result:${item.id}`,
      source: 'legacy' as const,
      taskType: 'quiz_result',
      title: `${item.bookTitle || '课堂测验'}·${item.chapter || '测验记录'}`,
      subject: item.subject || '',
      grade: null,
      book: null,
      chapterTitles: item.chapter ? [item.chapter] : [],
      generationStatus: item.status === 'completed' ? 'ready' : item.status,
      learningStatus: 'completed',
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
      primaryLink: { entityType: 'quiz_result', entityId: item.id, role: 'primary' as const, createdAt: item.createdAt },
    })),
  ];
}

function matchesFilters(item: ClassroomTaskSummary, filters: ClassroomTaskFilters): boolean {
  return (!filters.generationStatus || item.generationStatus === filters.generationStatus)
    && (!filters.subject || item.subject === filters.subject)
    && (!filters.taskType || item.taskType === filters.taskType)
    && (!filters.bookId || item.book?.id === filters.bookId);
}

function encodeCursor(item: ClassroomTaskSummary): string {
  return Buffer.from(JSON.stringify({ updatedAt: item.updatedAt, id: item.id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): { updatedAt: number; id: string } | null {
  if (!cursor) return null;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { updatedAt?: unknown; id?: unknown };
    return typeof decoded.updatedAt === 'number' && typeof decoded.id === 'string' ? { updatedAt: decoded.updatedAt, id: decoded.id } : null;
  } catch {
    return null;
  }
}

function afterCursor(item: ClassroomTaskSummary, cursor: { updatedAt: number; id: string } | null): boolean {
  return !cursor || item.updatedAt < cursor.updatedAt || (item.updatedAt === cursor.updatedAt && item.id > cursor.id);
}

export function listClassroomTasks(database: Database.Database, ownerId: unknown, filters: ClassroomTaskFilters = {}): ClassroomTaskPage {
  const owner = parseLearningOwnerId(ownerId);
  const limit = Math.min(Math.max(filters.limit || 20, 1), 100);
  const cursor = decodeCursor(filters.cursor);
  expireStaleLearningTasks(database, owner);
  const tasks = listLearningTasks(database, owner).map(task => toTaskSummary(database, task));
  // New tasks reference the original entity directly. Keep legacy rows only for entities
  // that have not yet been adopted, otherwise students see the same work twice.
  const linkedTargets = new Set(tasks.flatMap(task => readTaskLinks(database, task.id))
    .map(link => `${link.entityType}:${link.entityId}`));
  const items = [
    ...tasks,
    ...legacySummaries(database, owner).filter(item => !item.primaryLink || !linkedTargets.has(`${item.primaryLink.entityType}:${item.primaryLink.entityId}`)),
  ]
    .filter(item => matchesFilters(item, filters))
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .filter(item => afterCursor(item, cursor));
  const page = items.slice(0, limit);
  return { items: page, nextCursor: items.length > limit ? encodeCursor(page[page.length - 1]) : null };
}

export function parseLegacyTaskReference(taskId: string): { entityType: LegacyEntityType; entityId: string } | null {
  const match = /^legacy:(classroom_courseware|classroom_quiz|learning_package|assessment_paper|quiz_result):(.+)$/.exec(taskId);
  return match && LEGACY_ENTITY_TYPES.includes(match[1] as LegacyEntityType)
    ? { entityType: match[1] as LegacyEntityType, entityId: match[2] }
    : null;
}

function legacyDetail(database: Database.Database, ownerId: string, taskId: string): ClassroomTaskDetail | null {
  const parsed = parseLegacyTaskReference(taskId);
  if (!parsed) return null;
  const summary = legacySummaries(database, ownerId).find(item => item.id === taskId);
  if (!summary) return null;
  return {
    ...summary,
    sourceSnapshot: { sourceType: 'legacy' },
    links: summary.primaryLink ? [summary.primaryLink] : [],
    events: [],
    errorCode: null,
    errorMessage: null,
    videoResource: null,
  };
}

export function learningTaskTargetExists(database: Database.Database, ownerId: unknown, link: Pick<TaskLink, 'entityType' | 'entityId'>): boolean {
  const owner = parseLearningOwnerId(ownerId);
  const tableByEntityType: Record<string, { table: string; type?: string }> = {
    classroom_courseware: { table: 'classroom_items', type: 'courseware' },
    classroom_quiz: { table: 'classroom_items', type: 'quiz' },
    learning_package: { table: 'learning_packages' },
    assessment_paper: { table: 'assessment_papers' },
    quiz_result: { table: 'quiz_results' },
    external_resource: { table: 'external_resources' },
  };
  const target = tableByEntityType[link.entityType];
  if (!target) return false;
  if (target.table === 'external_resources') {
    return false;
  }
  const row = target.type
    ? database.prepare(`SELECT id FROM ${target.table} WHERE id = ? AND ownerId = ? AND type = ?`).get(link.entityId, owner, target.type)
    : database.prepare(`SELECT id FROM ${target.table} WHERE id = ? AND ownerId = ?`).get(link.entityId, owner);
  return Boolean(row);
}

export function getClassroomTask(database: Database.Database, taskId: string, ownerId: unknown): ClassroomTaskDetail | null {
  const owner = parseLearningOwnerId(ownerId);
  if (taskId.startsWith('legacy:')) return legacyDetail(database, owner, taskId);
  const task = getLearningTask(database, taskId, owner);
  if (!task) return null;
  const summary = toTaskSummary(database, task);
  const links = readTaskLinks(database, task.id);
  const events = database.prepare(`
    SELECT eventType, detailJson, createdAt FROM learning_task_events
    WHERE taskId = ? ORDER BY createdAt DESC LIMIT 10
  `).all(task.id).map(row => {
    const event = row as { eventType: string; detailJson: string; createdAt: number };
    return { eventType: event.eventType, detail: parseJson<Record<string, unknown>>(event.detailJson, {}), createdAt: event.createdAt };
  });
  return {
    ...summary,
    sourceSnapshot: task.sourceType === 'chapter'
      ? { sourceType: 'chapter', bookId: task.bookId || undefined, chapterIds: task.chapterIds }
      : task.sourceType === 'olympiad'
        ? { sourceType: 'olympiad', bookId: task.bookId || undefined }
        : { sourceType: 'wrong_problems', wrongProblemRefs: task.wrongProblemRefs },
    links,
    events,
    errorCode: task.taskType === 'video' ? 'video_discontinued' : task.errorCode,
    errorMessage: task.taskType === 'video' ? '视频学习已取消，历史任务仅保留记录，不再提供播放。' : task.errorMessage,
    videoResource: null,
  };
}
