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

type TextbookAction = 'courseware' | 'classroom_quiz' | 'english_listening' | 'video' | 'math_thinking' | 'assessment';
type ChapterNode = { id: string; title: string; children?: ChapterNode[] };
type Book = { id: string; title: string; subject: string; grade: string | null; ownerId: string; status: string; mdPath: string | null; tableOfContents: string | null };

export class TextbookTaskUnavailableError extends Error {
  constructor(public readonly code: 'capability_unavailable' | 'resource_unavailable', message: string) { super(message); }
}

export interface TextbookTaskDependencies {
  database?: Database.Database;
  readMarkdown?: (path: string) => Promise<string>;
  generate?: (input: { action: TextbookAction; subject: string; chapterTitles: string[]; excerpt: string }) => Promise<{ slides?: any[]; questions?: any[] }>;
  createAssessmentBlueprint?: typeof createAssessmentBlueprint;
  createAssessmentPaper?: typeof createAssessmentPaper;
}

function json<T>(value: string | null, fallback: T): T { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
function text(value: unknown, field: string, label: string, max = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new LearningTaskValidationError(field, `${label}不能为空或过长`);
  return value.trim();
}
function flatten(nodes: ChapterNode[]): ChapterNode[] { return nodes.flatMap(node => [node, ...flatten(Array.isArray(node.children) ? node.children : [])]); }
function taskType(action: TextbookAction): LearningTaskType { return action; }
function bookFor(database: Database.Database, ownerId: string, bookId: unknown): Book {
  const id = text(bookId, 'source.bookId', '教材');
  const book = database.prepare(`SELECT id, title, subject, grade, ownerId, status, mdPath, tableOfContents FROM books WHERE id = ? AND (ownerId = ? OR ownerId = 'shared')`).get(id, ownerId) as Book | undefined;
  if (!book) throw new LearningTaskValidationError('source.bookId', '教材不在当前家庭资料范围内');
  if (book.status !== 'completed' || !book.mdPath) throw new TextbookTaskUnavailableError('capability_unavailable', '教材尚未完成解析');
  return book;
}
function chaptersFor(book: Book, value: unknown): ChapterNode[] {
  if (!Array.isArray(value) || !value.length || value.some(id => typeof id !== 'string' || !id.trim())) throw new LearningTaskValidationError('source.chapterIds', '至少选择一个具体章节');
  const all = flatten(json<ChapterNode[]>(book.tableOfContents, []));
  const selected = [...new Set(value.map(id => id.trim()))].map(id => all.find(chapter => chapter.id === id));
  if (selected.some(chapter => !chapter?.title?.trim())) throw new LearningTaskValidationError('source.chapterIds', '所选章节不在教材目录中');
  return selected as ChapterNode[];
}
function supported(subject: string): TextbookAction[] {
  const common: TextbookAction[] = ['courseware', 'classroom_quiz', 'video', 'assessment'];
  if (subject === '英语') return [...common, 'english_listening'];
  if (subject === '数学') return [...common, 'math_thinking'];
  return common;
}
function healthyResources(database: Database.Database, subject: string, grade: string | null): Array<{ id: string; title: string; durationSeconds: number; ageLabel: string; embedUrl: string }> {
  if (!grade?.trim()) return [];
  return database.prepare(`SELECT id, title, durationSeconds, ageLabel, embedUrl FROM external_resources
    WHERE subject = ? AND grade = ? AND status = 'approved' AND reviewedAt IS NOT NULL AND linkHealthStatus = 'healthy' AND embedStatus = 'allowed'
      AND title IS NOT NULL AND durationSeconds > 0 AND ageLabel IS NOT NULL AND embedUrl IS NOT NULL`).all(subject, grade) as Array<{ id: string; title: string; durationSeconds: number; ageLabel: string; embedUrl: string }>;
}
function olympiadMaterials(database: Database.Database, ownerId: string, grade: string | null): Array<{ id: string; title: string }> {
  if (!grade?.trim()) return [];
  return database.prepare(`SELECT id, title FROM books WHERE (ownerId = ? OR ownerId = 'shared') AND grade = ? AND subject = '数学' AND (category LIKE '%奥数%' OR tags LIKE '%奥数%') ORDER BY title ASC`).all(ownerId, grade) as Array<{ id: string; title: string }>;
}
async function defaultGenerate(input: { action: TextbookAction; subject: string; chapterTitles: string[]; excerpt: string }): Promise<{ slides?: any[]; questions?: any[] }> {
  const apiKey = process.env.ARK_API_KEY; const model = process.env.ARK_MODEL_ID;
  if (!apiKey || !model) throw new Error('ARK_API_KEY 或 ARK_MODEL_ID 未配置');
  const client = new OpenAI({ apiKey, baseURL: 'https://ark.cn-beijing.volces.com/api/v3' });
  const isCourseware = input.action === 'courseware';
  const prompt = isCourseware
    ? `基于教材章节学习目标生成原创课件。学科：${input.subject}；章节：${input.chapterTitles.join('、')}。仅输出 JSON 数组，每项含 title、content、notes；不复述教材全文。章节摘录：${input.excerpt.slice(0, 6000)}`
    : `基于教材章节学习目标生成原创${input.action === 'math_thinking' ? '数学思维训练' : '随堂测验'}。学科：${input.subject}；章节：${input.chapterTitles.join('、')}。仅输出 JSON 数组，每项含 type、question、answer、explanation、可选 options；不复述教材全文。章节摘录：${input.excerpt.slice(0, 6000)}`;
  const response = await client.chat.completions.create({ model, temperature: 0.4, messages: [{ role: 'system', content: '只输出合法 JSON，不输出 Markdown。' }, { role: 'user', content: prompt }] } as any);
  const raw = (response.choices[0]?.message?.content || '[]').replace(/^```json\n?|\n?```$/g, '').trim();
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('模型返回为空');
  return isCourseware ? { slides: parsed } : { questions: parsed };
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

export function getChapterActions(ownerIdInput: unknown, bookId: unknown, chapterId: unknown, database: Database.Database = db): Array<{ action: TextbookAction; available: boolean; reasonCode?: string; resourceOptions?: Array<{ id: string; title: string; durationSeconds: number; ageLabel: string; embedUrl: string }>; examModes?: Array<'textbook' | 'olympiad'>; olympiadMaterials?: Array<{ id: string; title: string }> }> {
  const ownerId = parseLearningOwnerId(ownerIdInput); const book = bookFor(database, ownerId, bookId); chaptersFor(book, [chapterId]);
  const subject = normalizeSubject(book.subject); const videos = healthyResources(database, subject, book.grade);
  const olympiad = subject === '数学' ? olympiadMaterials(database, ownerId, book.grade) : [];
  return supported(subject).map(action => {
    if (action === 'video') return videos.length ? { action, available: true, resourceOptions: videos } : { action, available: false, reasonCode: 'resource_unavailable' };
    if (action === 'math_thinking' && !olympiad.length) return { action, available: false, reasonCode: 'olympiad_material_unavailable' };
    if (action === 'assessment' && subject === '数学') return { action, available: true, examModes: olympiad.length ? ['textbook', 'olympiad'] : ['textbook'], olympiadMaterials: olympiad };
    return { action, available: true };
  });
}

export async function createTextbookTask(request: Record<string, unknown>, dependencies: TextbookTaskDependencies = {}): Promise<{ id: string; generationStatus: string }> {
  const database = dependencies.database || db; const ownerId = parseLearningOwnerId(request.ownerId); const source = request.source as Record<string, unknown> | undefined;
  if (!source || source.kind !== 'chapter') throw new LearningTaskValidationError('source', '教材任务来源不正确');
  const action = request.taskType as TextbookAction; const book = bookFor(database, ownerId, source.bookId); const chapters = chaptersFor(book, source.chapterIds); const subject = normalizeSubject(book.subject);
  if (!supported(subject).includes(action)) throw new TextbookTaskUnavailableError('capability_unavailable', '该学科不支持此学习动作');
  const videoResources = action === 'video' ? healthyResources(database, subject, book.grade) : [];
  if (action === 'video' && !videoResources.length) throw new TextbookTaskUnavailableError('resource_unavailable', '暂无可核验资源');
  const selectedResource = action === 'video'
    ? videoResources.find(item => item.id === text((source.options as Record<string, unknown> | undefined)?.resourceId, 'source.options.resourceId', '视频资源'))
    : undefined;
  if (action === 'video' && !selectedResource) throw new TextbookTaskUnavailableError('resource_unavailable', '暂无可核验资源');
  const assessmentOptions = action === 'assessment' ? (source.options as Record<string, unknown> | undefined || {}) : null;
  const examMode = assessmentOptions?.examMode === undefined || assessmentOptions?.examMode === null || assessmentOptions?.examMode === '' ? 'textbook' : assessmentOptions.examMode;
  if (action === 'assessment' && examMode !== 'textbook' && examMode !== 'olympiad') throw new LearningTaskValidationError('source.options.examMode', '考试模式不支持');
  if (action === 'assessment' && examMode === 'olympiad') {
    if (subject !== '数学') throw new TextbookTaskUnavailableError('capability_unavailable', '奥数模拟考试仅支持数学');
    const materialId = text(assessmentOptions?.olympiadBookId, 'source.options.olympiadBookId', '奥数资料');
    if (!olympiadMaterials(database, ownerId, book.grade).some(material => material.id === materialId)) throw new TextbookTaskUnavailableError('resource_unavailable', '暂无年级匹配的奥数资料');
  }
  const title = `${chapters.map(chapter => chapter.title).join('、')}·${action}`;
  const { task, created } = createLearningTask(database, { ownerId, requestKey: request.requestKey, taskType: taskType(action), sourceType: 'chapter', subject, grade: book.grade || '未标注年级', title, bookId: book.id, chapterIds: chapters.map(chapter => chapter.id) });
  if (!created) return { id: task.id, generationStatus: task.generationStatus };
  try {
    updateLearningTaskGenerationStatus(database, task.id, 'running');
    if (action === 'video') {
      completeLearningTask(database, task.id, [{ entityType: 'external_resource', entityId: selectedResource!.id, role: 'resource' }]);
      return { id: task.id, generationStatus: 'ready' };
    }
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
      if (!generated.slides?.length) throw new Error('课件生成结果为空');
      database.prepare(`INSERT INTO classroom_items (id, type, bookTitle, chapter, subject, ownerId, userName, contentJson, slideCount, createdAt) VALUES (?, 'courseware', ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(entityId, book.title, chapters.map(chapter => chapter.title).join('、'), subject, ownerId, typeof request.userName === 'string' ? request.userName : '', JSON.stringify(generated.slides.map((slide, index) => ({ index: index + 1, chapter: chapters[0].title, ...slide }))), generated.slides.length, now);
      completeLearningTask(database, task.id, [{ entityType: 'classroom_courseware', entityId, role: 'primary' }]);
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
