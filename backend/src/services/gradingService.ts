import OpenAI from 'openai';
import Database from 'better-sqlite3';
import db from './databaseService.js';
import { parseLearningOwnerId } from './learningDomain.js';

type RubricPoint = { id: string; score: number; description: string; dimension: 'process' | 'result' | 'expression' | 'knowledge'; acceptableExpressions?: string[] };
type Question = { id: string; type: 'choice' | 'fill' | 'essay'; stem: string; answer: string; score: number; rubric?: RubricPoint[] };
type ItemResult = { questionId: string; score: number; maxScore: number; rubric: unknown[]; evidence: unknown[]; confidence: number; verdict: 'mastered' | 'review'; reason: string };
type ModelPoint = { id: string; earnedScore: number; evidence: string; reason: string };
type ModelResponse = { points?: ModelPoint[]; confidence?: number };
type EssayModel = (input: { question: string; studentAnswer: string; rubric: RubricPoint[] }) => Promise<ModelResponse>;
export type GradingDependencies = { database?: Database.Database; gradeEssay?: EssayModel };

export class GradingValidationError extends Error { constructor(public readonly field: string, message: string) { super(message); } }
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[×x]/g, '*').replace(/[÷]/g, '/').replace(/\s+/g, '').trim();
const choices = (answer: string) => answer.split(/[|；;、]/).map(normalize).filter(Boolean);
const questionsFor = (contentJson: string) => (JSON.parse(contentJson).sections || []).flatMap((section: { questions?: Question[] }) => section.questions || []) as Question[];

function objective(question: Question, answer: string): ItemResult {
  const actual = question.type === 'choice' ? normalize(answer).match(/^[a-d]/)?.[0] || normalize(answer) : normalize(answer);
  const expected = choices(question.answer).map(value => question.type === 'choice' ? value.match(/^[a-d]/)?.[0] || value : value);
  const correct = expected.includes(actual);
  return { questionId: question.id, score: correct ? question.score : 0, maxScore: question.score, rubric: [{ id: 'answer', score: question.score, description: '答案等价' }], evidence: [{ studentAnswer: answer, matched: correct }], confidence: 1, verdict: correct ? 'mastered' : 'review', reason: correct ? '答案与可接受答案等价' : '答案与可接受答案不等价' };
}

