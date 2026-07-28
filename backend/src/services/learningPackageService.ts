import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import OpenAI from 'openai';
import Database from 'better-sqlite3';
import db from './databaseService.js';
import { LearningOwnerContextError, parseLearningOwnerId } from './learningDomain.js';
import { normalizeSubject } from '../utils/subject.js';

export const LEARNING_PACKAGE_KINDS = [
  'english-listening',
  'math-thinking',
  'review-outline',
] as const;

export type LearningPackageKind = typeof LEARNING_PACKAGE_KINDS[number];

export interface LearningPackageRequest {
  ownerId: unknown;
  bookId: unknown;
  chapterIds: unknown;
  kind: unknown;
}

export interface EnglishListeningContent {
  script: string;
  questions: Array<{
    id: string;
    prompt: string;
    options?: string[];
    answer: string;
    rubricPoints: string[];
  }>;
}

interface BookRow {
  id: string;
  ownerId: string;
  subject: string;
  grade: string | null;
  tableOfContents: string | null;
  mdPath: string | null;
  status: string;
}

interface ChapterNode {
  id: string;
  title: string;
  children?: ChapterNode[];
}

export class LearningPackageValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = 'LearningPackageValidationError';
  }
}

export interface LearningPackageDependencies {
  database?: Database.Database;
  readMarkdown?: (filePath: string) => Promise<string>;
  generateEnglishListening?: (input: { chapterTitles: string[]; chapterExcerpt: string }) => Promise<EnglishListeningContent>;
}

function parseChapterIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(id => typeof id !== 'string' || !id.trim())) {
    throw new LearningPackageValidationError('chapterIds', '至少选择一个有效章节');
  }
  return [...new Set(value.map(id => id.trim()))];
}

function parsePackageKind(value: unknown): LearningPackageKind {
  if (typeof value !== 'string' || !LEARNING_PACKAGE_KINDS.includes(value as LearningPackageKind)) {
    throw new LearningPackageValidationError('kind', '学习包类型不支持');
  }
  return value as LearningPackageKind;
}

