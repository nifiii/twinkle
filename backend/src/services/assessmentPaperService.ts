import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import OpenAI from 'openai';
import Database from 'better-sqlite3';
import db from './databaseService.js';
import { LearningOwnerContextError, parseLearningOwnerId } from './learningDomain.js';
import { normalizeSubject } from '../utils/subject.js';

type Difficulty = 'basic' | 'standard' | 'challenge';
type ExamType = 'unit' | 'midterm' | 'final';
type ExamMode = 'textbook' | 'olympiad';
type QuestionType = 'choice' | 'fill' | 'essay';

export class AssessmentPaperValidationError extends Error {
  constructor(public readonly field: string, message: string) { super(message); }
}

export interface AssessmentPaperDependencies {
  database?: Database.Database;
  readMarkdown?: (path: string) => Promise<string>;
  generatePaper?: (input: Record<string, unknown>) => Promise<unknown>;
}

const BLUEPRINTS: Record<Difficulty, Array<{ type: QuestionType; count: number; score: number }>> = {
  basic: [{ type: 'choice', count: 5, score: 2 }, { type: 'fill', count: 4, score: 2 }],
  standard: [{ type: 'choice', count: 4, score: 2 }, { type: 'fill', count: 3, score: 2 }, { type: 'essay', count: 2, score: 4 }],
  challenge: [{ type: 'choice', count: 4, score: 2 }, { type: 'fill', count: 3, score: 2 }, { type: 'essay', count: 3, score: 4 }],
};

function parseString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new AssessmentPaperValidationError(field, `${field}不能为空`);
  return value.trim();
}
function parseChapters(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(id => typeof id !== 'string' || !id.trim())) throw new AssessmentPaperValidationError('chapterIds', '至少选择一个有效章节');
  return [...new Set(value.map(id => id.trim()))];
}
function parseDifficulty(value: unknown): Difficulty {
  return value === undefined || value === null || value === '' ? 'standard' : (['basic', 'standard', 'challenge'].includes(String(value)) ? value as Difficulty : (() => { throw new AssessmentPaperValidationError('difficulty', '难度仅支持基础、标准或挑战'); })());
}
function parseExamType(value: unknown): ExamType {
  if (!['unit', 'midterm', 'final'].includes(String(value))) throw new AssessmentPaperValidationError('examType', '试卷类型仅支持单元、期中或期末');
  return value as ExamType;
}
function parseExamMode(value: unknown): ExamMode {
  if (value === undefined || value === null || value === '') return 'textbook';
  if (value === 'textbook' || value === 'olympiad') return value;
  throw new AssessmentPaperValidationError('examMode', '考试模式仅支持教材或奥数');
}
function toc(value: string | null): Array<{ id: string; title: string; children?: unknown[] }> { try { const data = JSON.parse(value || '[]'); return Array.isArray(data) ? data : []; } catch { return []; } }
function flatten(nodes: Array<{ id: string; title: string; children?: unknown[] }>): Array<{ id: string; title: string }> { return nodes.flatMap(node => [node, ...flatten(Array.isArray(node.children) ? node.children as Array<{ id: string; title: string; children?: unknown[] }> : [])]); }

function requireBook(database: Database.Database, bookId: unknown, ownerId: string) {
  const id = parseString(bookId, 'bookId');
  const book = database.prepare(`SELECT id, subject, grade, tableOfContents, mdPath, status FROM books WHERE id = ? AND (ownerId = ? OR ownerId = 'shared')`).get(id, ownerId) as { id: string; subject: string; grade: string | null; tableOfContents: string | null; mdPath: string | null; status: string } | undefined;
  if (!book) throw new AssessmentPaperValidationError('bookId', '教材不在当前本地资料上下文中');
  if (book.status !== 'completed' || !book.mdPath || !book.grade?.trim()) throw new AssessmentPaperValidationError('bookId', '教材尚未完成解析或缺少年级');
  return book;
}

function selectedTitles(book: ReturnType<typeof requireBook>, chapterIds: string[]) {
  // Browser route parameters and persisted blueprint IDs are strings, while
  // older textbook catalogs may store numeric IDs. Compare their stable text
  // representation so validation remains strict without rejecting real chapters.
  const map = new Map(flatten(toc(book.tableOfContents)).map(item => [String(item.id), item.title]));
  const titles = chapterIds.map(id => map.get(id));
  if (titles.some(title => !title?.trim())) throw new AssessmentPaperValidationError('chapterIds', '所选章节不在教材目录中');
  return titles as string[];
}

