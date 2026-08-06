import Database from 'better-sqlite3';
import { parseLearningOwnerId } from './learningDomain.js';
import { LearningTaskValidationError, LearningTaskRecord, getLearningTask, listLearningTasks } from './learningTaskService.js';

type GeneratedEntityType = 'classroom_courseware' | 'classroom_quiz' | 'learning_package' | 'assessment_paper';
type TaskLink = { entityType: GeneratedEntityType; entityId: string; role: 'primary' | 'explanation' | 'practice' | 'resource' | 'paper'; createdAt: number };
type BookRow = { id: string; title: string; tableOfContents: string | null };

export type GeneratedMaterial = {
  taskId: string;
  taskType: string;
  title: string;
  subject: string;
  book: { id: string; title: string } | null;
  chapterTitles: string[];
  learningStatus: 'not_started' | 'in_progress' | 'completed';
  createdAt: number;
  primaryLink: TaskLink;
};

export class GeneratedMaterialError extends Error {
  constructor(public readonly code: 'invalid_source' | 'shared_generated_content' | 'review_snapshot_incomplete' | 'learning_content_retired', message: string) {
    super(message);
  }
}

function json<T>(value: string | null, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function chapterTitles(book: BookRow | null, chapterIds: string[]): string[] {
  if (!book) return [];
  const found = new Map<string, string>();
  const visit = (nodes: Array<{ id?: string | number; title?: string; children?: unknown }>) => nodes.forEach(node => {
    if ((typeof node.id === 'string' || typeof node.id === 'number') && typeof node.title === 'string') found.set(String(node.id), node.title);
    if (Array.isArray(node.children)) visit(node.children as Array<{ id?: string | number; title?: string; children?: unknown }>);
  });
  visit(json(book.tableOfContents, []));
  return chapterIds.map(id => found.get(id)).filter((title): title is string => Boolean(title));
}

function linksFor(database: Database.Database, taskId: string): TaskLink[] {
  return database.prepare(`SELECT entityType, entityId, role, createdAt FROM learning_task_links WHERE taskId = ? ORDER BY createdAt ASC`)
    .all(taskId) as TaskLink[];
}

function primaryLink(links: TaskLink[]): TaskLink | null {
  return links.find(link => link.role === 'primary' || link.role === 'paper') || null;
}

function entityExists(database: Database.Database, ownerId: string, link: Pick<TaskLink, 'entityType' | 'entityId'>): boolean {
  const targets: Record<GeneratedEntityType, { table: string; type?: string }> = {
    classroom_courseware: { table: 'classroom_items', type: 'courseware' },
    classroom_quiz: { table: 'classroom_items', type: 'quiz' },
    learning_package: { table: 'learning_packages' },
    assessment_paper: { table: 'assessment_papers' },
  };
  const target = targets[link.entityType];
  if (!target) return false;
  const row = target.type
    ? database.prepare(`SELECT 1 FROM ${target.table} WHERE id = ? AND ownerId = ? AND type = ?`).get(link.entityId, ownerId, target.type)
    : database.prepare(`SELECT 1 FROM ${target.table} WHERE id = ? AND ownerId = ?`).get(link.entityId, ownerId);
  return Boolean(row);
}

function hasCompletedQuiz(database: Database.Database, ownerId: string, links: TaskLink[]): boolean {
  const quizIds = links.filter(link => link.entityType === 'classroom_quiz').map(link => link.entityId);
  return quizIds.some(quizId => Boolean(database.prepare(`SELECT 1 FROM quiz_results WHERE ownerId = ? AND quizId = ? AND status IN ('submitted', 'completed') LIMIT 1`).get(ownerId, quizId)));
}

function resolvedLearningStatus(database: Database.Database, task: LearningTaskRecord, links: TaskLink[]): GeneratedMaterial['learningStatus'] {
  if (task.learningStatus === 'completed') return 'completed';
  if (hasCompletedQuiz(database, task.ownerId, links)) return 'completed';
  const paperIds = links.filter(link => link.entityType === 'assessment_paper').map(link => link.entityId);
  if (paperIds.some(id => Boolean(database.prepare(`SELECT 1 FROM paper_attempts WHERE ownerId = ? AND paperId = ? AND status = 'submitted' LIMIT 1`).get(task.ownerId, id)))) return 'completed';
  const packageIds = links.filter(link => link.entityType === 'learning_package').map(link => link.entityId);
  if (packageIds.some(id => Boolean(database.prepare(`SELECT 1 FROM learning_package_progress WHERE ownerId = ? AND packageId = ? AND submittedAt IS NOT NULL LIMIT 1`).get(task.ownerId, id)))) return 'completed';
  const coursewareIds = links.filter(link => link.entityType === 'classroom_courseware').map(link => link.entityId);
  if (coursewareIds.some(id => Boolean(database.prepare(`SELECT 1 FROM classroom_items WHERE id = ? AND ownerId = ? AND lastStudiedAt IS NOT NULL LIMIT 1`).get(id, task.ownerId)))) return 'in_progress';
  return task.learningStatus;
}

function cursorValue(item: GeneratedMaterial): string {
  return Buffer.from(JSON.stringify({ createdAt: item.createdAt, taskId: item.taskId }), 'utf8').toString('base64url');
}

function readCursor(value: string | undefined): { createdAt: number; taskId: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { createdAt?: unknown; taskId?: unknown };
    return typeof parsed.createdAt === 'number' && typeof parsed.taskId === 'string' ? { createdAt: parsed.createdAt, taskId: parsed.taskId } : null;
  } catch { return null; }
}

