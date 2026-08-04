import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import OpenAI from 'openai';
import db from './databaseService.js';
import { LearningTaskValidationError, WrongProblemRef, createLearningTask, updateLearningTaskGenerationStatus } from './learningTaskService.js';
import { parseLearningOwnerId } from './learningDomain.js';
import { normalizeSubject } from '../utils/subject.js';

interface ResolvedWrongProblem {
  ref: WrongProblemRef;
  subject: string;
  content: string;
  standardAnswer: string;
  studentAnswer: string;
  explanation: string;
  knowledgePoints: string[];
  createdAt: number;
}

export interface WrongProblemCandidate {
  source: WrongProblemRef['source'];
  scannedItemId?: string;
  quizResultId?: string;
  paperAttemptId?: string;
  problemIndex: number;
  subject: string;
  title: string;
  contentExcerpt: string;
  knowledgePoints: string[];
  createdAt: number;
}

export interface WrongReviewGeneration {
  slides: Array<{ title: string; content: string; notes?: string }>;
  questions: Array<{ type: string; question: string; answer: string; explanation: string; options?: string[] }>;
}

export interface WrongReviewDependencies {
  database?: Database.Database;
  generate?: (input: { subject: string; knowledgePoints: string[]; problems: ResolvedWrongProblem[] }) => Promise<WrongReviewGeneration>;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function requireText(value: unknown, field: string, label: string, maxLength = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new LearningTaskValidationError(field, `${label}不能为空或过长`);
  }
  return value.trim();
}

function toReference(value: unknown): WrongProblemRef {
  if (!value || typeof value !== 'object') throw new LearningTaskValidationError('source.problems', '错题引用格式不正确');
  const ref = value as { source?: unknown; scannedItemId?: unknown; quizResultId?: unknown; paperAttemptId?: unknown; problemIndex?: unknown };
  if (!Number.isInteger(ref.problemIndex) || (ref.problemIndex as number) < 0) {
    throw new LearningTaskValidationError('source.problems', '错题序号不正确');
  }
  if (ref.source === 'scanned_item') {
    return { source: 'scanned_item', scannedItemId: requireText(ref.scannedItemId, 'source.problems', '错题本来源'), problemIndex: ref.problemIndex as number };
  }
  if (ref.source === 'quiz_result') {
    return { source: 'quiz_result', quizResultId: requireText(ref.quizResultId, 'source.problems', '课堂作答来源'), problemIndex: ref.problemIndex as number };
  }
  if (ref.source === 'paper_attempt') {
    return { source: 'paper_attempt', paperAttemptId: requireText(ref.paperAttemptId, 'source.problems', '试卷作答来源'), problemIndex: ref.problemIndex as number };
  }
  throw new LearningTaskValidationError('source.problems', '错题来源类型不支持');
}

function uniqueReferences(value: unknown): WrongProblemRef[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    throw new LearningTaskValidationError('source.problems', '一次需选择 1 至 10 道错题');
  }
  const references = value.map(toReference);
  const unique = new Map(references.map(ref => [
    ref.source === 'scanned_item'
      ? `${ref.source}:${ref.scannedItemId}:${ref.problemIndex}`
      : ref.source === 'quiz_result'
        ? `${ref.source}:${ref.quizResultId}:${ref.problemIndex}`
        : `${ref.source}:${ref.paperAttemptId}:${ref.problemIndex}`,
    ref,
  ]));
  if (unique.size !== references.length) throw new LearningTaskValidationError('source.problems', '不能重复选择同一道错题');
  return [...unique.values()];
}