function selectedExcerpt(markdown: string, chapterTitles: string[]): string {
  const lines = markdown.split(/\r?\n/);
  const headings = lines.map((line, index) => {
    const match = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (!match) return null;
    return { index, level: match[1].length, title: match[2].trim() };
  }).filter((heading): heading is { index: number; level: number; title: string } => Boolean(heading));
  const normalizeTitle = (title: string) => title.replace(/^第[一二三四五六七八九十]+单元\s*/, '').replace(/^\d+\s+/, '').replace(/\s+/g, ' ').trim();
  const unitNumber = (title: string) => {
    const arabic = title.match(/^(\d+)\s+/)?.[1];
    if (arabic) return Number(arabic);
    const chinese = title.match(/^第([一二三四五六七八九])单元/)?.[1];
    return chinese ? '一二三四五六七八九'.indexOf(chinese) + 1 : null;
  };
  const excerpts = chapterTitles.map(title => {
    const normalized = normalizeTitle(title);
    const startHeading = headings.find(heading => heading.title === title || (normalized.length > 0 && normalizeTitle(heading.title) === normalized));
    if (!startHeading) throw new AssessmentPaperValidationError('chapterIds', `教材中找不到“${title}”的正文`);
    const nextUnit = unitNumber(startHeading.title);
    const endHeading = headings.find(heading => heading.index > startHeading.index && heading.level <= startHeading.level && (nextUnit === null || unitNumber(heading.title) === nextUnit + 1));
    return lines.slice(startHeading.index, endHeading?.index).join('\n').trim();
  });
  const result = excerpts.join('\n\n').slice(0, 12000);
  if (result.length < 80) throw new AssessmentPaperValidationError('chapterIds', '所选章节没有足够的教材正文');
  return result;
}

function sectionsFor(difficulty: Difficulty) {
  return BLUEPRINTS[difficulty].map((section, index) => ({ id: `section-${index + 1}`, type: section.type, questionCount: section.count, scorePerQuestion: section.score, score: section.count * section.score }));
}

function styleSummary(database: Database.Database, ownerId: string, styleProfileId: unknown) {
  if (!styleProfileId) return null;
  const id = parseString(styleProfileId, 'styleProfileId');
  const row = database.prepare(`SELECT id, sourceType, summaryJson FROM style_profiles WHERE id = ? AND reviewStatus = 'approved' AND (ownerId = ? OR ownerId IS NULL OR ownerId = 'shared')`).get(id, ownerId) as { id: string; sourceType: string; summaryJson: string } | undefined;
  if (!row) return null;
  try { return { id: row.id, sourceType: row.sourceType, summary: JSON.parse(row.summaryJson) }; } catch { return null; }
}

function olympiadStyle(database: Database.Database, ownerId: string, bookId: unknown) {
  const id = parseString(bookId, 'olympiadBookId');
  const row = database.prepare(`
    SELECT id, title, subject, grade, category, tags
    FROM books
    WHERE id = ? AND (ownerId = ? OR ownerId = 'shared')
  `).get(id, ownerId) as { id: string; title: string; subject: string | null; grade: string | null; category: string | null; tags: string | null } | undefined;
  if (!row || normalizeSubject(row.subject || '') !== '数学' || !row.grade?.trim() || !/奥数/.test(`${row.category || ''} ${row.tags || ''}`)) {
    throw new AssessmentPaperValidationError('olympiadBookId', '奥数资料必须在当前家庭资料范围内，标注数学学科、适用年级和奥数类别');
  }
  return {
    id: row.id,
    title: row.title.slice(0, 120),
    category: (row.category || '').slice(0, 120),
    tags: (row.tags || '').slice(0, 500),
    grade: row.grade,
  };
}

function originalPaperPrompt(input: Record<string, unknown>) {
  return `你是小学教材命题专家。依据教材知识点生成全新原创试卷，不能复制、改写或输出教材原句，不能复现、引用或声称是真题；风格摘要只用于题型、难度和知识点组织，不得输出任何样本题目全文。
只输出一个 JSON 对象，不要 Markdown 代码块或额外说明。输出必须是：
{"title":"原创试卷标题","sections":[{"title":"分区标题","questions":[{"stem":"题干","options":["A. 选项","B. 选项","C. 选项","D. 选项"],"answer":"答案","explanation":"解析","rubric":[{"id":"评分点","score":1,"description":"要求","dimension":"process","acceptableExpressions":["可接受表达"],"counterexamples":["不满足要求的表达"]}]}]}]}
严格遵守输入 sections 的数组顺序、分区数量、type、questionCount 和 scorePerQuestion：每个分区 questions 的数量必须恰好等于其 questionCount；choice 题必须提供 4 个 options；fill 和 essay 题也必须提供非空 stem、answer、explanation；essay 题必须提供至少一个 rubric 评分点，评分点分值之和等于该题 scorePerQuestion。每个评分点必须含 dimension，且仅可为 process、result、expression、knowledge 之一；process 和 result 评分点不得合并，acceptableExpressions 用于同义或等价表达，不得按文字包含关系判满分。
输入数据：\n${JSON.stringify(input)}`;
}