async function modelEssay(question: Question, answer: string, gradeEssay?: EssayModel): Promise<ItemResult> {
  const rubric = question.rubric || [];
  if (!rubric.some(point => point.dimension === 'process') || !rubric.some(point => point.dimension === 'result')) return { questionId: question.id, score: 0, maxScore: question.score, rubric, evidence: [], confidence: 0, verdict: 'review', reason: '试卷缺少可审计的过程与结果量规，建议复核' };
  const apiKey = process.env.ARK_API_KEY; const model = process.env.ARK_MODEL_ID;
  if (!gradeEssay && (!apiKey || !model)) return { questionId: question.id, score: 0, maxScore: question.score, rubric, evidence: [], confidence: 0, verdict: 'review', reason: '阅卷模型未配置，建议复核' };
  const prompt = { question: question.stem, studentAnswer: answer, rubric, output: { points: [{ id: '评分点id', earnedScore: 0, evidence: '学生作答原文片段', reason: '理由' }], confidence: 0 } };
  try {
    let parsed: ModelResponse;
    if (gradeEssay) {
      parsed = await gradeEssay({ question: question.stem, studentAnswer: answer, rubric });
    } else {
      const client = new OpenAI({ apiKey: apiKey!, baseURL: 'https://ark.cn-beijing.volces.com/api/v3' });
      const response = await client.chat.completions.create({ model: model!, temperature: 0, messages: [{ role: 'system', content: '只输出 JSON。逐评分点依据学生原文给分；表达不同但满足量规不得扣分；没有证据不得给分。' }, { role: 'user', content: JSON.stringify(prompt) }] });
      parsed = JSON.parse((response.choices[0]?.message?.content || '{}').replace(/^```json\s*|\s*```$/g, '').trim()) as ModelResponse;
    }
    const points = parsed.points || []; const valid = rubric.every(point => { const result = points.find(item => item.id === point.id); return result && Number.isFinite(result.earnedScore) && result.earnedScore >= 0 && result.earnedScore <= point.score && typeof result.evidence === 'string' && typeof result.reason === 'string'; });
    const evidenceFromAnswer = points.every(point => typeof point.evidence === 'string' && (!point.evidence.trim() || answer.includes(point.evidence)));
    const confidence = Number(parsed.confidence); if (!valid || !evidenceFromAnswer || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('评分结构不合法');
    const score = rubric.reduce((sum, point) => sum + points.find(item => item.id === point.id)!.earnedScore, 0);
    return { questionId: question.id, score, maxScore: question.score, rubric, evidence: points, confidence, verdict: confidence < 0.75 || points.some(point => !point.evidence.trim()) ? 'review' : 'mastered', reason: confidence < 0.75 ? '评分置信度较低，建议复核' : '已按评分点完成诊断' };
  } catch { return { questionId: question.id, score: 0, maxScore: question.score, rubric, evidence: [], confidence: 0, verdict: 'review', reason: '无法生成有证据的量规评分，建议复核' }; }
}

function persist(database: Database.Database, attemptId: string, result: ItemResult) {
  database.prepare(`INSERT INTO attempt_item_results (attemptId, questionId, score, maxScore, rubricJson, evidenceJson, confidence, verdict, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(attemptId, questionId) DO UPDATE SET score=excluded.score, maxScore=excluded.maxScore, rubricJson=excluded.rubricJson, evidenceJson=excluded.evidenceJson, confidence=excluded.confidence, verdict=excluded.verdict, createdAt=excluded.createdAt`).run(attemptId, result.questionId, result.score, result.maxScore, JSON.stringify({ points: result.rubric, reason: result.reason }), JSON.stringify(result.evidence), result.confidence, result.verdict, Date.now());
}

export async function gradeAttempt(attemptId: string, ownerIdInput: unknown, dependencies: GradingDependencies = {}) {
  const database = dependencies.database || db;
  const ownerId = parseLearningOwnerId(ownerIdInput); const attempt = database.prepare('SELECT * FROM paper_attempts WHERE id = ? AND ownerId = ?').get(attemptId, ownerId) as { id: string; paperId: string; answersJson: string; status: string } | undefined;
  if (!attempt || attempt.status !== 'submitted') throw new GradingValidationError('attemptId', '只能批改已交卷的作答');
  const paper = database.prepare('SELECT contentJson FROM assessment_papers WHERE id = ? AND ownerId = ?').get(attempt.paperId, ownerId) as { contentJson: string } | undefined;
  if (!paper) throw new GradingValidationError('attemptId', '试卷不存在于当前本地资料上下文中'); const answers = JSON.parse(attempt.answersJson) as Record<string, string>;
  for (const question of questionsFor(paper.contentJson)) persist(database, attempt.id, question.type === 'essay' ? await modelEssay(question, answers[question.id] || '', dependencies.gradeEssay) : objective(question, answers[question.id] || ''));
  const total = database.prepare('SELECT COALESCE(SUM(score), 0) AS score FROM attempt_item_results WHERE attemptId = ?').get(attempt.id) as { score: number };
  database.prepare('UPDATE paper_attempts SET diagnosticScore = ?, updatedAt = ? WHERE id = ?').run(total.score, Date.now(), attempt.id); return getDiagnosis(attempt.id, ownerId, database)!;
}

export function getDiagnosis(attemptId: string, ownerIdInput: unknown, database: Database.Database = db) {
  const ownerId = parseLearningOwnerId(ownerIdInput); const attempt = database.prepare('SELECT id, paperId, ownerId, status, diagnosticScore, submittedAt FROM paper_attempts WHERE id = ? AND ownerId = ?').get(attemptId, ownerId) as Record<string, unknown> | undefined; if (!attempt) return null;
  const items = database.prepare('SELECT questionId, score, maxScore, rubricJson, evidenceJson, confidence, verdict FROM attempt_item_results WHERE attemptId = ?').all(attemptId).map((row: any) => ({ ...row, rubric: JSON.parse(row.rubricJson), evidence: JSON.parse(row.evidenceJson) }));
  const events = database.prepare('SELECT * FROM review_events WHERE attemptId = ? ORDER BY createdAt').all(attemptId); return { ...attempt, items, events };
}

export function reviewItem(attemptId: string, request: Record<string, unknown>, database: Database.Database = db) {
  const ownerId = parseLearningOwnerId(request.ownerId); const diagnosis = getDiagnosis(attemptId, ownerId, database); const questionId = typeof request.questionId === 'string' ? request.questionId : ''; const action = request.action;
  if (!diagnosis || !questionId) throw new GradingValidationError('questionId', '作答或题目不存在'); const item = diagnosis.items.find((row: any) => row.questionId === questionId); if (!item) throw new GradingValidationError('questionId', '题目评分不存在');
  if (action !== 'request' && action !== 'override') throw new GradingValidationError('action', 'action仅支持request或override');
  const reason = typeof request.reason === 'string' ? request.reason.trim() : ''; if (!reason) throw new GradingValidationError('reason', '请填写复核或改判原因'); const before = { ...item };
  if (action === 'override') { const score = Number(request.score); if (!Number.isFinite(score) || score < 0 || score > item.maxScore) throw new GradingValidationError('score', '改判分数超出范围'); database.prepare('UPDATE attempt_item_results SET score = ?, verdict = ?, confidence = ? WHERE attemptId = ? AND questionId = ?').run(score, 'review', 1, attemptId, questionId); }
  database.prepare('INSERT INTO review_events (id, attemptId, questionId, actorType, action, reason, beforeJson, afterJson, createdAt) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?)').run(attemptId, questionId, action === 'override' ? 'parent' : 'student', String(action), reason, JSON.stringify(before), JSON.stringify(getDiagnosis(attemptId, ownerId, database)?.items.find((row: any) => row.questionId === questionId) || before), Date.now());
  const total = database.prepare('SELECT COALESCE(SUM(score), 0) AS score FROM attempt_item_results WHERE attemptId = ?').get(attemptId) as { score: number }; database.prepare('UPDATE paper_attempts SET diagnosticScore = ?, updatedAt = ? WHERE id = ?').run(total.score, Date.now(), attemptId); return getDiagnosis(attemptId, ownerId, database)!;
}
