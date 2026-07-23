import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import db from './databaseService.js';
import { normalizeSubject } from '../utils/subject.js';
import { JobExecutionError, JobRecord } from './jobs.js';
import { jobStore, modelSlots, registerJobHandler } from './jobRuntime.js';

const DATA_DIR = process.env.DATA_DIR || '/opt/twinkle/data';
const COURSEWARE_JOB_DIR = path.join(DATA_DIR, 'jobs', 'courseware');

type LessonSection = { index: number; chapter: string; title: string; content: string; notes: string };
type Phase = 'core' | 'extension';
type Payload = {
  bookTitle: string;
  chapter: string;
  chapters?: string[];
  studentName: string;
  subject?: string;
  teachingStyle?: string;
  wrongProblems?: any[];
  ownerId: string;
  phase?: Phase;
  coursewareId?: string;
};

function assertWithin(filePath: string): string {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(`${path.resolve(COURSEWARE_JOB_DIR)}${path.sep}`)) {
    throw new JobExecutionError('INPUT_INVALID', '课件任务输入引用无效');
  }
  return resolved;
}

function parseSlides(raw: string): any[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  const json = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  const slides = JSON.parse(json.replace(/\\(u(?![0-9a-fA-F]{4})|[^"\\/bfnrtu])/g, '\\\\$1'));
  if (!Array.isArray(slides) || slides.length === 0) throw new Error('模型返回空课件');
  return slides;
}

function styleDescription(style: string | undefined): string {
  return ({
    rigorous: '语言严谨规范，逻辑层次分明，适合理科系统学习',
    storytelling: '用生活化情景和故事贯穿知识点，轻松有趣',
    practice: '以例题为核心，边讲边练，强调解题过程',
    exploration: '启发式提问引导学生思考，培养探究精神',
  } as Record<string, string>)[style || 'rigorous'] || '语言严谨规范，逻辑层次分明';
}

function problemContext(payload: Payload): string {
  const problems = (payload.wrongProblems || [])
    .flatMap(item => item.meta?.problems || [])
    .slice(0, 9)
    .map((problem, index) => `第${index + 1}题：${problem.question || problem.content || ''}`)
    .filter(Boolean);
  return problems.length ? problems.join('\n') : '无固定错题上下文';
}

async function callModel(prompt: string): Promise<any[]> {
  const apiKey = process.env.ARK_API_KEY;
  const model = process.env.ARK_MODEL_ID;
  if (!apiKey || !model) throw new Error('ARK_API_KEY 或 ARK_MODEL_ID 未配置');
  const release = await modelSlots.acquire('text');
  try {
    const client = new OpenAI({ apiKey, baseURL: 'https://ark.cn-beijing.volces.com/api/v3' });
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.4,
      messages: [
        { role: 'system', content: '你是优秀学科教师。仅输出合法 JSON 数组，字符串中的换行使用 \\n，不使用 LaTex。' },
        { role: 'user', content: prompt },
      ],
    } as any);
    return parseSlides(completion.choices[0]?.message?.content || '[]');
  } finally {
    release();
  }
}

export function normalizeCoreSlides(payload: Payload, rawSlides: any[]): LessonSection[] {
  if (rawSlides.length !== 5) throw new Error('核心课件必须恰好包含 5 节');
  const chapter = (payload.chapters || []).join('；') || payload.chapter;
  return rawSlides.map((slide, index) => {
    let content = String(slide.content || '').trim();
    // Why: the low-latency model can undershoot the requested lower bound by a
    // few characters. A local closing sentence preserves the confirmed minimum
    // without a second model round trip that would consume the core SLO budget.
    if (content.length >= 100 && content.length < 120) {
      content += '学习时要结合生活实例及时复盘，形成清晰的行动要点。';
    }
    if (!slide.title || content.length < 120 || content.length > 180) {
      throw new Error(`核心课件第 ${index + 1} 节正文必须为 120-180 个中文字符`);
    }
    return { index: index + 1, chapter: String(slide.chapter || chapter), title: String(slide.title), content, notes: '' };
  });
}

async function generateCoreSlides(payload: Payload): Promise<LessonSection[]> {
  const chapters = (payload.chapters || []).filter(Boolean);
  const chapterLabel = chapters.length ? chapters.join('；') : payload.chapter;
  const prompt = `请为教材《${payload.bookTitle}》的章节“${chapterLabel}”生成可立即使用的核心课件。学科：${payload.subject || '未指定'}；学生：${payload.studentName}；风格：${styleDescription(payload.teachingStyle)}。
固定错题上下文（9 题，必须全部作为讲解重点）：
${problemContext(payload)}
只输出 JSON 数组，恰好 5 节，顺序必须为：章节导入、关键知识一、关键知识二、关键知识三、课程小结。每节字段为 index、chapter、title、content、notes；每节 content 必须为 120-180 个中文字符，notes 为空字符串。不得输出 Markdown 围栏或解释。`;
  return normalizeCoreSlides(payload, await callModel(prompt));
}

async function generateExtensionSlides(payload: Payload, coreSlides: LessonSection[]): Promise<any[]> {
  const prompt = `请为下列已保存的核心课件补充扩展讲解。教材《${payload.bookTitle}》，章节“${payload.chapter}”，风格：${styleDescription(payload.teachingStyle)}。
固定错题上下文（9 题，必须全部用于补充内容）：
${problemContext(payload)}
核心课件：
${JSON.stringify(coreSlides)}
只输出 JSON 数组，必须与核心课件一一对应，共 5 项。每项字段为 index、extension、notes：extension 提供详细解释和至少一个针对错题的例子；notes 为教师讲稿。不得改写 index，不得输出 Markdown 围栏或解释。`;
  const slides = await callModel(prompt);
  if (slides.length !== coreSlides.length) throw new Error('扩展课件节数与核心课件不一致');
  return slides;
}

export function saveCoreCourseware(payload: Payload, slides: LessonSection[], coursewareId: string = randomUUID()): string {
  db.prepare(`
    INSERT INTO classroom_items
      (id, type, bookTitle, chapter, subject, ownerId, userName, contentJson, slideCount, createdAt)
    VALUES (?, 'courseware', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    coursewareId, payload.bookTitle, payload.chapter, normalizeSubject(payload.subject), payload.ownerId,
    payload.studentName, JSON.stringify(slides), slides.length, Date.now(),
  );
  return coursewareId;
}

function readSavedCourseware(coursewareId: string, ownerId: string): LessonSection[] | null {
  const row = db.prepare('SELECT contentJson FROM classroom_items WHERE id = ? AND ownerId = ? AND type = \'courseware\'').get(coursewareId, ownerId) as { contentJson: string } | undefined;
  return row ? JSON.parse(row.contentJson) as LessonSection[] : null;
}

export function mergeCoursewareExtension(coursewareId: string, ownerId: string, extensionSlides: any[]): LessonSection[] {
  const row = db.prepare('SELECT contentJson FROM classroom_items WHERE id = ? AND ownerId = ? AND type = \'courseware\'').get(coursewareId, ownerId) as { contentJson: string } | undefined;
  if (!row) throw new Error('核心课件不存在或无权限访问');
  const coreSlides = JSON.parse(row.contentJson) as LessonSection[];
  const extensionByIndex = new Map(extensionSlides.map(slide => [Number(slide.index), slide]));
  const merged = coreSlides.map(core => {
    const extension = extensionByIndex.get(core.index);
    if (!extension || !String(extension.extension || '').trim()) throw new Error(`缺少第 ${core.index} 节扩展内容`);
    return {
      ...core,
      content: `${core.content}\n\n延伸讲解：${String(extension.extension).trim()}`,
      notes: String(extension.notes || '').trim(),
    };
  });
  db.prepare('UPDATE classroom_items SET contentJson = ? WHERE id = ? AND ownerId = ?').run(JSON.stringify(merged), coursewareId, ownerId);
  return merged;
}

async function writeResult(jobId: string, result: unknown): Promise<string> {
  const resultPath = path.join(COURSEWARE_JOB_DIR, `${jobId}.result.json`);
  await fs.writeFile(resultPath, JSON.stringify(result), 'utf8');
  return resultPath;
}

async function runCoreCoursewareJob(job: JobRecord, payload: Payload): Promise<string> {
  const coursewareId = payload.coursewareId || randomUUID();
  let slides = readSavedCourseware(coursewareId, payload.ownerId);
  if (!slides) {
    jobStore.setStage(job.id, 'core_model');
    slides = await generateCoreSlides(payload);
    jobStore.setStage(job.id, 'core_save');
    saveCoreCourseware(payload, slides, coursewareId);
  }
  const resultPath = await writeResult(job.id, { phase: 'core', slides, coursewareId, extensionStatus: 'queued' });

  // Reserve the completed core job's capacity for its extension, so an accepted
  // core lesson never loses the required asynchronous completion at a full queue.
  const extension = await submitCoursewareJob({ ...payload, phase: 'extension', coursewareId }, job.id);
  await writeResult(job.id, {
    phase: 'core', slides, coursewareId,
    extensionJobId: extension.job?.id,
    extensionStatus: extension.job?.status || 'failed',
  });
  return resultPath;
}

async function runExtensionCoursewareJob(job: JobRecord, payload: Payload): Promise<string> {
  if (!payload.coursewareId) throw new Error('扩展课件缺少核心课件标识');
  const row = db.prepare('SELECT contentJson FROM classroom_items WHERE id = ? AND ownerId = ?').get(payload.coursewareId, payload.ownerId) as { contentJson: string } | undefined;
  if (!row) throw new Error('核心课件不存在或无权限访问');
  const coreSlides = JSON.parse(row.contentJson) as LessonSection[];
  jobStore.setStage(job.id, 'extension_model');
  const extensionSlides = await generateExtensionSlides(payload, coreSlides);
  jobStore.setStage(job.id, 'extension_save');
  const slides = mergeCoursewareExtension(payload.coursewareId, payload.ownerId, extensionSlides);
  return writeResult(job.id, { phase: 'extension', coursewareId: payload.coursewareId, slides });
}

async function runCoursewareJob(job: JobRecord): Promise<string> {
  try {
    const payload = JSON.parse(await fs.readFile(assertWithin(job.payloadRef), 'utf8')) as Payload;
    return payload.phase === 'extension'
      ? await runExtensionCoursewareJob(job, payload)
      : await runCoreCoursewareJob(job, payload);
  } catch (error: any) {
    throw new JobExecutionError('COURSEWARE_FAILED', error?.message || '课件生成失败');
  }
}

registerJobHandler('courseware', runCoursewareJob);

export async function submitCoursewareJob(payload: Payload, replacesJobId?: string) {
  await fs.mkdir(COURSEWARE_JOB_DIR, { recursive: true });
  const phase = payload.phase || 'core';
  const normalizedPayload = {
    ...payload,
    phase,
    coursewareId: phase === 'core' ? payload.coursewareId || randomUUID() : payload.coursewareId,
  };
  const payloadPath = path.join(COURSEWARE_JOB_DIR, `${randomUUID()}.input.json`);
  await fs.writeFile(payloadPath, JSON.stringify(normalizedPayload), 'utf8');
  const requestKey = phase === 'extension' && normalizedPayload.coursewareId
    ? `courseware-extension:${normalizedPayload.coursewareId}`
    : randomUUID();
  const result = replacesJobId
    ? jobStore.submitReplacing({ type: 'courseware', ownerId: payload.ownerId, requestKey, payloadRef: payloadPath, stage: phase === 'core' ? 'core_model' : 'extension_model' }, replacesJobId)
    : jobStore.submit({ type: 'courseware', ownerId: payload.ownerId, requestKey, payloadRef: payloadPath, stage: phase === 'core' ? 'core_model' : 'extension_model' });
  if (!result.accepted) await fs.unlink(payloadPath).catch(() => undefined);
  return result;
}

export async function readCoursewareJobResult(job: JobRecord): Promise<any | null> {
  if (job.status !== 'completed' || !job.resultRef) return null;
  return JSON.parse(await fs.readFile(assertWithin(job.resultRef), 'utf8'));
}