async function generateOriginalPaper(input: Record<string, unknown>): Promise<unknown> {
  const apiKey = process.env.ARK_API_KEY; const model = process.env.ARK_MODEL_ID;
  if (!apiKey || !model) throw new Error('原创试卷生成服务未配置');
  const client = new OpenAI({ apiKey, baseURL: 'https://ark.cn-beijing.volces.com/api/v3' });
  const response = await client.chat.completions.create({ model, temperature: 0.25, messages: [{ role: 'system', content: '只输出符合请求结构的 JSON。' }, { role: 'user', content: originalPaperPrompt(input) }] });
  const raw = response.choices[0]?.message?.content || '{}';
  return JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '').trim());
}

function normalizeEssayRubric(value: unknown, score: number, answer: string) {
  const rubric = Array.isArray(value) ? value : [];
  const valid = rubric.length > 0
    && rubric.some(point => point?.dimension === 'process')
    && rubric.some(point => point?.dimension === 'result')
    && rubric.every(point => point?.id && point?.description && ['process', 'result', 'expression', 'knowledge'].includes(point.dimension) && Number.isFinite(point.score) && point.score > 0)
    && rubric.reduce((sum, point) => sum + Number(point.score), 0) === score;
  if (valid) return rubric;

  // Model-generated questions can be usable while their rubric misses a field.
  // Keep process and result independently auditable instead of failing the paper.
  const processScore = Math.floor(score / 2);
  const resultScore = score - processScore;
  if (processScore <= 0 || resultScore <= 0) throw new Error('解答题分值不足以区分过程与结果');
  return [
    { id: 'process', score: processScore, description: '列出关键步骤，推理或计算过程正确。', dimension: 'process', acceptableExpressions: [], counterexamples: [] },
    { id: 'result', score: resultScore, description: `结论与参考答案“${answer.slice(0, 200)}”等价。`, dimension: 'result', acceptableExpressions: [answer], counterexamples: [] },
  ];
}

function validatePaper(value: unknown, blueprint: Record<string, unknown>) {
  const source = value as { title?: unknown; sections?: unknown };
  if (!source || typeof source !== 'object' || !Array.isArray(source.sections)) throw new Error('模型未返回结构化试卷');
  const wanted = blueprint.sections as Array<{ id: string; type: QuestionType; questionCount: number; scorePerQuestion: number }>;
  const sections = source.sections.map((section: any, index: number) => {
    const expected = wanted[index];
    if (!expected || !Array.isArray(section?.questions) || section.questions.length !== expected.questionCount) throw new Error('模型返回的题型或题数不符合蓝图');
    return { id: expected.id, type: expected.type, title: section.title || expected.type, questions: section.questions.map((question: any, questionIndex: number) => {
      if (!question?.stem || !question?.answer) throw new Error('模型返回的题目缺少题干或答案');
      if (expected.type === 'choice' && (!Array.isArray(question.options) || question.options.length < 2)) throw new Error('选择题缺少选项');
      const rubric = expected.type === 'essay' ? normalizeEssayRubric(question.rubric, expected.scorePerQuestion, String(question.answer)) : undefined;
      return { id: `${expected.id}-q${questionIndex + 1}`, type: expected.type, stem: String(question.stem), options: expected.type === 'choice' ? question.options.map(String) : undefined, answer: String(question.answer), explanation: String(question.explanation || ''), score: expected.scorePerQuestion, rubric: rubric?.map((point: any) => ({ id: String(point.id), score: Number(point.score), description: String(point.description), dimension: point.dimension, acceptableExpressions: Array.isArray(point.acceptableExpressions) ? point.acceptableExpressions.map(String) : [], counterexamples: Array.isArray(point.counterexamples) ? point.counterexamples.map(String) : [] })) };
    }) };
  });
  if (sections.length !== wanted.length) throw new Error('模型返回的题型分区不符合蓝图');
  return { schemaVersion: 1, original: true, title: typeof source.title === 'string' ? source.title : '原创试卷', sections, totalScore: wanted.reduce((sum, item) => sum + item.questionCount * item.scorePerQuestion, 0) };
}

