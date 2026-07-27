import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import db from './databaseService.js';
import { getAssessmentPaper } from './assessmentPaperService.js';
import { parseLearningOwnerId } from './learningDomain.js';

type ExportVariant = 'paper' | 'answer';
type PaperQuestion = { id: string; type: 'choice' | 'fill' | 'essay'; stem: string; options?: string[]; answer: string; explanation?: string; score: number };
type PaperContent = { title?: string; generationVersion?: number; blueprint?: { subject?: string; grade?: string; chapterTitles?: string[] }; sections?: Array<{ title?: string; questions?: PaperQuestion[] }> };
type ExportJob = { id: string; paperId: string; variant: ExportVariant; status: string; filePath: string | null; error: string | null; createdAt: number; updatedAt: number; downloadUrl: string | null };

const A4_CONTENT_BOTTOM = 755;
const FONT_PATH = path.join(process.cwd(), 'assets', 'fonts', 'NotoSansCJKsc-Regular.otf');

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const mathDocument = mathjax.document('', { InputJax: new TeX({ packages: AllPackages }), OutputJax: new SVG({ fontCache: 'none' }) });

export class ExportValidationError extends Error {
  constructor(public readonly field: string, message: string) { super(message); }
}

export interface ExportDependencies {
  database?: Database.Database;
  exportsDir?: string;
  now?: () => number;
  renderPdf?: (paper: PaperContent, variant: ExportVariant, createdAt: number) => Promise<Buffer>;
  schedule?: (jobId: string) => void;
}

function parseString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw new ExportValidationError(field, `${field}不能为空`);
  return value.trim();
}

function parseVariant(value: unknown): ExportVariant {
  if (value !== 'paper' && value !== 'answer') throw new ExportValidationError('variant', '导出类型仅支持试卷卷或答案卷');
  return value;
}

function exportsDirectory(dependencies: ExportDependencies) {
  return dependencies.exportsDir || path.join(process.env.DATA_DIR || '/opt/twinkle/data', 'exports');
}

function pageHeader(document: PDFKit.PDFDocument, paper: PaperContent, variant: ExportVariant, createdAt: number) {
  const scope = [paper.blueprint?.subject, paper.blueprint?.grade, ...(paper.blueprint?.chapterTitles || [])].filter(Boolean).join(' · ');
  document.font('NotoSansCJK').fontSize(9).fillColor('#475569').text(`原创${variant === 'answer' ? '答案卷' : '试卷'}  |  ${scope || '教材范围未标注'}`, 54, 38, { width: 487 });
  document.fontSize(8).text(`版本 ${paper.generationVersion || 1}  |  ${new Date(createdAt).toLocaleDateString('zh-CN')}`, 54, 53, { width: 487, align: 'right' });
  document.strokeColor('#0f172a').lineWidth(1).moveTo(54, 69).lineTo(541, 69).stroke();
  document.y = 88;
}

function ensureSpace(document: PDFKit.PDFDocument, height: number) {
  if (document.y + height > A4_CONTENT_BOTTOM) document.addPage();
}

function mathSvg(latex: string) {
  // MathJax wraps the vector with mjx-container; svg-to-pdfkit accepts only
  // the SVG child, otherwise it silently drops every formula.
  return adaptor.innerHTML(mathDocument.convert(latex, { display: false }));
}

function writeStem(document: PDFKit.PDFDocument, text: string) {
  const parts = text.split(/(\$[^$]+\$|\\\([\s\S]+?\\\))/g).filter(Boolean);
  let followsMath = false;
  for (const part of parts) {
    const math = part.startsWith('$') ? part.slice(1, -1) : part.startsWith('\\(') ? part.slice(2, -2) : null;
    if (!math) {
      // Formula SVG is deliberately block-level for reliable pagination. Do
      // not leave Chinese punctuation alone at the start of the next line.
      const plain = followsMath ? part.replace(/^[，。；：、]\s*/, '') : part;
      if (plain) document.font('NotoSansCJK').fontSize(11).fillColor('#111827').text(plain, { lineGap: 3 });
      followsMath = false;
      continue;
    }
    try {
      ensureSpace(document, 28);
      SVGtoPDF(document, mathSvg(math), 66, document.y + 2, { width: 260, height: 24 });
      document.moveDown(1.8);
    } catch {
      document.font('NotoSansCJK').fontSize(11).fillColor('#111827').text(math, { lineGap: 3 });
    }
    followsMath = true;
  }
}

function answerLines(document: PDFKit.PDFDocument, question: PaperQuestion) {
  const lines = question.type === 'essay' ? 6 : question.type === 'fill' ? 1 : 0;
  if (!lines) return;
  ensureSpace(document, lines * 24 + 10);
  for (let index = 0; index < lines; index += 1) {
    const y = document.y + 16;
    document.strokeColor('#94a3b8').lineWidth(0.5).moveTo(72, y).lineTo(523, y).stroke();
    document.moveDown(1.45);
  }
}