export function listGeneratedLearningMaterials(
  database: Database.Database,
  ownerIdInput: unknown,
  filters: { subject?: string; progress?: 'all' | 'pending' | 'completed'; cursor?: string; limit?: number } = {},
): { items: GeneratedMaterial[]; nextCursor: string | null } {
  const ownerId = parseLearningOwnerId(ownerIdInput);
  const progress = filters.progress || 'all';
  if (!['all', 'pending', 'completed'].includes(progress)) throw new LearningTaskValidationError('progress', '学习进度筛选不支持');
  const limit = Math.min(Math.max(filters.limit || 20, 1), 100);
  const cursor = readCursor(filters.cursor);
  const candidates: Array<GeneratedMaterial | null> = listLearningTasks(database, ownerId)
    .filter(task => task.generationStatus === 'ready' && task.taskType !== 'video')
    .map((task): GeneratedMaterial | null => {
      const links = linksFor(database, task.id);
      const primary = primaryLink(links);
      if (!primary || !entityExists(database, ownerId, primary)) return null;
      const book = task.bookId
        ? database.prepare(`SELECT id, title, tableOfContents FROM books WHERE id = ? AND (ownerId = ? OR ownerId = 'shared')`).get(task.bookId, ownerId) as BookRow | undefined
        : undefined;
      return {
        taskId: task.id, taskType: task.taskType, title: task.title, subject: task.subject,
        book: book ? { id: book.id, title: book.title } : null,
        chapterTitles: chapterTitles(book || null, task.chapterIds),
        learningStatus: resolvedLearningStatus(database, task, links), createdAt: task.createdAt, primaryLink: primary,
      };
    })
    .filter((item): item is GeneratedMaterial => Boolean(item))
    .filter(item => !filters.subject || item.subject === filters.subject)
    .filter(item => progress === 'all' || (progress === 'completed' ? item.learningStatus === 'completed' : item.learningStatus !== 'completed'))
    .sort((left, right) => right.createdAt - left.createdAt || left.taskId.localeCompare(right.taskId))
    .filter(item => !cursor || item.createdAt < cursor.createdAt || (item.createdAt === cursor.createdAt && item.taskId > cursor.taskId));
  const items = candidates.filter((item): item is GeneratedMaterial => Boolean(item));
  const page = items.slice(0, limit);
  return { items: page, nextCursor: items.length > limit ? cursorValue(page[page.length - 1]) : null };
}

function nonEmptyReviewSnapshot(value: string | null): boolean {
  const items = json<Array<Record<string, unknown>>>(value, []);
  return items.length > 0 && items.every(item => ['question', 'studentAnswer', 'referenceAnswer', 'explanation'].every(field => typeof item[field] === 'string'));
}

function validateReviewRetention(database: Database.Database, ownerId: string, links: TaskLink[]): void {
  for (const link of links) {
    if (link.entityType === 'assessment_paper') {
      const attempts = database.prepare(`SELECT status, reviewSnapshotJson FROM paper_attempts WHERE ownerId = ? AND paperId = ?`).all(ownerId, link.entityId) as Array<{ status: string; reviewSnapshotJson: string | null }>;
      if (attempts.some(attempt => attempt.status !== 'submitted' || !nonEmptyReviewSnapshot(attempt.reviewSnapshotJson))) {
        throw new GeneratedMaterialError('review_snapshot_incomplete', '该试卷仍有未完成作答或缺少作答回顾快照，暂不能删除学习资料');
      }
    }
    if (link.entityType === 'learning_package') {
      const progress = database.prepare(`SELECT 1 FROM learning_package_progress WHERE ownerId = ? AND packageId = ? AND (submittedAt IS NOT NULL OR completedPlays > 0) LIMIT 1`).get(ownerId, link.entityId);
      if (progress) throw new GeneratedMaterialError('review_snapshot_incomplete', '该听力已有学习记录，当前版本无法独立保留其作答回顾，暂不能删除学习资料');
    }
    if (link.entityType === 'classroom_quiz') {
      const results = database.prepare(`SELECT resultsJson FROM quiz_results WHERE ownerId = ? AND quizId = ?`).all(ownerId, link.entityId) as Array<{ resultsJson: string | null }>;
      if (results.some(result => !nonEmptyReviewSnapshot(result.resultsJson))) {
        throw new GeneratedMaterialError('review_snapshot_incomplete', '该随堂测验缺少完整作答回顾快照，暂不能删除学习资料');
      }
    }
  }
}

