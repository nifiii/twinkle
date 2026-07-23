import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { JobExecutionError, JobRecord } from './jobs.js';
import { jobStore, modelSlots, registerJobHandler } from './jobRuntime.js';
import { parsePDF } from './pdfParser.js';
import { parseEPUB } from './epubParser.js';
import { analyzeMetadata, convertToMarkdown } from './llmService.js';
import {
  convertPDFToMarkdownWithDoubaoOCR,
  extractMetadataFromPDFWithDoubao,
  extractTOCFromMarkdown,
  RenderedPdfPages,
} from './doubaoService.js';
import { extractPagesAsImages } from './imageService.js';
import { saveBookCover, saveBookFile, saveBookMarkdown, updateMetadataIndex } from './fileStorage.js';
import { normalizeSubject } from '../utils/subject.js';

const DATA_DIR = process.env.DATA_DIR || '/opt/twinkle/data';
const BOOK_JOB_DIR = path.join(DATA_DIR, 'jobs', 'book');
const TEMP_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'temp');
const USER_NAMES: Record<string, string> = { child_1: '大宝', child_2: '二宝', shared: '共享' };

type BookPayload = {
  sourcePath: string;
  fileName: string;
  ownerId: string;
  fileHash?: string;
  bookId: string;
  archivedPath?: string;
  metadata?: any;
  pageCount?: number;
  isScanned?: boolean;
  renderedPages?: RenderedPdfPages;
  entryCreated?: boolean;
};

function assertWithin(filePath: string, root: string): string {
  const resolved = path.resolve(filePath);
  const allowedPrefix = `${path.resolve(root)}${path.sep}`;
  if (!resolved.startsWith(allowedPrefix)) throw new JobExecutionError('INPUT_INVALID', '图书任务输入引用无效');
  return resolved;
}

function fileFormat(fileName: string): 'pdf' | 'epub' | 'txt' {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.epub') return 'epub';
  if (ext === '.txt') return 'txt';
  return 'pdf';
}

function fallbackMetadata(fileName: string) {
  return {
    title: fileName.replace(/\.(pdf|epub|txt)$/i, ''), author: '', subject: '其他', grade: '',
    category: '教材', publisher: '', publishDate: '', tags: [], tableOfContents: [],
  };
}

async function writePayload(payloadPath: string, payload: BookPayload): Promise<void> {
  await fs.writeFile(payloadPath, JSON.stringify(payload), 'utf8');
}

async function readPayload(job: JobRecord): Promise<{ payloadPath: string; payload: BookPayload }> {
  const payloadPath = assertWithin(job.payloadRef, BOOK_JOB_DIR);
  const payload = JSON.parse(await fs.readFile(payloadPath, 'utf8')) as BookPayload;
  payload.sourcePath = assertWithin(payload.sourcePath, TEMP_UPLOAD_DIR);
  return { payloadPath, payload };
}

async function withModelSlot<T>(kind: 'vision' | 'text', action: () => Promise<T>): Promise<T> {
  const release = await modelSlots.acquire(kind);
  try {
    return await action();
  } finally {
    release();
  }
}

async function createProcessingEntry(payload: BookPayload, userName: string): Promise<void> {
  if (payload.entryCreated) return;
  await updateMetadataIndex({
    id: payload.bookId, ...payload.metadata, type: 'textbook', ownerId: payload.ownerId, userName,
    subject: normalizeSubject(payload.metadata.subject), timestamp: Date.now(), filePath: payload.archivedPath,
    fileHash: payload.fileHash, tableOfContents: payload.metadata.tableOfContents || [], status: 'processing',
  } as any);
  payload.entryCreated = true;
}

async function archiveWithDetectedSubject(jobId: string, payload: BookPayload, buffer: Buffer, userName: string): Promise<void> {
  if (payload.archivedPath) return;
  jobStore.setStage(jobId, 'archive');
  payload.archivedPath = await saveBookFile(
    buffer, payload.fileName, payload.ownerId, normalizeSubject(payload.metadata.subject), userName,
  );
}

