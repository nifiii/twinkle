import Database from 'better-sqlite3';
import { parseLearningOwnerId } from './learningDomain.js';
import { normalizeSubject } from '../utils/subject.js';

export type WrongBookSource = 'all' | 'scanned_item' | 'quiz_result';
type ItemSource = Exclude<WrongBookSource, 'all'>;

export interface WrongBookItem {
  id: string;
  source: ItemSource;
  reference: { scannedItemId: string; problemIndex: number } | { quizResultId: string; problemIndex: number };
  subject: string;
  contentExcerpt: string;
  knowledgePoints: string[];
  createdAt: number;
  detailTarget: { kind: ItemSource; id: string; problemIndex: number };
  capabilities: { view: true; edit: boolean; delete: boolean };
}

export interface WrongBookSourceStatus {
  status: 'ok' | 'unavailable';
  count: number;
  skippedCount: number;
  errorCode?: string;
}

export interface WrongBookResult {
  items: WrongBookItem[];
  nextCursor: string | null;
  sources: Record<ItemSource, WrongBookSourceStatus>;
}

export class WrongBookValidationError extends Error {}
export class WrongBookUnavailableError extends Error {}

type Filters = { source: WrongBookSource; subject?: string; from?: number; to?: number; query?: string; limit: number; cursor?: { createdAt: number; id: string } };