function retire(database: Database.Database, ownerId: string, entityType: string, entityId: string, retiredAt: number): void {
  database.prepare(`INSERT OR IGNORE INTO retired_learning_content (ownerId, entityType, entityId, retiredAt) VALUES (?, ?, ?, ?)`).run(ownerId, entityType, entityId, retiredAt);
}

export function retireGeneratedLearningMaterial(database: Database.Database, taskId: string, ownerIdInput: unknown, now = Date.now()): { taskId: string; retiredEntityCount: number } {
  const ownerId = parseLearningOwnerId(ownerIdInput);
  const task = getLearningTask(database, taskId, ownerId);
  if (!task) {
    const retired = database.prepare(`SELECT 1 FROM retired_learning_content WHERE ownerId = ? AND entityType = 'learning_task' AND entityId = ?`).get(ownerId, taskId);
    if (retired) throw new GeneratedMaterialError('learning_content_retired', '该学习资料已下线');
    throw new LearningTaskValidationError('taskId', '学习资料不存在');
  }
  if (task.generationStatus !== 'ready' || task.taskType === 'video') throw new GeneratedMaterialError('invalid_source', '只有已生成的学习资料可以删除');
  const links = linksFor(database, task.id);
  if (!primaryLink(links)) throw new GeneratedMaterialError('invalid_source', '学习资料缺少可删除的原内容');
  for (const link of links) {
    const count = database.prepare(`SELECT COUNT(*) AS count FROM learning_task_links WHERE entityType = ? AND entityId = ?`).get(link.entityType, link.entityId) as { count: number };
    if (count.count !== 1) throw new GeneratedMaterialError('shared_generated_content', '该学习内容被其他任务共用，不能单独删除');
  }
  validateReviewRetention(database, ownerId, links);

  database.transaction(() => {
    for (const link of links) retire(database, ownerId, link.entityType, link.entityId, now);
    retire(database, ownerId, 'learning_task', task.id, now);
    for (const link of links) {
      if (link.entityType === 'classroom_courseware') database.prepare(`DELETE FROM classroom_items WHERE id = ? AND ownerId = ? AND type = 'courseware'`).run(link.entityId, ownerId);
      if (link.entityType === 'classroom_quiz') database.prepare(`DELETE FROM classroom_items WHERE id = ? AND ownerId = ? AND type = 'quiz'`).run(link.entityId, ownerId);
      if (link.entityType === 'learning_package') {
        database.prepare(`DELETE FROM learning_package_progress WHERE ownerId = ? AND packageId = ?`).run(ownerId, link.entityId);
        database.prepare(`DELETE FROM learning_packages WHERE id = ? AND ownerId = ?`).run(link.entityId, ownerId);
      }
      if (link.entityType === 'assessment_paper') {
        const paper = database.prepare(`SELECT blueprintId FROM assessment_papers WHERE id = ? AND ownerId = ?`).get(link.entityId, ownerId) as { blueprintId: string } | undefined;
        database.prepare(`DELETE FROM assessment_papers WHERE id = ? AND ownerId = ?`).run(link.entityId, ownerId);
        if (paper && !database.prepare(`SELECT 1 FROM assessment_papers WHERE blueprintId = ? LIMIT 1`).get(paper.blueprintId)) database.prepare(`DELETE FROM assessment_blueprints WHERE id = ? AND ownerId = ?`).run(paper.blueprintId, ownerId);
      }
    }
    database.prepare(`DELETE FROM learning_task_events WHERE taskId = ?`).run(task.id);
    database.prepare(`DELETE FROM learning_task_links WHERE taskId = ?`).run(task.id);
    database.prepare(`DELETE FROM learning_tasks WHERE id = ? AND ownerId = ?`).run(task.id, ownerId);
  })();
  return { taskId: task.id, retiredEntityCount: links.length + 1 };
}
