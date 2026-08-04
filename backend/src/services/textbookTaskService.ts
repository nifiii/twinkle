import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import Database from 'better-sqlite3';
import OpenAI from 'openai';
import db from './databaseService.js';
import { createLearningPackage, LearningPackageKind } from './learningPackageService.js';
import { createAssessmentBlueprint, createAssessmentPaper } from './assessmentPaperService.js';
import { LearningTaskValidationError, LearningTaskType, createLearningTask, completeLearningTask, updateLearningTaskGenerationStatus } from './learningTaskService.js';
import { parseLearningOwnerId } from './learningDomain.js';
import { normalizeSubject } from '../utils/subject.js';

type TextbookAction = 'courseware' | 'classroom_quiz' | 'english_listening' | 'math_thinking' | 'assessment';
type ChapterNode = { id: string | number; title: string; children?: ChapterNode[] };
type Book = { id: string; title: string; subject: string; grade: string | null; ownerId: string; status: string; mdPath: string | null; tableOfContents: string | null; category: string | null; tags: string | null };

export class TextbookTaskUnavailableError extends Error {
  constructor(public readonly code: 'capability_unavailable' | 'resource_unavailable', message: string) { super(message); }
}

export interface TextbookTaskDependencies {
  database?: Database.Database;
  readMarkdown?: (path: string) => Promise<string>;
  generate?: (input: { action: TextbookAction; subject: string; chapterTitles: string[]; excerpt: string }) => Promise<{ courseware?: unknown; questions?: any[] }>;
  createAssessmentBlueprint?: typeof createAssessmentBlueprint;
  createAssessmentPaper?: typeof createAssessmentPaper;
}

type StudentCoursewareStep = {
  id: string;
  kind: 'objective' | 'explanation' | 'example' | 'self_check' | 'misconception' | 'summary';
  knowledgePoint: string;
  title: string;
  content: string;
  example?: { prompt: string; walkthrough: string[]; answer: string };
  selfCheck?: { id: string; prompt: string; options?: string[]; answer: string; explanation: string };
};

type StudentCourseware = {
  schemaVersion: 1;
  audience: 'student';
  objectives: string[];
  steps: StudentCoursewareStep[];
  summary: string[];
  studyTip: string;
};

const STUDENT_COURSEWARE_STEP_KINDS = new Set<StudentCoursewareStep['kind']>([
  'objective', 'explanation', 'example', 'self_check', 'misconception', 'summary',
]);