function resolveScannedProblem(database: Database.Database, ownerId: string, ref: Extract<WrongProblemRef, { source: 'scanned_item' }>): ResolvedWrongProblem {
  const row = database.prepare(`
    SELECT subject, problemsJson, timestamp FROM scanned_items
    WHERE id = ? AND ownerId = ? AND type = 'wrong_problem'
  `).get(ref.scannedItemId, ownerId) as { subject: string; problemsJson: string | null; timestamp: number } | undefined;
  if (!row) throw new LearningTaskValidationError('source.problems', '错题本记录不存在于当前学生档案');
  const item = parseJson<Array<Record<string, unknown>>>(row.problemsJson, [])[ref.problemIndex];
  const content = String(item?.content || item?.question || '').trim();
  const standardAnswer = String(item?.standardAnswer || item?.answer || '').trim();
  if (!content || !standardAnswer) throw new LearningTaskValidationError('source.problems', '错题本记录缺少题干或参考答案');
  return {
    ref,
    subject: normalizeSubject(row.subject),
    content,
    standardAnswer,
    studentAnswer: String(item?.studentAnswer || '').trim(),
    explanation: String(item?.explanation || item?.teacherComment || '').trim(),
    knowledgePoints: Array.isArray(item?.knowledgePoints) ? item.knowledgePoints.filter((point): point is string => typeof point === 'string' && Boolean(point.trim())).map(point => point.trim()) : [],
    createdAt: row.timestamp,
  };
}

function resolveQuizResultProblem(database: Database.Database, ownerId: string, ref: Extract<WrongProblemRef, { source: 'quiz_result' }>): ResolvedWrongProblem {
  const row = database.prepare(`
    SELECT subject, chapter, resultsJson, createdAt FROM quiz_results WHERE id = ? AND ownerId = ?
  `).get(ref.quizResultId, ownerId) as { subject: string; chapter: string | null; resultsJson: string | null; createdAt: number } | undefined;
  if (!row) throw new LearningTaskValidationError('source.problems', '课堂作答记录不存在于当前学生档案');
  const item = parseJson<Array<Record<string, unknown>>>(row.resultsJson, [])[ref.problemIndex];
  const questionId = String(item?.questionId || item?.id || '');
  const marked = database.prepare(`
    SELECT 1 FROM answer_review_flags
    WHERE ownerId = ? AND sourceType = 'quiz_result' AND sourceId = ? AND questionId = ?
  `).get(ownerId, ref.quizResultId, questionId);
  if (!marked) throw new LearningTaskValidationError('source.problems', '只能选择已标记需巩固的课堂作答题目');
  const content = String(item.question || '').trim();
  const standardAnswer = String(item.referenceAnswer || item.correctAnswer || '').trim();
  if (!content || !standardAnswer) throw new LearningTaskValidationError('source.problems', '课堂作答记录缺少题干或参考答案');
  const chapter = row.chapter?.trim();
  return {
    ref,
    subject: normalizeSubject(row.subject),
    content,
    standardAnswer,
    studentAnswer: String(item.studentAnswer || '').trim(),
    explanation: String(item.explanation || '').trim(),
    knowledgePoints: chapter ? [chapter] : [],
    createdAt: row.createdAt,
  };
}