async function runBookJob(job: JobRecord): Promise<string> {
  const { payloadPath, payload } = await readPayload(job);
  const userName = USER_NAMES[payload.ownerId] || '共享';
  let entry: any;

  try {
    const buffer = await fs.readFile(payload.sourcePath);

    const format = fileFormat(payload.fileName);
    let markdown = '';
    let renderedPages: RenderedPdfPages | undefined;

    if (format === 'pdf') {
      jobStore.setStage(job.id, 'pdf_parse');
      const parsed = await parsePDF(buffer);
      payload.pageCount = parsed.pageCount;
      payload.isScanned = parsed.content.length < 500 || parsed.content.length / Math.max(1, parsed.pageCount) < 50;

      const pagesDir = path.join(BOOK_JOB_DIR, job.id, 'pages');
      if (!payload.renderedPages) {
        jobStore.setStage(job.id, 'render_pages');
        const fileNames = await extractPagesAsImages(payload.sourcePath, pagesDir, payload.isScanned ? -1 : 1);
        payload.renderedPages = { directory: pagesDir, fileNames };
        await writePayload(payloadPath, payload);
      }
      renderedPages = payload.renderedPages;

      if (!payload.metadata) {
        jobStore.setStage(job.id, 'metadata');
        payload.metadata = payload.isScanned
          ? await extractMetadataFromPDFWithDoubao(payload.sourcePath, payload.fileName, renderedPages, () => modelSlots.acquire('vision'))
          : await withModelSlot('text', () => analyzeMetadata(parsed.content, payload.fileName));
      }
      payload.metadata = { ...fallbackMetadata(payload.fileName), ...payload.metadata, subject: normalizeSubject(payload.metadata.subject) };
      await archiveWithDetectedSubject(job.id, payload, buffer, userName);
      await createProcessingEntry(payload, userName);
      entry = payload;
      await writePayload(payloadPath, payload);

      jobStore.setStage(job.id, 'markdown');
      markdown = payload.isScanned
        ? await convertPDFToMarkdownWithDoubaoOCR(payload.sourcePath, payload.fileName, renderedPages, () => modelSlots.acquire('vision'))
        : await convertToMarkdown(parsed.content, undefined, () => modelSlots.acquire('text'));
    } else if (format === 'epub') {
      jobStore.setStage(job.id, 'metadata');
      const parsed = await parseEPUB(buffer);
      payload.pageCount = parsed.pageCount;
      payload.metadata = { ...fallbackMetadata(payload.fileName), ...parsed.estimatedMetadata, tableOfContents: parsed.tableOfContents || [] };
      await archiveWithDetectedSubject(job.id, payload, buffer, userName);
      await createProcessingEntry(payload, userName);
      entry = payload;
      jobStore.setStage(job.id, 'markdown');
      markdown = await convertToMarkdown(parsed.content, undefined, () => modelSlots.acquire('text'));
    } else {
      const content = buffer.toString('utf8');
      payload.pageCount = 1;
      payload.metadata = fallbackMetadata(payload.fileName);
      await archiveWithDetectedSubject(job.id, payload, buffer, userName);
      await createProcessingEntry(payload, userName);
      entry = payload;
      jobStore.setStage(job.id, 'markdown');
      markdown = await convertToMarkdown(content, undefined, () => modelSlots.acquire('text'));
    }

    jobStore.setStage(job.id, 'save');
    let coverImage = '';
    if (renderedPages?.fileNames[0]) {
      const coverFileName = await saveBookCover(path.join(renderedPages.directory, renderedPages.fileNames[0]), renderedPages.fileNames[0]);
      coverImage = `/covers/${coverFileName}`;
    }
    let tableOfContents = payload.metadata.tableOfContents || [];
    if (tableOfContents.length === 0 && markdown.length > 500) {
      tableOfContents = await withModelSlot('text', () => extractTOCFromMarkdown(markdown, payload.metadata.title));
    }
    const metadata = { ...payload.metadata, tableOfContents, coverImage: coverImage ? `[[${path.basename(coverImage)}]]` : '' };
    const mdPath = await saveBookMarkdown(metadata, markdown, payload.ownerId, userName);
    await updateMetadataIndex({
      id: payload.bookId, ...metadata, type: 'textbook', ownerId: payload.ownerId, userName,
      subject: normalizeSubject(metadata.subject), timestamp: Date.now(), filePath: payload.archivedPath,
      mdPath, imagePath: coverImage || undefined, fileHash: payload.fileHash, tableOfContents, status: 'completed',
    } as any);

    const resultPath = path.join(BOOK_JOB_DIR, `${job.id}.result.json`);
    await fs.writeFile(resultPath, JSON.stringify({ bookId: payload.bookId, metadata, pageCount: payload.pageCount, status: 'completed' }), 'utf8');
    await fs.rm(path.join(BOOK_JOB_DIR, job.id), { recursive: true, force: true });
    await fs.unlink(payload.sourcePath).catch(() => undefined);
    return resultPath;
  } catch (error: any) {
    if (entry?.entryCreated) {
      await updateMetadataIndex({
        id: entry.bookId, ...entry.metadata, type: 'textbook', ownerId: entry.ownerId, userName,
        subject: normalizeSubject(entry.metadata.subject), timestamp: Date.now(), filePath: entry.archivedPath,
        fileHash: entry.fileHash, tableOfContents: entry.metadata.tableOfContents || [], status: 'failed',
      } as any).catch(() => undefined);
    }
    throw new JobExecutionError('BOOK_FAILED', error?.message || '图书解析失败');
  }
}

registerJobHandler('book', runBookJob);

export async function submitBookJob(input: { sourcePath: string; fileName: string; ownerId: string; fileHash?: string }) {
  await fs.mkdir(BOOK_JOB_DIR, { recursive: true });
  const payloadPath = path.join(BOOK_JOB_DIR, `${randomUUID()}.input.json`);
  const payload: BookPayload = {
    sourcePath: assertWithin(input.sourcePath, TEMP_UPLOAD_DIR), fileName: input.fileName, ownerId: input.ownerId,
    fileHash: input.fileHash, bookId: `book_${randomUUID()}`,
  };
  await writePayload(payloadPath, payload);
  const result = jobStore.submit({ type: 'book', ownerId: input.ownerId, requestKey: randomUUID(), payloadRef: payloadPath, stage: 'pdf_parse' });
  if (!result.accepted) await fs.unlink(payloadPath).catch(() => undefined);
  return result;
}

export async function getBookJobResult(job: JobRecord): Promise<any | null> {
  if (job.status !== 'completed' || !job.resultRef) return null;
  const resultPath = assertWithin(job.resultRef, BOOK_JOB_DIR);
  return JSON.parse(await fs.readFile(resultPath, 'utf8'));
}