function json<T>(value: string | null, fallback: T): T { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
function text(value: unknown, field: string, label: string, max = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new LearningTaskValidationError(field, `${label}不能为空或过长`);
  return value.trim();
}
function flatten(nodes: ChapterNode[]): ChapterNode[] { return nodes.flatMap(node => [node, ...flatten(Array.isArray(node.children) ? node.children : [])]); }
function taskType(action: TextbookAction): LearningTaskType { return action; }
function isOlympiadMaterial(book: Pick<Book, 'category' | 'tags'>): boolean {
  return /奥数|数学竞赛/.test([book.category || '', ...json<string[]>(book.tags, [])].join(''));
}
function bookFor(database: Database.Database, ownerId: string, bookId: unknown): Book {
  const id = text(bookId, 'source.bookId', '教材');
  const book = database.prepare(`SELECT id, title, subject, grade, ownerId, status, mdPath, tableOfContents, category, tags FROM books WHERE id = ? AND (ownerId = ? OR ownerId = 'shared')`).get(id, ownerId) as Book | undefined;
  if (!book) throw new LearningTaskValidationError('source.bookId', '教材不在当前家庭资料范围内');
  if (isOlympiadMaterial(book)) throw new TextbookTaskUnavailableError('capability_unavailable', '奥数或数学竞赛资料请从奥数模拟考试入口使用');
  if (book.status !== 'completed' || !book.mdPath) throw new TextbookTaskUnavailableError('capability_unavailable', '教材尚未完成解析');
  return book;
}
function chaptersFor(book: Book, value: unknown): ChapterNode[] {
  if (!Array.isArray(value) || !value.length || value.some(id => typeof id !== 'string' || !id.trim())) throw new LearningTaskValidationError('source.chapterIds', '至少选择一个具体章节');
  const all = flatten(json<ChapterNode[]>(book.tableOfContents, []));
  // Route parameters are always strings, while older parsed catalogs stored numeric IDs.
  // Normalize only the comparison and returned task reference so catalog validation stays strict.
  const selected = [...new Set(value.map(id => id.trim()))].map(id => {
    const chapter = all.find(candidate => String(candidate.id) === id);
    return chapter && { ...chapter, id: String(chapter.id) };
  });
  if (selected.some(chapter => !chapter?.title?.trim())) throw new LearningTaskValidationError('source.chapterIds', '所选章节不在教材目录中');
  return selected as ChapterNode[];
}
function supported(subject: string): TextbookAction[] {
  const common: TextbookAction[] = ['courseware', 'classroom_quiz', 'assessment'];
  if (subject === '英语') return [...common, 'english_listening'];
  if (subject === '数学') return [...common, 'math_thinking'];
  return common;
}
export function getOlympiadMaterials(ownerIdInput: unknown, database: Database.Database = db): Array<{ id: string; title: string; grade: string }> {
  const ownerId = parseLearningOwnerId(ownerIdInput);
  return database.prepare(`
    SELECT id, title, grade FROM books
    WHERE (ownerId = ? OR ownerId = 'shared')
      AND subject = '数学'
      AND grade IS NOT NULL AND TRIM(grade) <> ''
      AND (category LIKE '%奥数%' OR category LIKE '%数学竞赛%' OR tags LIKE '%奥数%' OR tags LIKE '%数学竞赛%')
    ORDER BY grade ASC, title ASC
  `).all(ownerId) as Array<{ id: string; title: string; grade: string }>;
}
function textField(value: unknown): value is string { return typeof value === 'string' && Boolean(value.trim()); }

export function validateStudentCourseware(value: unknown): StudentCourseware {
  if (!value || typeof value !== 'object') throw new Error('学生课件结构不是对象');
  const courseware = value as Partial<StudentCourseware>;
  if (courseware.schemaVersion !== 1 || courseware.audience !== 'student') throw new Error('学生课件缺少版本或受众标识');
  if (!Array.isArray(courseware.objectives) || courseware.objectives.length === 0 || courseware.objectives.some(item => !textField(item))) throw new Error('学生课件缺少学习目标');
  if (!Array.isArray(courseware.summary) || courseware.summary.length === 0 || courseware.summary.some(item => !textField(item)) || !textField(courseware.studyTip)) throw new Error('学生课件缺少小结或学习建议');
  if (!Array.isArray(courseware.steps) || courseware.steps.length < 6 || courseware.steps.length > 10) throw new Error('学生课件步骤数必须为 6 至 10');
  const kinds = new Set<string>();
  for (const step of courseware.steps) {
    if (!step || typeof step !== 'object' || !textField(step.id) || !textField(step.kind) || !textField(step.knowledgePoint) || !textField(step.title) || !textField(step.content)) {
      throw new Error('学生课件步骤缺少必要内容');
    }
    if (!STUDENT_COURSEWARE_STEP_KINDS.has(step.kind as StudentCoursewareStep['kind'])) throw new Error('学生课件包含不支持的步骤类型');
    kinds.add(step.kind);
    if (step.kind === 'example' && (!step.example || !textField(step.example.prompt) || !Array.isArray(step.example.walkthrough) || step.example.walkthrough.length === 0 || step.example.walkthrough.some(item => !textField(item)) || !textField(step.example.answer))) throw new Error('学生课件示例不完整');
    if (step.kind === 'self_check' && (!step.selfCheck || !textField(step.selfCheck.id) || !textField(step.selfCheck.prompt) || !textField(step.selfCheck.answer) || !textField(step.selfCheck.explanation))) throw new Error('学生课件自检不完整');
  }
  for (const kind of ['explanation', 'example', 'self_check', 'misconception', 'summary']) if (!kinds.has(kind)) throw new Error(`学生课件缺少 ${kind} 步骤`);
  const serialized = JSON.stringify(courseware);
  if (/teacherNotes|teachingPlan|boardPlan|教师备注|教案|板书安排|课堂管理|家长指导/.test(serialized)) throw new Error('学生课件包含教师侧内容');
  return courseware as StudentCourseware;
}

async function defaultGenerate(input: { action: TextbookAction; subject: string; chapterTitles: string[]; excerpt: string }): Promise<{ courseware?: unknown; questions?: any[] }> {
  const apiKey = process.env.ARK_API_KEY; const model = process.env.ARK_MODEL_ID;
  if (!apiKey || !model) throw new Error('ARK_API_KEY 或 ARK_MODEL_ID 未配置');
  const client = new OpenAI({ apiKey, baseURL: 'https://ark.cn-beijing.volces.com/api/v3' });
  const isCourseware = input.action === 'courseware';
  const prompt = isCourseware
    ? `基于教材章节生成小学生可独立完成的原创自学课件和同章节随堂测验。学科：${input.subject}；章节：${input.chapterTitles.join('、')}。仅输出 JSON 对象：{"courseware":{"schemaVersion":1,"audience":"student","objectives":["..."],"steps":[{"id":"step-1","kind":"objective|explanation|example|self_check|misconception|summary","knowledgePoint":"...","title":"...","content":"...","example":{"prompt":"...","walkthrough":["..."],"answer":"..."},"selfCheck":{"id":"check-1","prompt":"...","options":["..."],"answer":"...","explanation":"..."}}],"summary":["..."],"studyTip":"..."},"questions":[{"type":"...","question":"...","answer":"...","explanation":"...","options":["..."]}]}。步骤必须 6 至 10 个，至少有讲解、示例、自检、易错提醒和小结；禁止教师话术、教案、板书、家长指导；不复述教材全文。章节摘录：${input.excerpt.slice(0, 6000)}`
    : `基于教材章节学习目标生成原创${input.action === 'math_thinking' ? '数学思维训练' : '随堂测验'}。学科：${input.subject}；章节：${input.chapterTitles.join('、')}。仅输出 JSON 数组，每项含 type、question、answer、explanation、可选 options；不复述教材全文。章节摘录：${input.excerpt.slice(0, 6000)}`;
  const response = await client.chat.completions.create({ model, temperature: 0.4, messages: [{ role: 'system', content: '只输出合法 JSON，不输出 Markdown。' }, { role: 'user', content: prompt }] } as any);
  const raw = (response.choices[0]?.message?.content || '[]').replace(/^```json\n?|\n?```$/g, '').trim();
  const parsed = JSON.parse(raw);
  if (isCourseware) {
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { questions?: unknown }).questions)) throw new Error('模型未返回课件与随堂测验');
    return { courseware: (parsed as { courseware?: unknown }).courseware, questions: (parsed as { questions: any[] }).questions };
  }
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('模型返回为空');
  return { questions: parsed };
}
async function excerpt(book: Book, selected: ChapterNode[], read: (path: string) => Promise<string>): Promise<string> {
  const markdown = await read(book.mdPath!);
  const headings = selected.map(chapter => chapter.title).filter(Boolean);
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(line => headings.some(title => line.includes(title)));
  const content = (start >= 0 ? lines.slice(start, start + 180) : lines).join('\n').trim();
  if (content.length < 80) throw new TextbookTaskUnavailableError('capability_unavailable', '教材章节正文不足，无法生成学习内容');
  return content.slice(0, 12000);
}

