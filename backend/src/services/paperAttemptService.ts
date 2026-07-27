import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import db from './databaseService.js';
import { LearningOwnerContextError, parseLearningOwnerId } from './learningDomain.js';

export class PaperAttemptValidationError extends Error {
  constructor(public readonly field: string, message: string) { super(message); }
}

type AttemptStatus = 'draft' | 'submitted';
type StoredAttempt = { id: string; paperId: string; ownerId: string; answersJson: string; status: AttemptStatus; diagnosticScore: number | null; submittedAt: number | null; createdAt: number; updatedAt: number };

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw new PaperAttemptValidationError(field, `${field}不能为空`);
  return value.trim();
}

function questionIds(database: Database.Database, paperId: string, ownerId: string) {
  const row = database.prepare('SELECT contentJson FROM assessment_papers WHERE id = ? AND ownerId = ?').get(paperId, ownerId) as { contentJson: string } | undefined;
  if (!row) throw new PaperAttemptValidationError('paperId', '试卷不存在于当前本地资料上下文中');
  const content = JSON.parse(row.contentJson) as { sections?: Array<{ questions?: Array<{ id?: string }> }> };
  return new Set((content.sections || []).flatMap(section => (section.questions || []).map(question => question.id).filter((id): id is string => Boolean(id))));
}

function parseAnswers(value: unknown, allowed: Set<string>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PaperAttemptValidationError('answers', 'answers必须是题号到作答内容的对象');
  const answers: Record<string, string> = {};
  for (const [questionId, answer] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.has(questionId)) throw new PaperAttemptValidationError('answers', `题号${questionId}不属于当前试卷`);
    if (typeof answer !== 'string') throw new PaperAttemptValidationError('answers', `题号${questionId}的作答必须是文本`);
    answers[questionId] = answer;
  }
  return answers;
}

function output(row: StoredAttempt) {
  return { ...row, answers: JSON.parse(row.answersJson) as Record<string, string> };
}

export function createPaperAttempt(request: Record<string, unknown>, database: Database.Database = db) {
  const ownerId = parseLearningOwnerId(request.ownerId); const paperId = requiredString(request.paperId, 'paperId'); questionIds(database, paperId, ownerId);
  const existing = database.prepare('SELECT * FROM paper_attempts WHERE ownerId = ? AND paperId = ? AND status = ? ORDER BY createdAt DESC LIMIT 1').get(ownerId, paperId, 'draft') as StoredAttempt | undefined;
  if (existing) return output(existing);
  const now = Date.now(); const id = randomUUID();
  try { database.prepare('INSERT INTO paper_attempts (id, paperId, ownerId, answersJson, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, paperId, ownerId, '{}', 'draft', now, now); }
  catch (error) {
    const concurrent = database.prepare('SELECT * FROM paper_attempts WHERE ownerId = ? AND paperId = ? AND status = ? ORDER BY createdAt DESC LIMIT 1').get(ownerId, paperId, 'draft') as StoredAttempt | undefined;
    if (concurrent) return output(concurrent);
    throw error;
  }
  return output(database.prepare('SELECT * FROM paper_attempts WHERE id = ?').get(id) as StoredAttempt);
}

export function getPaperAttempt(id: unknown, ownerIdInput: unknown, database: Database.Database = db) {
  const ownerId = parseLearningOwnerId(ownerIdInput); const attemptId = requiredString(id, 'id');
  const row = database.prepare('SELECT * FROM paper_attempts WHERE id = ? AND ownerId = ?').get(attemptId, ownerId) as StoredAttempt | undefined;
  return row ? output(row) : null;
}

export function updatePaperAttempt(id: unknown, request: Record<string, unknown>, database: Database.Database = db) {
  const ownerId = parseLearningOwnerId(request.ownerId); const attemptId = requiredString(id, 'id'); const row = getPaperAttempt(attemptId, ownerId, database);
  if (!row) throw new PaperAttemptValidationError('id', '作答记录不存在于当前本地资料上下文中');
  if (row.status !== 'draft') throw new PaperAttemptValidationError('status', '已交卷的作答不能再次修改或提交');
  const answers = parseAnswers(request.answers, questionIds(database, row.paperId, ownerId)); const now = Date.now();
  const submit = request.action === 'submit';
  if (request.action !== 'save' && !submit) throw new PaperAttemptValidationError('action', 'action仅支持save或submit');
  database.prepare('UPDATE paper_attempts SET answersJson = ?, status = ?, submittedAt = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(answers), submit ? 'submitted' : 'draft', submit ? now : null, now, attemptId);
  return getPaperAttempt(attemptId, ownerId, database)!;
}

export function isPaperAttemptInputError(error: unknown): error is PaperAttemptValidationError | LearningOwnerContextError {
  return error instanceof PaperAttemptValidationError || error instanceof LearningOwnerContextError;
}