export async function renderAssessmentPdf(paper: PaperContent, variant: ExportVariant, createdAt: number): Promise<Buffer> {
  await fs.access(FONT_PATH);
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 54, bufferPages: true, info: { Title: `${paper.title || '原创试卷'}-${variant}` } });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.registerFont('NotoSansCJK', FONT_PATH);
    document.on('pageAdded', () => pageHeader(document, paper, variant, createdAt));
    pageHeader(document, paper, variant, createdAt);
    document.font('NotoSansCJK').fontSize(18).fillColor('#0f172a').text(paper.title || '原创试卷', { align: 'center' });
    document.moveDown(1.2);
    let number = 1;
    for (const section of paper.sections || []) {
      ensureSpace(document, 38);
      document.font('NotoSansCJK').fontSize(13).fillColor('#0f172a').text(section.title || '试题');
      document.moveDown(0.5);
      for (const question of section.questions || []) {
        // An essay's heading, formula and answer lines form one unit. Moving
        // before it starts prevents a question from being split from its own
        // answer area at the page boundary.
        ensureSpace(document, question.type === 'essay' && variant === 'paper' ? 280 : 58);
        document.font('NotoSansCJK').fontSize(11).fillColor('#111827').text(`${number}. （${question.score} 分）`, { continued: true });
        document.text(' ');
        writeStem(document, question.stem);
        if (question.options?.length) {
          document.font('NotoSansCJK').fontSize(10.5).fillColor('#334155').text(question.options.join('    '), { lineGap: 4 });
        }
        if (variant === 'answer') {
          document.moveDown(0.35);
          document.font('NotoSansCJK').fontSize(10).fillColor('#166534').text(`答案：${question.answer}`, { lineGap: 3 });
          if (question.explanation) document.fillColor('#475569').text(`解析：${question.explanation}`, { lineGap: 3 });
        } else {
          answerLines(document, question);
        }
        document.moveDown(0.9);
        number += 1;
      }
      document.moveDown(0.4);
    }
    const range = document.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      document.switchToPage(index);
      // Keep the footer above PDFKit's bottom margin. Writing below it causes
      // PDFKit to paginate while drawing footers and leaves blank trailing pages.
      document.font('NotoSansCJK').fontSize(8).fillColor('#64748b').text(`第 ${index + 1} / ${range.count} 页`, 54, 765, { width: 487, align: 'center' });
    }
    document.end();
  });
}

export function createExportJob(request: Record<string, unknown>, dependencies: ExportDependencies = {}) {
  const database = dependencies.database || db;
  const ownerId = parseLearningOwnerId(request.ownerId);
  const paperId = parseString(request.paperId, 'paperId');
  const variant = parseVariant(request.variant);
  if (!getAssessmentPaper(paperId, ownerId, database)) throw new ExportValidationError('paperId', '原创试卷不存在于当前本地资料上下文中');
  const now = (dependencies.now || Date.now)();
  const id = randomUUID();
  database.prepare('INSERT INTO export_jobs (id, paperId, variant, status, filePath, error, createdAt, updatedAt) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)').run(id, paperId, variant, 'queued', now, now);
  (dependencies.schedule || ((jobId: string) => queueMicrotask(() => { void runExportJob(jobId); })))(id);
  return getExportJob(id, ownerId, database)!;
}

export async function runExportJob(jobIdInput: unknown, dependencies: ExportDependencies = {}) {
  const database = dependencies.database || db;
  const jobId = parseString(jobIdInput, 'jobId');
  const row = database.prepare('SELECT id, paperId, variant, status, createdAt FROM export_jobs WHERE id = ?').get(jobId) as { id: string; paperId: string; variant: ExportVariant; status: string; createdAt: number } | undefined;
  if (!row || row.status !== 'queued') return;
  const paperRow = database.prepare('SELECT ownerId, contentJson FROM assessment_papers WHERE id = ?').get(row.paperId) as { ownerId: string; contentJson: string } | undefined;
  if (!paperRow) { database.prepare('UPDATE export_jobs SET status = ?, error = ?, updatedAt = ? WHERE id = ?').run('failed', '试卷不存在', (dependencies.now || Date.now)(), row.id); return; }
  try {
    database.prepare('UPDATE export_jobs SET status = ?, updatedAt = ? WHERE id = ?').run('running', (dependencies.now || Date.now)(), row.id);
    const content = JSON.parse(paperRow.contentJson) as PaperContent;
    const buffer = await (dependencies.renderPdf || renderAssessmentPdf)(content, row.variant, row.createdAt);
    const directory = exportsDirectory(dependencies);
    await fs.mkdir(directory, { recursive: true });
    const filename = `${row.paperId}-${row.variant}-${row.id}.pdf`;
    const filePath = path.join(directory, filename);
    await fs.writeFile(filePath, buffer, { flag: 'wx' });
    database.prepare('UPDATE export_jobs SET status = ?, filePath = ?, error = NULL, updatedAt = ? WHERE id = ?').run('completed', filePath, (dependencies.now || Date.now)(), row.id);
  } catch (error) {
    database.prepare('UPDATE export_jobs SET status = ?, error = ?, updatedAt = ? WHERE id = ?').run('failed', error instanceof Error ? error.message.slice(0, 500) : '导出失败', (dependencies.now || Date.now)(), row.id);
  }
}

export function getExportJob(idInput: unknown, ownerIdInput: unknown, database: Database.Database = db): ExportJob | null {
  const id = parseString(idInput, 'id');
  const ownerId = parseLearningOwnerId(ownerIdInput);
  const row = database.prepare('SELECT j.id, j.paperId, j.variant, j.status, j.filePath, j.error, j.createdAt, j.updatedAt FROM export_jobs j JOIN assessment_papers p ON p.id = j.paperId WHERE j.id = ? AND p.ownerId = ?').get(id, ownerId) as Omit<ExportJob, 'downloadUrl'> | undefined;
  if (!row) return null;
  return { ...row, downloadUrl: row.status === 'completed' ? `/api/exports/${row.id}?ownerId=${encodeURIComponent(ownerId)}&download=1` : null };
}

export function exportOutputDirectoryForTest() {
  return path.join(os.tmpdir(), 'twinkle-export-tests');
}