function resolvePaperAttemptProblem(database: Database.Database, ownerId: string, ref: Extract<WrongProblemRef, { source: 'paper_attempt' }>): ResolvedWrongProblem {
  const row = database.prepare(`
    SELECT attempt.reviewSnapshotJson, attempt.createdAt, paper.contentJson,
           blueprint.chapterIdsJson, book.subject, book.tableOfContents
    FROM paper_attempts attempt JOIN assessment_papers paper ON paper.id = attempt.paperId AND paper.ownerId = attempt.ownerId
    LEFT JOIN assessment_blueprints blueprint ON blueprint.id = paper.blueprintId AND blueprint.ownerId = attempt.ownerId
    LEFT JOIN books book ON book.id = blueprint.bookId AND (book.ownerId = attempt.ownerId OR book.ownerId = 'shared')
    WHERE attempt.id = ? AND attempt.ownerId = ? AND attempt.status = 'submitted'
  `).get(ref.paperAttemptId, ownerId) as { reviewSnapshotJson: string | null; createdAt: number; contentJson: string; chapterIdsJson: string | null; subject: string | null; tableOfContents: string | null } | undefined;
  if (!row) throw new LearningTaskValidationError('source.problems', '试卷作答记录不存在于当前学生档案');
  const items = parseJson<Array<Record<string, unknown>>>(row.reviewSnapshotJson, []);
  const item = items[ref.problemIndex];
  const questionId = String(item?.questionId || item?.id || '');
  const marked = database.prepare(`SELECT 1 FROM answer_review_flags WHERE ownerId = ? AND sourceType = 'paper_attempt' AND sourceId = ? AND questionId = ?`).get(ownerId, ref.paperAttemptId, questionId);
  if (!marked) throw new LearningTaskValidationError('source.problems', '只能选择已标记需巩固的试卷作答题目');
  const content = String(item?.question || item?.stem || '').trim();
  const standardAnswer = String(item?.referenceAnswer || item?.answer || '').trim();
  if (!content || !standardAnswer) throw new LearningTaskValidationError('source.problems', '试卷作答记录缺少题干或参考答案');
  const paperContent = parseJson<{ blueprint?: { subject?: unknown; chapterTitles?: unknown } }>(row.contentJson, {});
  const subject = normalizeSubject(row.subject || (typeof paperContent.blueprint?.subject === 'string' ? paperContent.blueprint.subject : ''));
  if (!subject) throw new LearningTaskValidationError('source.problems', '试卷未保留学科信息，不能生成跨学科错题讲解');
  const chapterTitles = Array.isArray(paperContent.blueprint?.chapterTitles)
    ? paperContent.blueprint.chapterTitles.filter((title): title is string => typeof title === 'string' && Boolean(title.trim())).map(title => title.trim())
    : selectedChapterTitles(row.tableOfContents, row.chapterIdsJson);
  return { ref, subject, content, standardAnswer, studentAnswer: String(item?.studentAnswer || '').trim(), explanation: String(item?.explanation || '').trim(), knowledgePoints: chapterTitles, createdAt: row.createdAt };
}

function selectedChapterTitles(tableOfContents: string | null, chapterIdsJson: string | null): string[] {
  const ids = new Set(parseJson<unknown[]>(chapterIdsJson, []).map(String));
  const titles: string[] = [];
  const visit = (nodes: unknown[]) => nodes.forEach(node => {
    if (!node || typeof node !== 'object') return;
    const item = node as { id?: unknown; title?: unknown; children?: unknown };
    if (ids.has(String(item.id)) && typeof item.title === 'string' && item.title.trim()) titles.push(item.title.trim());
    if (Array.isArray(item.children)) visit(item.children);
  });
  visit(parseJson<unknown[]>(tableOfContents, []));
  return titles;
}

function resolveProblems(database: Database.Database, ownerId: string, refs: WrongProblemRef[]): ResolvedWrongProblem[] {
  return refs.map(ref => ref.source === 'scanned_item'
    ? resolveScannedProblem(database, ownerId, ref)
    : ref.source === 'quiz_result'
      ? resolveQuizResultProblem(database, ownerId, ref)
      : resolvePaperAttemptProblem(database, ownerId, ref));
}

async function generateWithModel(input: { subject: string; knowledgePoints: string[]; problems: ResolvedWrongProblem[] }): Promise<WrongReviewGeneration> {
  const apiKey = process.env.ARK_API_KEY;
  const model = process.env.ARK_MODEL_ID;
  if (!apiKey || !model) throw new Error('ARK_API_KEY 或 ARK_MODEL_ID 未配置');
  const client = new OpenAI({ apiKey, baseURL: 'https://ark.cn-beijing.volces.com/api/v3' });
  const source = input.problems.map((problem, index) => [
    `题目 ${index + 1}：${problem.content}`,
    `学生作答：${problem.studentAnswer || '未记录'}`,
    `参考答案：${problem.standardAnswer}`,
    `已有讲解：${problem.explanation || '无'}`,
    `知识点：${problem.knowledgePoints.join('、') || '未标注'}`,
  ].join('\n')).join('\n\n');
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.45,
    messages: [
      { role: 'system', content: '你是小学学习辅导老师。仅输出合法 JSON 对象，不得复述原题全文。' },
      { role: 'user', content: `学科：${input.subject}\n知识点范围：${input.knowledgePoints.join('、') || '综合'}\n\n${source}\n\n请生成 JSON：{"slides":[{"title":"...","content":"...","notes":"..."}],"questions":[{"type":"choice|fill|essay","question":"原创题目","options":["A..."],"answer":"...","explanation":"..."}]}。slides 需要聚合讲解每道选题的错误原因和正确思路；questions 只覆盖给定知识点，必须为原创题。` },
    ],
  } as any);
  const raw = (completion.choices[0]?.message?.content || '{}').replace(/^```json\n?|\n?```$/g, '').trim();
  const result = JSON.parse(raw) as WrongReviewGeneration;
  if (!Array.isArray(result.slides) || !result.slides.length || !Array.isArray(result.questions) || !result.questions.length) {
    throw new Error('模型未返回完整的聚合讲解和测验');
  }
  return result;
}

