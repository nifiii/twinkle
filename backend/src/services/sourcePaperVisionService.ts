import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { extractPagesAsImages } from './imageService.js';

export type SourcePaperResponseType = 'choice' | 'multi_choice' | 'fill' | 'essay' | 'listening';

export interface SourcePaperVisionSection {
  title: string;
  questionRange: string;
  responseType: SourcePaperResponseType;
  requiresMaterial: boolean;
  requiresVisual: boolean;
  requiresAudio: boolean;
  requiresDrawing: boolean;
}

export interface SourcePaperVisionAsset {
  type: 'diagram' | 'photo' | 'table' | 'audio_prompt' | 'other';
  page: number;
  bbox: [number, number, number, number];
  questionNumbers: string[];
  description: string;
  confidence: number;
}

export interface SourcePaperVisionEvidence {
  pages: number;
  sections: SourcePaperVisionSection[];
  assets: SourcePaperVisionAsset[];
  issues: string[];
}

export class SourcePaperVisionError extends Error {
  constructor(public readonly code: 'unsafe_path' | 'missing_file' | 'render_failed' | 'invalid_evidence' | 'provider_not_configured' | 'provider_failed', message: string) {
    super(message);
    this.name = 'SourcePaperVisionError';
  }
}

export interface SourcePaperVisionDependencies {
  dataDir?: string;
  renderPages?: (pdfPath: string, outputDir: string) => Promise<string[]>;
  analyzePage?: (input: { page: number; imagePath: string }) => Promise<Partial<SourcePaperVisionEvidence> & { page?: number }>;
  modelId?: string;
  apiKey?: string;
}

const RESPONSE_TYPES = new Set<SourcePaperResponseType>(['choice', 'multi_choice', 'fill', 'essay', 'listening']);

function dataRoot(dependencies: SourcePaperVisionDependencies): string {
  return path.resolve(dependencies.dataDir || process.env.DATA_DIR || '/opt/twinkle/data');
}

/**
 * Why: source-paper images are allowed only when they originate from the uploaded
 * data volume. Resolving both paths before comparison prevents ../ traversal and
 * keeps an archived external path from being sent to the model accidentally.
 */
export async function assertSourcePaperPath(filePath: string, dependencies: SourcePaperVisionDependencies = {}): Promise<string> {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new SourcePaperVisionError('missing_file', '母卷原始文件路径为空');
  const root = dataRoot(dependencies);
  const resolved = path.resolve(filePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new SourcePaperVisionError('unsafe_path', '母卷原始文件不在数据卷内');
  }
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isFile() || stat.size <= 0) throw new SourcePaperVisionError('missing_file', '母卷原始文件不存在或为空');
  return resolved;
}