function parseJson(value: string | null | undefined): unknown[] {
  try { const parsed = value ? JSON.parse(value) : []; return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function parseDate(value: unknown, field: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new WrongBookValidationError(`${field} 必须是有效的 ISO 时间`);
  return Date.parse(value);
}

function parseCursor(value: unknown): Filters['cursor'] {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new WrongBookValidationError('cursor 格式不正确');
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { createdAt?: unknown; id?: unknown };
    if (typeof parsed.createdAt !== 'number' || typeof parsed.id !== 'string') throw new Error('invalid');
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch { throw new WrongBookValidationError('cursor 格式不正确'); }
}

function filtersFor(input: Record<string, unknown>): Filters {
  const source = input.source === undefined || input.source === '' ? 'all' : input.source;
  if (source !== 'all' && source !== 'scanned_item' && source !== 'quiz_result') throw new WrongBookValidationError('source 不支持');
  const subject = input.subject === undefined || input.subject === '' ? undefined : typeof input.subject === 'string' ? normalizeSubject(input.subject) : undefined;
  if (input.subject !== undefined && input.subject !== '' && !subject) throw new WrongBookValidationError('subject 格式不正确');
  const query = input.query === undefined || input.query === '' ? undefined : typeof input.query === 'string' ? input.query.trim() : '';
  if (query !== undefined && (!query || query.length > 80)) throw new WrongBookValidationError('query 必须为 1 至 80 个字符');
  const limit = input.limit === undefined || input.limit === '' ? 50 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new WrongBookValidationError('limit 必须为 1 至 100');
  const from = parseDate(input.from, 'from'); const to = parseDate(input.to, 'to');
  if (from !== undefined && to !== undefined && from > to) throw new WrongBookValidationError('from 不能晚于 to');
  return { source, subject, from, to, query, limit, cursor: parseCursor(input.cursor) };
}

function matches(item: WrongBookItem, filters: Filters): boolean {
  if (filters.subject && item.subject !== filters.subject) return false;
  if (filters.from !== undefined && item.createdAt < filters.from) return false;
  if (filters.to !== undefined && item.createdAt > filters.to) return false;
  if (filters.query) {
    const searchable = [item.contentExcerpt, ...item.knowledgePoints].join('\n').toLocaleLowerCase();
    if (!searchable.includes(filters.query.toLocaleLowerCase())) return false;
  }
  return !filters.cursor || item.createdAt < filters.cursor.createdAt || (item.createdAt === filters.cursor.createdAt && item.id > filters.cursor.id);
}

function scannedItems(database: Database.Database, ownerId: string): { items: WrongBookItem[]; skippedCount: number } {
  const rows = database.prepare(`SELECT id, subject, problemsJson, timestamp FROM scanned_items WHERE ownerId = ? AND type = 'wrong_problem'`).all(ownerId) as Array<{ id: string; subject: string; problemsJson: string | null; timestamp: number }>;
  const items: WrongBookItem[] = []; let skippedCount = 0;
  for (const row of rows) {
    const subject = normalizeSubject(row.subject);
    parseJson(row.problemsJson).forEach((raw, problemIndex) => {
      const problem = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      const content = String(problem.content || problem.question || '').trim();
      if (!content) { skippedCount += 1; return; }
      const knowledgePoints = Array.isArray(problem.knowledgePoints) ? problem.knowledgePoints.filter((point): point is string => typeof point === 'string' && Boolean(point.trim())).map(point => point.trim()) : [];
      items.push({ id: `scanned_item:${row.id}:${problemIndex}`, source: 'scanned_item', reference: { scannedItemId: row.id, problemIndex }, subject, contentExcerpt: content.slice(0, 160), knowledgePoints, createdAt: row.timestamp, detailTarget: { kind: 'scanned_item', id: row.id, problemIndex }, capabilities: { view: true, edit: false, delete: true } });
    });
  }
  return { items, skippedCount };
}

function quizResultItems(database: Database.Database, ownerId: string): { items: WrongBookItem[]; skippedCount: number } {
  const rows = database.prepare(`SELECT id, subject, chapter, resultsJson, createdAt FROM quiz_results WHERE ownerId = ? AND status = 'completed'`).all(ownerId) as Array<{ id: string; subject: string; chapter: string | null; resultsJson: string | null; createdAt: number }>;
  const items: WrongBookItem[] = []; let skippedCount = 0;
  for (const row of rows) {
    const subject = normalizeSubject(row.subject);
    parseJson(row.resultsJson).forEach((raw, problemIndex) => {
      const problem = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      if (problem.isCorrect !== false) return;
      const content = String(problem.question || '').trim();
      const answer = String(problem.correctAnswer || '').trim();
      if (!content || !answer) { skippedCount += 1; return; }
      const chapter = row.chapter?.trim();
      items.push({ id: `quiz_result:${row.id}:${problemIndex}`, source: 'quiz_result', reference: { quizResultId: row.id, problemIndex }, subject, contentExcerpt: content.slice(0, 160), knowledgePoints: chapter ? [chapter] : [], createdAt: row.createdAt, detailTarget: { kind: 'quiz_result', id: row.id, problemIndex }, capabilities: { view: true, edit: false, delete: false } });
    });
  }
  return { items, skippedCount };
}

function sourceResult(source: ItemSource, database: Database.Database, ownerId: string): { items: WrongBookItem[]; status: WrongBookSourceStatus } {
  try {
    const result = source === 'scanned_item' ? scannedItems(database, ownerId) : quizResultItems(database, ownerId);
    return { items: result.items, status: { status: 'ok', count: result.items.length, skippedCount: result.skippedCount } };
  } catch {
    return { items: [], status: { status: 'unavailable', count: 0, skippedCount: 0, errorCode: `${source}_unavailable` } };
  }
}

export function getUnifiedWrongBook(input: Record<string, unknown>, database: Database.Database): WrongBookResult {
  const ownerId = parseLearningOwnerId(input.ownerId); const filters = filtersFor(input);
  const scanned = filters.source === 'quiz_result' ? { items: [], status: { status: 'ok', count: 0, skippedCount: 0 } as WrongBookSourceStatus } : sourceResult('scanned_item', database, ownerId);
  const quiz = filters.source === 'scanned_item' ? { items: [], status: { status: 'ok', count: 0, skippedCount: 0 } as WrongBookSourceStatus } : sourceResult('quiz_result', database, ownerId);
  const selectedStatuses = filters.source === 'all' ? [scanned.status, quiz.status] : filters.source === 'scanned_item' ? [scanned.status] : [quiz.status];
  if (selectedStatuses.every(status => status.status === 'unavailable')) throw new WrongBookUnavailableError('错题本来源暂不可用');
  const filtered = [...scanned.items, ...quiz.items].filter(item => matches(item, filters)).sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
  const page = filtered.slice(0, filters.limit);
  const last = page[page.length - 1];
  return { items: page, nextCursor: filtered.length > page.length && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id }), 'utf8').toString('base64url') : null, sources: { scanned_item: scanned.status, quiz_result: quiz.status } };
}