function validateGeneration(value: WrongReviewGeneration): WrongReviewGeneration {
  if (!Array.isArray(value.slides) || !value.slides.length || !Array.isArray(value.questions) || !value.questions.length) {
    throw new Error('聚合讲解或测验为空');
  }
  const slides = value.slides.map((slide, index) => ({
    title: requireText(slide.title, 'generation', `第 ${index + 1} 节讲解标题`),
    content: requireText(slide.content, 'generation', `第 ${index + 1} 节讲解内容`, 4000),
    notes: typeof slide.notes === 'string' ? slide.notes.trim() : '',
  }));
  const questions = value.questions.map((question, index) => ({
    type: requireText(question.type, 'generation', `第 ${index + 1} 道题型`, 32),
    question: requireText(question.question, 'generation', `第 ${index + 1} 道题目`, 4000),
    answer: requireText(question.answer, 'generation', `第 ${index + 1} 道参考答案`, 2000),
    explanation: requireText(question.explanation, 'generation', `第 ${index + 1} 道解析`, 4000),
    ...(Array.isArray(question.options) ? { options: question.options.filter((option): option is string => typeof option === 'string' && Boolean(option.trim())).map(option => option.trim()) } : {}),
  }));
  return { slides, questions };
}

export function listWrongProblemCandidates(ownerIdInput: unknown, subjectInput?: unknown, database: Database.Database = db): WrongProblemCandidate[] {
  const ownerId = parseLearningOwnerId(ownerIdInput);
  const subject = subjectInput === undefined ? null : normalizeSubject(requireText(subjectInput, 'subject', '学科', 64));
  const scanned = database.prepare(`
    SELECT id, subject, problemsJson, timestamp FROM scanned_items WHERE ownerId = ? AND type = 'wrong_problem'
  `).all(ownerId) as Array<{ id: string; subject: string; problemsJson: string | null; timestamp: number }>;
  const quizResults = database.prepare(`
    SELECT result.id, result.subject, result.chapter, result.resultsJson, result.createdAt, flag.questionId
    FROM quiz_results result
    JOIN answer_review_flags flag ON flag.ownerId = result.ownerId AND flag.sourceType = 'quiz_result' AND flag.sourceId = result.id
    WHERE result.ownerId = ?
  `).all(ownerId) as Array<{ id: string; subject: string; chapter: string | null; resultsJson: string | null; createdAt: number; questionId: string }>;
  const paperAttempts = database.prepare(`
    SELECT attempt.id, attempt.createdAt, attempt.reviewSnapshotJson, paper.contentJson,
           blueprint.chapterIdsJson, book.subject, book.tableOfContents, flag.questionId
    FROM paper_attempts attempt
    JOIN assessment_papers paper ON paper.id = attempt.paperId AND paper.ownerId = attempt.ownerId
    LEFT JOIN assessment_blueprints blueprint ON blueprint.id = paper.blueprintId AND blueprint.ownerId = attempt.ownerId
    LEFT JOIN books book ON book.id = blueprint.bookId AND (book.ownerId = attempt.ownerId OR book.ownerId = 'shared')
    JOIN answer_review_flags flag ON flag.ownerId = attempt.ownerId AND flag.sourceType = 'paper_attempt' AND flag.sourceId = attempt.id
    WHERE attempt.ownerId = ? AND attempt.status = 'submitted'
  `).all(ownerId) as Array<{ id: string; createdAt: number; reviewSnapshotJson: string | null; contentJson: string; chapterIdsJson: string | null; subject: string | null; tableOfContents: string | null; questionId: string }>;
  const candidates: WrongProblemCandidate[] = [];
  for (const row of scanned) {
    const normalizedSubject = normalizeSubject(row.subject);
    if (subject && normalizedSubject !== subject) continue;
    parseJson<Array<Record<string, unknown>>>(row.problemsJson, []).forEach((item, problemIndex) => {
      const content = String(item.content || item.question || '').trim();
      const standardAnswer = String(item.standardAnswer || item.answer || '').trim();
      if (!content || !standardAnswer) return;
      candidates.push({ source: 'scanned_item', scannedItemId: row.id, problemIndex, subject: normalizedSubject, title: `${normalizedSubject}错题`, contentExcerpt: content.slice(0, 120), knowledgePoints: Array.isArray(item.knowledgePoints) ? item.knowledgePoints.filter((point): point is string => typeof point === 'string') : [], createdAt: row.timestamp });
    });
  }
  for (const row of quizResults) {
    const normalizedSubject = normalizeSubject(row.subject);
    if (subject && normalizedSubject !== subject) continue;
    parseJson<Array<Record<string, unknown>>>(row.resultsJson, []).forEach((item, problemIndex) => {
      if (String(item.questionId || item.id || '') !== row.questionId) return;
      const content = String(item.question || '').trim();
      const standardAnswer = String(item.referenceAnswer || item.correctAnswer || '').trim();
      if (!content || !standardAnswer) return;
      candidates.push({ source: 'quiz_result', quizResultId: row.id, problemIndex, subject: normalizedSubject, title: row.chapter?.trim() || `${normalizedSubject}课堂错题`, contentExcerpt: content.slice(0, 120), knowledgePoints: row.chapter?.trim() ? [row.chapter.trim()] : [], createdAt: row.createdAt });
    });
  }
  for (const row of paperAttempts) {
    const content = parseJson<{ blueprint?: { subject?: unknown; chapterTitles?: unknown } }>(row.contentJson, {});
    const normalizedSubject = normalizeSubject(row.subject || (typeof content.blueprint?.subject === 'string' ? content.blueprint.subject : ''));
    if (!normalizedSubject || (subject && normalizedSubject !== subject)) continue;
    const knowledgePoints = Array.isArray(content.blueprint?.chapterTitles)
      ? content.blueprint.chapterTitles.filter((title): title is string => typeof title === 'string' && Boolean(title.trim())).map(title => title.trim())
      : selectedChapterTitles(row.tableOfContents, row.chapterIdsJson);
    parseJson<Array<Record<string, unknown>>>(row.reviewSnapshotJson, []).forEach((item, problemIndex) => {
      if (String(item.questionId || item.id || '') !== row.questionId) return;
      const contentExcerpt = String(item.question || item.stem || '').trim();
      const standardAnswer = String(item.referenceAnswer || item.answer || '').trim();
      if (!contentExcerpt || !standardAnswer) return;
      candidates.push({ source: 'paper_attempt', paperAttemptId: row.id, problemIndex, subject: normalizedSubject, title: knowledgePoints[0] || `${normalizedSubject}试卷错题`, contentExcerpt: contentExcerpt.slice(0, 120), knowledgePoints, createdAt: row.createdAt });
    });
  }
  return candidates.sort((left, right) => right.createdAt - left.createdAt);
}