export async function createAssessmentBlueprint(request: Record<string, unknown>, dependencies: AssessmentPaperDependencies = {}) {
  const database = dependencies.database || db; const ownerId = parseLearningOwnerId(request.ownerId); const difficulty = parseDifficulty(request.difficulty); const examType = parseExamType(request.examType); const examMode = parseExamMode(request.examMode); const sections = sectionsFor(difficulty); const profile = styleSummary(database, ownerId, request.styleProfileId);
  const olympiad = examMode === 'olympiad' ? olympiadStyle(database, ownerId, request.olympiadBookId) : null;
  const book = examMode === 'olympiad' ? null : requireBook(database, request.bookId, ownerId);
  const chapterIds = examMode === 'olympiad' ? [] : parseChapters(request.chapterIds);
  const chapterTitles = book ? selectedTitles(book, chapterIds) : [];
  const id = randomUUID(); const now = Date.now();
  const sourceBookId = olympiad?.id || book!.id;
  const subject = olympiad ? '数学' : normalizeSubject(book!.subject);
  const grade = olympiad?.grade || book!.grade;
  database.prepare(`INSERT INTO assessment_blueprints (id, ownerId, bookId, chapterIdsJson, examType, examMode, olympiadBookId, difficulty, sectionsJson, styleProfileId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ownerId, sourceBookId, JSON.stringify(chapterIds), examType, examMode, olympiad?.id || null, difficulty, JSON.stringify(sections), profile?.id || null, now);
  return { id, ownerId, bookId: sourceBookId, subject, grade, chapterIds, chapterTitles, examType, examMode, olympiadMaterial: olympiad ? { id: olympiad.id, title: olympiad.title } : null, difficulty, sections, totalScore: sections.reduce((sum, item) => sum + item.score, 0), generationVersion: 1, style: profile ? { id: profile.id, sourceType: profile.sourceType } : null, createdAt: now };
}

export async function createAssessmentPaper(request: Record<string, unknown>, dependencies: AssessmentPaperDependencies = {}) {
  const database = dependencies.database || db; const ownerId = parseLearningOwnerId(request.ownerId); const blueprintId = parseString(request.blueprintId, 'blueprintId');
  const row = database.prepare(`SELECT id, ownerId, bookId, chapterIdsJson, examType, examMode, olympiadBookId, difficulty, sectionsJson, styleProfileId FROM assessment_blueprints WHERE id = ? AND ownerId = ?`).get(blueprintId, ownerId) as { id: string; ownerId: string; bookId: string; chapterIdsJson: string; examType: ExamType; examMode: ExamMode; olympiadBookId: string | null; difficulty: Difficulty; sectionsJson: string; styleProfileId: string | null } | undefined;
  if (!row) throw new AssessmentPaperValidationError('blueprintId', '命题蓝图不存在于当前本地资料上下文中');
  const olympiad = row.examMode === 'olympiad' ? olympiadStyle(database, ownerId, row.olympiadBookId) : null;
  const book = olympiad ? null : requireBook(database, row.bookId, ownerId);
  const chapterIds = JSON.parse(row.chapterIdsJson) as string[];
  const chapterTitles = book ? selectedTitles(book, chapterIds) : [];
  const profile = styleSummary(database, ownerId, row.styleProfileId);
  const blueprint = { id: row.id, subject: olympiad ? '数学' : normalizeSubject(book!.subject), grade: olympiad?.grade || book!.grade, chapterTitles, examType: row.examType, examMode: row.examMode, difficulty: row.difficulty, sections: JSON.parse(row.sectionsJson) };
  const generated = await (dependencies.generatePaper || generateOriginalPaper)({
    ...blueprint,
    ...(book ? { textbookExcerpt: selectedExcerpt(await (dependencies.readMarkdown || ((path: string) => fs.readFile(path, 'utf-8')))(book.mdPath!), chapterTitles) } : {}),
    styleSummary: profile?.summary || null,
    olympiadStyle: olympiad,
  }); const content = validatePaper(generated, blueprint); const version = (database.prepare(`SELECT COUNT(*) AS count FROM assessment_papers WHERE blueprintId = ?`).get(row.id) as { count: number }).count + 1; const id = randomUUID(); const now = Date.now();
  database.prepare(`INSERT INTO assessment_papers (id, blueprintId, ownerId, schemaVersion, contentJson, totalScore, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, row.id, ownerId, content.schemaVersion, JSON.stringify({ ...content, generationVersion: version, blueprint }), content.totalScore, 'completed', now);
  return { id, blueprintId: row.id, ownerId, generationVersion: version, schemaVersion: content.schemaVersion, status: 'completed', totalScore: content.totalScore, content, createdAt: now };
}

export function getAssessmentPaper(id: unknown, ownerIdInput: unknown, database: Database.Database = db) {
  const ownerId = parseLearningOwnerId(ownerIdInput); const paperId = parseString(id, 'id'); const row = database.prepare(`SELECT id, blueprintId, ownerId, schemaVersion, contentJson, totalScore, status, createdAt FROM assessment_papers WHERE id = ? AND ownerId = ?`).get(paperId, ownerId) as Record<string, unknown> | undefined;
  if (!row) return null; const content = JSON.parse(String(row.contentJson)); return { ...row, generationVersion: content.generationVersion, content };
}

export function isAssessmentPaperInputError(error: unknown): error is AssessmentPaperValidationError | LearningOwnerContextError { return error instanceof AssessmentPaperValidationError || error instanceof LearningOwnerContextError; }
