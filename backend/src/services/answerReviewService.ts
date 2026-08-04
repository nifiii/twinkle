import Database from 'better-sqlite3';
import { parseLearningOwnerId } from './learningDomain.js';

export type AnswerReviewSource = 'quiz_result' | 'paper_attempt';

export type AnswerReviewItem = {
  questionId: string;
  type: string;
  question: string;
  studentAnswer: string;
  referenceAnswer: string;
  explanation: string;
  needsReinforcement: boolean;
};

type StoredQuestion = {
  id?: unknown;
  questionId?: unknown;
  type?: unknown;
  question?: unknown;
  stem?: unknown;
  answer?: unknown;
  correctAnswer?: unknown;
  explanation?: unknown;
};

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function createReviewItems(questions: StoredQuestion[], answers: Record<string, string>): AnswerReviewItem[] {
  return questions.map((question, index) => {
    const questionId = text(question.id) || text(question.questionId) || `q${index + 1}`;
    return {
      questionId,
      type: text(question.type),
      question: text(question.question) || text(question.stem),
      studentAnswer: answers[questionId] || '',
      referenceAnswer: text(question.correctAnswer) || text(question.answer),
      explanation: text(question.explanation),
      needsReinforcement: false,
    };
  });
}

function flagSet(database: Database.Database, ownerId: string, sourceType: AnswerReviewSource, sourceId: string): Set<string> {
  return new Set((database.prepare(`
    SELECT questionId FROM answer_review_flags
    WHERE ownerId = ? AND sourceType = ? AND sourceId = ?
  `).all(ownerId, sourceType, sourceId) as Array<{ questionId: string }>).map(row => row.questionId));
}

function withFlags(database: Database.Database, ownerId: string, sourceType: AnswerReviewSource, sourceId: string, items: AnswerReviewItem[]): AnswerReviewItem[] {
  const marked = flagSet(database, ownerId, sourceType, sourceId);
  return items.map(item => ({ ...item, needsReinforcement: marked.has(item.questionId) }));
}

export function getQuizResultReview(database: Database.Database, resultId: string, ownerIdInput: unknown) {
  const ownerId = parseLearningOwnerId(ownerIdInput);
  const row = database.prepare(`
    SELECT id, quizId, bookTitle, chapter, subject, ownerId, userName, resultsJson, createdAt
    FROM quiz_results WHERE id = ? AND ownerId = ?
  `).get(resultId, ownerId) as {
    id: string; quizId: string; bookTitle: string; chapter: string; subject: string; ownerId: string;
    userName: string | null; resultsJson: string | null; createdAt: number;
  } | undefined;
  if (!row) return null;
  const rawItems = parseJson<StoredQuestion[]>(row.resultsJson, []);
  const answers = Object.fromEntries(rawItems.map((item, index) => [text(item.id) || text(item.questionId) || `q${index + 1}`, text((item as Record<string, unknown>).studentAnswer)]));
  return {
    id: row.id, sourceType: 'quiz_result' as const, quizId: row.quizId, bookTitle: row.bookTitle,
    chapter: row.chapter, subject: row.subject, ownerId: row.ownerId, userName: row.userName || '',
    status: 'submitted' as const, submittedAt: row.createdAt,
    items: withFlags(database, ownerId, 'quiz_result', row.id, createReviewItems(rawItems, answers)),
  };
}

export function getPaperAttemptReview(database: Database.Database, attemptId: string, ownerIdInput: unknown) {
  const ownerId = parseLearningOwnerId(ownerIdInput);
  const row = database.prepare(`
    SELECT attempt.id, attempt.paperId, attempt.ownerId, attempt.answersJson, attempt.reviewSnapshotJson,
           attempt.status, attempt.submittedAt, paper.contentJson
    FROM paper_attempts attempt
    JOIN assessment_papers paper ON paper.id = attempt.paperId AND paper.ownerId = attempt.ownerId
    WHERE attempt.id = ? AND attempt.ownerId = ?
  `).get(attemptId, ownerId) as {
    id: string; paperId: string; ownerId: string; answersJson: string; reviewSnapshotJson: string | null;
    status: string; submittedAt: number | null; contentJson: string;
  } | undefined;
  if (!row || row.status !== 'submitted') return null;
  const answers = parseJson<Record<string, string>>(row.answersJson, {});
  const snapshot = parseJson<AnswerReviewItem[]>(row.reviewSnapshotJson, []);
  const content = parseJson<{ sections?: Array<{ questions?: StoredQuestion[] }> }>(row.contentJson, {});
  const items = snapshot.length ? snapshot : createReviewItems((content.sections || []).flatMap(section => section.questions || []), answers);
  return {
    id: row.id, sourceType: 'paper_attempt' as const, paperId: row.paperId, ownerId: row.ownerId,
    status: 'submitted' as const, submittedAt: row.submittedAt,
    items: withFlags(database, ownerId, 'paper_attempt', row.id, items),
  };
}

export function setAnswerReviewReinforcement(
  database: Database.Database,
  input: { ownerId: unknown; sourceType: AnswerReviewSource; sourceId: string; questionId: string; needsReinforcement: unknown },
) {
  const ownerId = parseLearningOwnerId(input.ownerId);
  if (!input.questionId.trim()) throw new Error('questionId不能为空');
  if (typeof input.needsReinforcement !== 'boolean') throw new Error('needsReinforcement必须为布尔值');
  const review = input.sourceType === 'quiz_result'
    ? getQuizResultReview(database, input.sourceId, ownerId)
    : getPaperAttemptReview(database, input.sourceId, ownerId);
  if (!review) return null;
  if (!review.items.some(item => item.questionId === input.questionId)) throw new Error('题目不属于当前作答回顾');
  if (input.needsReinforcement) {
    database.prepare(`
      INSERT INTO answer_review_flags (ownerId, sourceType, sourceId, questionId, createdAt)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(ownerId, sourceType, sourceId, questionId) DO NOTHING
    `).run(ownerId, input.sourceType, input.sourceId, input.questionId, Date.now());
  } else {
    database.prepare(`
      DELETE FROM answer_review_flags
      WHERE ownerId = ? AND sourceType = ? AND sourceId = ? AND questionId = ?
    `).run(ownerId, input.sourceType, input.sourceId, input.questionId);
  }
  return { questionId: input.questionId, needsReinforcement: input.needsReinforcement };
}