export async function createWrongReviewTask(
  request: Record<string, unknown>,
  dependencies: WrongReviewDependencies = {},
): Promise<{ id: string; title: string; generationStatus: string }> {
  const database = dependencies.database || db;
  const ownerId = parseLearningOwnerId(request.ownerId);
  const source = request.source as Record<string, unknown> | undefined;
  if (!source || source.kind !== 'wrong_problems') throw new LearningTaskValidationError('source', '错题任务来源不正确');
  const subject = normalizeSubject(requireText(source.subject, 'source.subject', '学科', 64));
  const grade = requireText(source.grade, 'source.grade', '年级', 64);
  const references = uniqueReferences(source.problems);
  const problems = resolveProblems(database, ownerId, references);
  if (problems.some(problem => problem.subject !== subject)) {
    throw new LearningTaskValidationError('source.problems', '一次只能选择同一学科的错题');
  }
  const knowledgePoints = [...new Set(problems.flatMap(problem => problem.knowledgePoints))];
  const title = `${knowledgePoints.slice(0, 2).join('、') || subject}·错题讲解与测验`;
  const { task, created } = createLearningTask(database, {
    ownerId,
    requestKey: request.requestKey,
    taskType: 'wrong_review',
    sourceType: 'wrong_problems',
    subject,
    grade,
    title,
    wrongProblemRefs: references,
  });
  if (!created) return { id: task.id, title: task.title, generationStatus: task.generationStatus };

  updateLearningTaskGenerationStatus(database, task.id, 'running');
  try {
    const generated = validateGeneration(await (dependencies.generate || generateWithModel)({ subject, knowledgePoints, problems }));
    const now = Date.now();
    const coursewareId = randomUUID();
    const quizId = randomUUID();
    const sourceProblemId = references.map(ref => ref.source === 'scanned_item' ? `scan:${ref.scannedItemId}:${ref.problemIndex}` : ref.source === 'quiz_result' ? `quiz:${ref.quizResultId}:${ref.problemIndex}` : `paper:${ref.paperAttemptId}:${ref.problemIndex}`).join(',');
    database.transaction(() => {
      database.prepare(`INSERT INTO classroom_items (id, type, bookTitle, chapter, subject, ownerId, userName, contentJson, slideCount, source, sourceProblemId, createdAt)
        VALUES (?, 'courseware', ?, '错题讲解', ?, ?, ?, ?, ?, 'wrong_problem', ?, ?)`
      ).run(coursewareId, title, subject, ownerId, typeof request.userName === 'string' ? request.userName : '', JSON.stringify(generated.slides.map((slide, index) => ({ index: index + 1, chapter: '错题讲解', ...slide }))), generated.slides.length, sourceProblemId, now);
      database.prepare(`INSERT INTO classroom_items (id, type, bookTitle, chapter, subject, ownerId, userName, contentJson, questionCount, source, sourceProblemId, createdAt)
        VALUES (?, 'quiz', ?, '错题测验', ?, ?, ?, ?, ?, 'wrong_problem', ?, ?)`
      ).run(quizId, title, subject, ownerId, typeof request.userName === 'string' ? request.userName : '', JSON.stringify(generated.questions.map((question, index) => ({ id: `q${index + 1}`, ...question }))), generated.questions.length, sourceProblemId, now);
      const insertLegacyLink = database.prepare(`INSERT INTO wrong_problem_quiz_links (id, scannedItemId, problemIndex, ownerId, coursewareId, quizId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const ref of references) {
        if (ref.source === 'scanned_item') insertLegacyLink.run(randomUUID(), ref.scannedItemId, ref.problemIndex, ownerId, coursewareId, quizId, now);
      }
      const insertTaskLink = database.prepare(`INSERT INTO learning_task_links (taskId, entityType, entityId, role, createdAt) VALUES (?, ?, ?, ?, ?)`);
      insertTaskLink.run(task.id, 'classroom_courseware', coursewareId, 'explanation', now);
      insertTaskLink.run(task.id, 'classroom_quiz', quizId, 'practice', now);
      database.prepare(`UPDATE learning_tasks SET generationStatus = 'ready', errorCode = NULL, errorMessage = NULL, updatedAt = ? WHERE id = ?`).run(now, task.id);
      database.prepare(`INSERT INTO learning_task_events (id, taskId, eventType, detailJson, createdAt) VALUES (?, ?, 'ready', ?, ?)`)
        .run(randomUUID(), task.id, JSON.stringify({ linkCount: 2 }), now);
    })();
    return { id: task.id, title, generationStatus: 'ready' };
  } catch (error) {
    const message = error instanceof Error ? error.message : '错题讲解与测验生成失败';
    updateLearningTaskGenerationStatus(database, task.id, 'failed', { errorCode: 'generation_failed', errorMessage: message });
    throw error;
  }
}