export function getChapterActions(ownerIdInput: unknown, bookId: unknown, chapterId: unknown, database: Database.Database = db): Array<{ action: TextbookAction; available: boolean; reasonCode?: string }> {
  const ownerId = parseLearningOwnerId(ownerIdInput); const book = bookFor(database, ownerId, bookId); chaptersFor(book, [chapterId]);
  const subject = normalizeSubject(book.subject);
  return supported(subject).map(action => {
    return { action, available: true };
  });
}

export async function createTextbookTask(request: Record<string, unknown>, dependencies: TextbookTaskDependencies = {}): Promise<{ id: string; generationStatus: string }> {
  const database = dependencies.database || db; const ownerId = parseLearningOwnerId(request.ownerId); const source = request.source as Record<string, unknown> | undefined;
  if (!source || source.kind !== 'chapter') throw new LearningTaskValidationError('source', '教材任务来源不正确');
  if (request.taskType === 'video') throw new TextbookTaskUnavailableError('capability_unavailable', '视频学习功能已取消');
  const action = request.taskType as TextbookAction; const book = bookFor(database, ownerId, source.bookId); const chapters = chaptersFor(book, source.chapterIds); const subject = normalizeSubject(book.subject);
  if (!supported(subject).includes(action)) throw new TextbookTaskUnavailableError('capability_unavailable', '该学科不支持此学习动作');
  const assessmentOptions = action === 'assessment' ? (source.options as Record<string, unknown> | undefined || {}) : null;
  const examMode = assessmentOptions?.examMode === undefined || assessmentOptions?.examMode === null || assessmentOptions?.examMode === '' ? 'textbook' : assessmentOptions.examMode;
  if (action === 'assessment' && examMode !== 'textbook' && examMode !== 'olympiad') throw new LearningTaskValidationError('source.options.examMode', '考试模式不支持');
  if (action === 'assessment' && examMode === 'olympiad') {
    throw new TextbookTaskUnavailableError('capability_unavailable', '奥数模拟考试不支持教材章节，请从奥数资料入口创建');
  }
  const title = `${chapters.map(chapter => chapter.title).join('、')}·${action}`;
  const { task, created } = createLearningTask(database, { ownerId, requestKey: request.requestKey, taskType: taskType(action), sourceType: 'chapter', subject, grade: book.grade || '未标注年级', title, bookId: book.id, chapterIds: chapters.map(chapter => chapter.id) });
  if (!created) return { id: task.id, generationStatus: task.generationStatus };
  try {
    updateLearningTaskGenerationStatus(database, task.id, 'running');
    if (action === 'english_listening') {
      const packageData = await createLearningPackage({ ownerId, bookId: book.id, chapterIds: chapters.map(chapter => chapter.id), kind: 'english-listening' }, { database });
      completeLearningTask(database, task.id, [{ entityType: 'learning_package', entityId: String(packageData.id), role: 'primary' }]);
      return { id: task.id, generationStatus: 'ready' };
    }
    if (action === 'assessment') {
      const options = assessmentOptions!;
      const blueprint = await (dependencies.createAssessmentBlueprint || createAssessmentBlueprint)({ ownerId, bookId: book.id, chapterIds: chapters.map(chapter => chapter.id), examType: options.examType || 'unit', examMode, olympiadBookId: options.olympiadBookId, difficulty: options.difficulty || 'standard' }, { database });
      const paper = await (dependencies.createAssessmentPaper || createAssessmentPaper)({ ownerId, blueprintId: blueprint.id }, { database });
      completeLearningTask(database, task.id, [{ entityType: 'assessment_paper', entityId: paper.id, role: 'paper' }]);
      return { id: task.id, generationStatus: 'ready' };
    }
    const generated = await (dependencies.generate || defaultGenerate)({ action, subject, chapterTitles: chapters.map(chapter => chapter.title), excerpt: await excerpt(book, chapters, dependencies.readMarkdown || ((path: string) => fs.readFile(path, 'utf-8'))) });
    const entityId = randomUUID(); const now = Date.now();
    if (action === 'courseware') {
      const courseware = validateStudentCourseware(generated.courseware);
      if (!generated.questions?.length) throw new Error('随堂测验生成结果为空');
      const questions = generated.questions;
      const quizId = randomUUID(); const chapterTitle = chapters.map(chapter => chapter.title).join('、'); const userName = typeof request.userName === 'string' ? request.userName : '';
      database.transaction(() => {
        database.prepare(`INSERT INTO classroom_items (id, type, bookTitle, chapter, subject, ownerId, userName, contentJson, slideCount, createdAt) VALUES (?, 'courseware', ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(entityId, book.title, chapterTitle, subject, ownerId, userName, JSON.stringify(courseware), courseware.steps.length, now);
        database.prepare(`INSERT INTO classroom_items (id, type, bookTitle, chapter, subject, ownerId, userName, contentJson, questionCount, createdAt) VALUES (?, 'quiz', ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(quizId, book.title, chapterTitle, subject, ownerId, userName, JSON.stringify(questions.map((question, index) => ({ id: `q${index + 1}`, ...question }))), questions.length, now);
        completeLearningTask(database, task.id, [
          { entityType: 'classroom_courseware', entityId, role: 'primary' },
          { entityType: 'classroom_quiz', entityId: quizId, role: 'practice' },
        ], now);
      })();
    } else {
      if (!generated.questions?.length) throw new Error('练习生成结果为空');
      database.prepare(`INSERT INTO classroom_items (id, type, bookTitle, chapter, subject, ownerId, userName, contentJson, questionCount, createdAt) VALUES (?, 'quiz', ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(entityId, book.title, chapters.map(chapter => chapter.title).join('、'), subject, ownerId, typeof request.userName === 'string' ? request.userName : '', JSON.stringify(generated.questions.map((question, index) => ({ id: `q${index + 1}`, ...question }))), generated.questions.length, now);
      completeLearningTask(database, task.id, [{ entityType: 'classroom_quiz', entityId, role: 'primary' }]);
    }
    return { id: task.id, generationStatus: 'ready' };
  } catch (error) {
    const unavailable = error instanceof TextbookTaskUnavailableError;
    updateLearningTaskGenerationStatus(database, task.id, unavailable ? 'resource_unavailable' : 'failed', { errorCode: unavailable ? error.code : 'generation_failed', errorMessage: error instanceof Error ? error.message : '教材任务生成失败' });
    throw error;
  }
}

export async function createOlympiadAssessmentTask(request: Record<string, unknown>, dependencies: TextbookTaskDependencies = {}): Promise<{ id: string; generationStatus: string }> {
  const database = dependencies.database || db; const ownerId = parseLearningOwnerId(request.ownerId); const source = request.source as Record<string, unknown> | undefined;
  if (!source || source.kind !== 'olympiad') throw new LearningTaskValidationError('source', '奥数任务来源不正确');
  if (request.taskType !== 'assessment') throw new TextbookTaskUnavailableError('capability_unavailable', '奥数资料仅支持生成模拟考试');
  const materialId = text(source.olympiadBookId, 'source.olympiadBookId', '奥数资料');
  const material = getOlympiadMaterials(ownerId, database).find(item => item.id === materialId);
  if (!material) throw new TextbookTaskUnavailableError('resource_unavailable', '暂无可用的奥数资料');
  const options = source.options as Record<string, unknown> | undefined || {};
  const title = `${material.title}·奥数模拟考试`;
  const { task, created } = createLearningTask(database, {
    ownerId, requestKey: request.requestKey, taskType: 'assessment', sourceType: 'olympiad', subject: '数学', grade: material.grade,
    title, bookId: material.id, chapterIds: [],
  });
  if (!created) return { id: task.id, generationStatus: task.generationStatus };
  try {
    updateLearningTaskGenerationStatus(database, task.id, 'running');
    const blueprint = await (dependencies.createAssessmentBlueprint || createAssessmentBlueprint)({
      ownerId, olympiadBookId: material.id, examType: options.examType || 'unit', examMode: 'olympiad', difficulty: options.difficulty || 'standard',
    }, { database });
    const paper = await (dependencies.createAssessmentPaper || createAssessmentPaper)({ ownerId, blueprintId: blueprint.id }, { database });
    completeLearningTask(database, task.id, [{ entityType: 'assessment_paper', entityId: paper.id, role: 'paper' }]);
    return { id: task.id, generationStatus: 'ready' };
  } catch (error) {
    const unavailable = error instanceof TextbookTaskUnavailableError;
    updateLearningTaskGenerationStatus(database, task.id, unavailable ? 'resource_unavailable' : 'failed', { errorCode: unavailable ? error.code : 'generation_failed', errorMessage: error instanceof Error ? error.message : '奥数试卷生成失败' });
    throw error;
  }
}