function parseJson(content: string): unknown {
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeEvidence(value: unknown, pages: number): SourcePaperVisionEvidence {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const sections = Array.isArray(source.sections) ? source.sections.map((section, index) => {
    const item = section && typeof section === 'object' ? section as Record<string, unknown> : {};
    const responseType = RESPONSE_TYPES.has(item.responseType as SourcePaperResponseType) ? item.responseType as SourcePaperResponseType : 'choice';
    return {
      title: nonEmptyString(item.title, `第${index + 1}部分`),
      questionRange: nonEmptyString(item.questionRange, ''),
      responseType,
      requiresMaterial: item.requiresMaterial === true,
      requiresVisual: item.requiresVisual === true,
      requiresAudio: item.requiresAudio === true,
      requiresDrawing: item.requiresDrawing === true,
    };
  }).filter(section => section.questionRange || section.requiresMaterial || section.requiresVisual || section.requiresAudio || section.requiresDrawing) : [];
  const assets = Array.isArray(source.assets) ? source.assets.flatMap(asset => {
    const item = asset && typeof asset === 'object' ? asset as Record<string, unknown> : {};
    const bbox = Array.isArray(item.bbox) && item.bbox.length === 4 && item.bbox.every(value => Number.isFinite(Number(value)))
      ? item.bbox.map(value => Number(value)) as [number, number, number, number]
      : null;
    const page = Number(item.page);
    const confidence = Number(item.confidence);
    if (!bbox || !Number.isInteger(page) || page < 1 || page > pages || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return [];
    const type = ['diagram', 'photo', 'table', 'audio_prompt', 'other'].includes(String(item.type)) ? String(item.type) as SourcePaperVisionAsset['type'] : 'other';
    return [{ type, page, bbox, questionNumbers: Array.isArray(item.questionNumbers) ? item.questionNumbers.map(String) : [], description: nonEmptyString(item.description, '未命名视觉材料'), confidence }];
  }) : [];
  const issues = Array.isArray(source.issues) ? source.issues.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()) : [];
  for (const section of sections) {
    if (section.requiresDrawing) issues.push(`${section.title}需要绘图作答，当前网页作答不支持`);
    if (section.requiresAudio && !section.title.includes('听力') && !section.title.toLowerCase().includes('listening')) issues.push(`${section.title}标记为音频材料，需确认听力原文`);
  }
  return { pages, sections, assets, issues: [...new Set(issues)] };
}

async function analyzePageWithArk(input: { page: number; imagePath: string }, dependencies: SourcePaperVisionDependencies): Promise<Partial<SourcePaperVisionEvidence>> {
  const apiKey = dependencies.apiKey || process.env.ARK_API_KEY;
  const model = dependencies.modelId || process.env.ARK_SOURCE_PAPER_VISION_MODEL_ID || process.env.ARK_VISION_MODEL_ID;
  if (!apiKey || !model) throw new SourcePaperVisionError('provider_not_configured', '母卷视觉模型未配置');
  const client = new OpenAI({ apiKey, baseURL: 'https://ark.cn-beijing.volces.com/api/v3' });
  const image = (await fs.readFile(input.imagePath)).toString('base64');
  const response = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [{ role: 'user', content: [
      { type: 'text', text: `你是小学试卷结构分析器。只输出 JSON，不要复现题目全文、原文或原图。分析第 ${input.page} 页，识别分区、题号范围、作答类型和材料依赖。responseType 只能是 choice、multi_choice、fill、essay、listening。若看不清或材料缺失写入 issues。格式：{"sections":[{"title":"","questionRange":"1-5","responseType":"choice","requiresMaterial":false,"requiresVisual":false,"requiresAudio":false,"requiresDrawing":false}],"assets":[{"type":"diagram","page":${input.page},"bbox":[0,0,0,0],"questionNumbers":[],"description":"","confidence":0.0}],"issues":[]}` },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } },
    ] }] as any,
  } as any);
  const raw = response.choices[0]?.message?.content;
  if (typeof raw !== 'string' || !raw.trim()) throw new SourcePaperVisionError('provider_failed', '母卷视觉模型返回空内容');
  try { return { ...parseJson(raw) as Partial<SourcePaperVisionEvidence>, pages: 1 }; }
  catch { throw new SourcePaperVisionError('provider_failed', '母卷视觉模型返回的结构不是合法 JSON'); }
}

export async function analyzeSourcePaperVision(filePathInput: string, dependencies: SourcePaperVisionDependencies = {}): Promise<SourcePaperVisionEvidence> {
  const filePath = await assertSourcePaperPath(filePathInput, dependencies);
  const tempDir = path.join(os.tmpdir(), `twinkle-source-paper-${randomUUID()}`);
  await fs.mkdir(tempDir, { recursive: true });
  try {
    const renderPages = dependencies.renderPages || ((pdfPath: string, outputDir: string) => extractPagesAsImages(pdfPath, outputDir, -1));
    let fileNames: string[];
    try { fileNames = await renderPages(filePath, tempDir); }
    catch (error) { throw new SourcePaperVisionError('render_failed', `母卷页面渲染失败：${error instanceof Error ? error.message : '未知错误'}`); }
    if (fileNames.length === 0) throw new SourcePaperVisionError('render_failed', '母卷没有可分析的页面');
    const analyzePage = dependencies.analyzePage || ((input: { page: number; imagePath: string }) => analyzePageWithArk(input, dependencies));
    const pageEvidence: Array<Partial<SourcePaperVisionEvidence>> = [];
    for (let index = 0; index < fileNames.length; index += 1) {
      const evidence = await analyzePage({ page: index + 1, imagePath: path.join(tempDir, fileNames[index]) });
      pageEvidence.push(evidence);
    }
    const merged = normalizeEvidence({
      sections: pageEvidence.flatMap(evidence => evidence.sections || []),
      assets: pageEvidence.flatMap(evidence => evidence.assets || []),
      issues: pageEvidence.flatMap(evidence => evidence.issues || []),
    }, fileNames.length);
    if (merged.sections.length === 0) throw new SourcePaperVisionError('invalid_evidence', '母卷未识别出可生成的题型分区');
    return merged;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function assertEvidenceGeneratable(evidence: SourcePaperVisionEvidence): void {
  if (evidence.issues.length > 0) throw new SourcePaperVisionError('invalid_evidence', `母卷材料不完整：${evidence.issues.join('；')}`);
  if (evidence.sections.some(section => section.requiresDrawing)) throw new SourcePaperVisionError('invalid_evidence', '母卷包含暂不支持的绘图作答题');
  if (evidence.sections.some(section => section.requiresAudio && !section.title.includes('听力') && !section.title.toLowerCase().includes('listening'))) throw new SourcePaperVisionError('invalid_evidence', '母卷音频分区缺少可识别的听力材料');
}