function parseTableOfContents(value: string | null): ChapterNode[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function flattenChapters(nodes: ChapterNode[]): ChapterNode[] {
  return nodes.flatMap(node => [node, ...flattenChapters(Array.isArray(node.children) ? node.children : [])]);
}

function requireBook(database: Database.Database, bookId: unknown, ownerId: string): BookRow {
  if (typeof bookId !== 'string' || !bookId.trim()) {
    throw new LearningPackageValidationError('bookId', '教材不能为空');
  }
  const book = database.prepare(`
    SELECT id, ownerId, subject, grade, tableOfContents, mdPath, status
    FROM books
    WHERE id = ? AND (ownerId = ? OR ownerId = 'shared')
  `).get(bookId.trim(), ownerId) as BookRow | undefined;
  if (!book) throw new LearningPackageValidationError('bookId', '教材不在当前本地资料上下文中');
  if (book.status !== 'completed' || !book.mdPath) {
    throw new LearningPackageValidationError('bookId', '教材尚未完成解析，暂时不能创建学习包');
  }
  return book;
}

function requireChapters(book: BookRow, chapterIds: string[]): ChapterNode[] {
  const chapters = flattenChapters(parseTableOfContents(book.tableOfContents));
  if (chapters.length === 0) throw new LearningPackageValidationError('chapterIds', '教材缺少可用章节目录');
  const selected = chapterIds.map(id => chapters.find(chapter => chapter.id === id));
  if (selected.some(chapter => !chapter?.title?.trim())) {
    throw new LearningPackageValidationError('chapterIds', '所选章节不在教材目录中');
  }
  return selected as ChapterNode[];
}

function requireSubject(book: BookRow, expected: string): void {
  if (normalizeSubject(book.subject) !== expected) {
    throw new LearningPackageValidationError('bookId', `该学习包只支持${expected}教材`);
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function chapterTitleCandidates(title: string): string[] {
  const normalizedTitle = normalizeText(title);
  const unit = normalizedTitle.match(/^(unit\s*\d+)\b/i)?.[1];
  const chineseUnit = normalizedTitle.match(/^(第[一二三四五六七八九十0-9]+单元)/)?.[1];
  return [...new Set([normalizedTitle, unit, chineseUnit].filter((value): value is string => Boolean(value)))];
}

function extractChapterExcerpt(markdown: string, selected: ChapterNode[], allChapters: ChapterNode[]): string {
  const lines = markdown.split(/\r?\n/);
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }

  const titleToOffset = new Map<string, number>();
  for (const chapter of allChapters) {
    const candidates = chapterTitleCandidates(chapter.title || '');
    if (candidates.length === 0 || titleToOffset.has(chapter.id)) continue;
    const lineIndex = lines.findIndex(line => {
      const heading = line.match(/^\s*#{1,6}\s+(.+)$/);
      if (!heading) return false;
      const normalized = normalizeText(heading[1]);
      return candidates.some(candidate => normalized === candidate || normalized.startsWith(`${candidate} `));
    });
    if (lineIndex >= 0) titleToOffset.set(chapter.id, offsets[lineIndex]);
  }

  const excerpts = selected.map(chapter => {
    const start = titleToOffset.get(chapter.id);
    if (start === undefined) {
      throw new LearningPackageValidationError('chapterIds', `教材中找不到“${chapter.title}”的正文`);
    }
    const nextOffsets = [...titleToOffset.entries()]
      .filter(([id, position]) => id !== chapter.id && position > start)
      .map(([, position]) => position);
    const end = nextOffsets.length > 0 ? Math.min(...nextOffsets) : markdown.length;
    const excerpt = markdown.slice(start, end).trim();
    if (excerpt.length < 80) {
      throw new LearningPackageValidationError('chapterIds', `“${chapter.title}”没有足够的章节正文`);
    }
    return excerpt;
  });
  return excerpts.join('\n\n').slice(0, 12000);
}

function parseGeneratedListening(raw: string): EnglishListeningContent {
  const normalized = raw.replace(/^```json\s*|\s*```$/g, '').trim();
  const parsed = JSON.parse(normalized) as EnglishListeningContent;
  if (!parsed.script?.trim() || !Array.isArray(parsed.questions) || parsed.questions.length < 2) {
    throw new Error('模型未返回完整的原创听力结构');
  }
  for (const question of parsed.questions) {
    if (!question?.id || !question.prompt?.trim() || !question.answer?.trim() || !Array.isArray(question.rubricPoints) || question.rubricPoints.length === 0) {
      throw new Error('模型返回的听力题目缺少评分信息');
    }
  }
  return parsed;
}

export async function generateOriginalEnglishListening(input: { chapterTitles: string[]; chapterExcerpt: string }): Promise<EnglishListeningContent> {
  const apiKey = process.env.ARK_API_KEY;
  const model = process.env.ARK_MODEL_ID;
  if (!apiKey || !model) throw new Error('英语听力生成服务未配置');

  const client = new OpenAI({ apiKey, baseURL: 'https://ark.cn-beijing.volces.com/api/v3' });
  const response = await client.chat.completions.create({
    model,
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: '你是小学英语听力练习编写者。只输出 JSON。请基于章节学习目标创作全新的短对话或短文与理解题；不得复制、改写或引用输入教材的任何完整句子，不能声称是教材原声或真题。',
      },
      {
        role: 'user',
        content: `章节：${input.chapterTitles.join('、')}\n\n教材章节内容（仅作知识点锚点）：\n${input.chapterExcerpt}\n\n返回：{ "script": "原创英文听力稿", "questions": [{ "id": "q1", "prompt": "题目", "options": ["A", "B", "C"], "answer": "答案", "rubricPoints": ["评分点"] }] }。至少 3 题。`,
      },
    ],
  });
  return parseGeneratedListening(response.choices[0]?.message?.content || '');
}

export async function createLearningPackage(
  request: LearningPackageRequest,
  dependencies: LearningPackageDependencies = {},
): Promise<Record<string, unknown>> {
  const database = dependencies.database || db;
  const ownerId = parseLearningOwnerId(request.ownerId);
  const chapterIds = parseChapterIds(request.chapterIds);
  const kind = parsePackageKind(request.kind);
  const book = requireBook(database, request.bookId, ownerId);
  const selected = requireChapters(book, chapterIds);
  const now = Date.now();
  const id = randomUUID();
  let content: Record<string, unknown>;

  if (kind === 'english-listening') {
    requireSubject(book, '英语');
    const markdown = await (dependencies.readMarkdown || ((filePath: string) => fs.readFile(filePath, 'utf-8')))(book.mdPath!);
    const chapterExcerpt = extractChapterExcerpt(markdown, selected, flattenChapters(parseTableOfContents(book.tableOfContents)));
    const listening = await (dependencies.generateEnglishListening || generateOriginalEnglishListening)({
      chapterTitles: selected.map(chapter => chapter.title),
      chapterExcerpt,
    });
    content = {
      original: true,
      listening,
      audio: {
        endpoint: '/api/tts',
        request: { text: listening.script, coursewareId: id, chunkIdx: 0 },
      },
    };
  } else if (kind === 'math-thinking') {
    requireSubject(book, '数学');
    content = {
      original: true,
      chapterTitles: selected.map(chapter => chapter.title),
      training: {
        focus: ['数感', '数形结合', '方程思维'],
        checklist: ['回顾本章关键数量关系', '用图示或表格表达题意', '完成本章原创思维训练'],
      },
    };
  } else {
    content = {
      original: true,
      outline: selected.map(chapter => ({
        chapterId: chapter.id,
        title: chapter.title,
        checklist: ['回顾教材要点', '整理本章概念与例题', '完成本章原创练习'],
      })),
    };
  }

  database.prepare(`
    INSERT INTO learning_packages (
      id, ownerId, bookId, chapterIdsJson, kind, contentJson, status, version, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ownerId, book.id, JSON.stringify(chapterIds), kind, JSON.stringify(content), 'completed', 1, now, now);

  return {
    id,
    ownerId,
    bookId: book.id,
    chapterIds,
    kind,
    status: 'completed',
    version: 1,
    content,
    createdAt: now,
  };
}

function requireEnglishListeningPackage(id: unknown, ownerId: string, database: Database.Database): string {
  if (typeof id !== 'string' || !id.trim()) throw new LearningPackageValidationError('id', '学习包不能为空');
  const row = database.prepare('SELECT id, kind FROM learning_packages WHERE id = ? AND ownerId = ?').get(id.trim(), ownerId) as { id: string; kind: string } | undefined;
  if (!row) throw new LearningPackageValidationError('id', '学习包不存在于当前本地资料上下文');
  if (row.kind !== 'english-listening') throw new LearningPackageValidationError('id', '只有英语听力支持播放进度');
  return row.id;
}

export function getLearningPackageProgress(id: unknown, ownerIdInput: unknown, database: Database.Database = db): Record<string, unknown> {
  const ownerId = parseLearningOwnerId(ownerIdInput);
  const packageId = requireEnglishListeningPackage(id, ownerId, database);
  const row = database.prepare('SELECT completedPlays, submittedAt FROM learning_package_progress WHERE ownerId = ? AND packageId = ?').get(ownerId, packageId) as { completedPlays: number; submittedAt: number | null } | undefined;
  const completedPlays = row?.completedPlays || 0;
  return { completedPlays, playsRemaining: Math.max(0, 2 - completedPlays), submittedAt: row?.submittedAt || null, canPlay: completedPlays < 2 };
}

export function updateLearningPackagePlayback(id: unknown, ownerIdInput: unknown, event: unknown, database: Database.Database = db): Record<string, unknown> {
  const ownerId = parseLearningOwnerId(ownerIdInput);
  const packageId = requireEnglishListeningPackage(id, ownerId, database);
  if (event !== 'completed' && event !== 'submit') throw new LearningPackageValidationError('event', '播放事件不支持');
  const now = Date.now();
  const result = database.transaction(() => {
    const current = database.prepare('SELECT completedPlays, submittedAt FROM learning_package_progress WHERE ownerId = ? AND packageId = ?').get(ownerId, packageId) as { completedPlays: number; submittedAt: number | null } | undefined;
    const plays = current?.completedPlays || 0;
    if (event === 'completed' && plays >= 2) throw new LearningPackageValidationError('event', '完整播放次数已用完');
    const nextPlays = event === 'completed' ? plays + 1 : plays;
    const submittedAt = event === 'submit' ? (current?.submittedAt || now) : (current?.submittedAt || null);
    database.prepare(`INSERT INTO learning_package_progress (ownerId, packageId, completedPlays, submittedAt, updatedAt)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(ownerId, packageId) DO UPDATE SET completedPlays = excluded.completedPlays, submittedAt = excluded.submittedAt, updatedAt = excluded.updatedAt`
    ).run(ownerId, packageId, nextPlays, submittedAt, now);
    return { completedPlays: nextPlays, playsRemaining: Math.max(0, 2 - nextPlays), submittedAt, canPlay: nextPlays < 2 };
  });
  return result();
}

export function getLearningPackage(id: unknown, ownerIdInput: unknown, database: Database.Database = db): Record<string, unknown> | null {
  const ownerId = parseLearningOwnerId(ownerIdInput);
  if (typeof id !== 'string' || !id.trim()) throw new LearningPackageValidationError('id', '学习包不能为空');
  const row = database.prepare(`
    SELECT id, ownerId, bookId, chapterIdsJson, kind, contentJson, status, version, createdAt, updatedAt
    FROM learning_packages
    WHERE id = ? AND ownerId = ?
  `).get(id.trim(), ownerId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const data = {
    ...row,
    chapterIds: JSON.parse(String(row.chapterIdsJson)),
    content: JSON.parse(String(row.contentJson)),
  };
  return row.kind === 'english-listening' ? { ...data, playback: getLearningPackageProgress(id, ownerId, database) } : data;
}

export function isLearningPackageInputError(error: unknown): error is LearningPackageValidationError | LearningOwnerContextError {
  return error instanceof LearningPackageValidationError || error instanceof LearningOwnerContextError;
}
