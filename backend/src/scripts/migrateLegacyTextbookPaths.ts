import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import db from '../services/databaseService.js';
import { convertPDFToMarkdownWithDoubaoOCR, extractTOCFromMarkdown } from '../services/doubaoService.js';
import { saveBookMarkdown } from '../services/fileStorage.js';

const DATA_DIR = process.env.DATA_DIR || '/opt/twinkle/data';
const LEGACY_DATA_DIR = '/opt/hl-os/data';
const CURRENT_DATA_DIR = process.env.DATA_DIR || '/opt/twinkle/data';
const MIGRATION_ID = '2026-07-29_repair_legacy_textbook_paths';

const BOOKS = [
  { id: 'book_1773391888189_y1x36uh8s', label: '科学三年级下册', needsReparse: false },
  { id: 'book_1773386082323_ds0c9rxor', label: '英语三年级下册', needsReparse: false },
  { id: 'book_1773313132813_58hn5f4mm', label: '数学三年级下册', needsReparse: false },
  { id: 'book_1770715192926_zk7ffb37q', label: '语文三年级下册', needsReparse: true },
] as const;

type BookRow = {
  id: string;
  title: string;
  author: string | null;
  subject: string | null;
  category: string | null;
  grade: string | null;
  publisher: string | null;
  publishDate: string | null;
  tags: string | null;
  ownerId: string;
  userName: string | null;
  filePath: string | null;
  mdPath: string | null;
  coverPath: string | null;
  status: string | null;
  fileHash: string | null;
  tableOfContents: string | null;
  timestamp: number | null;
};

type VerifiedBook = {
  definition: (typeof BOOKS)[number];
  row: BookRow;
  filePath: string;
  mdPath?: string;
};

function parseArgs(args: string[]) {
  const unknown = args.filter(arg => arg !== '--apply');
  if (unknown.length > 0) throw new Error(`不支持的参数: ${unknown.join(', ')}`);
  return { apply: args.includes('--apply') };
}

function translateLegacyPath(value: string | null, field: string, book: string): string {
  if (!value) throw new Error(`${book} 缺少 ${field}`);
  if (value === LEGACY_DATA_DIR || value.startsWith(`${LEGACY_DATA_DIR}/`)) {
    return `${CURRENT_DATA_DIR}${value.slice(LEGACY_DATA_DIR.length)}`;
  }
  if (value === CURRENT_DATA_DIR || value.startsWith(`${CURRENT_DATA_DIR}/`)) return value;
  throw new Error(`${book} 的 ${field} 不在受支持的数据目录: ${value}`);
}

async function assertExistingFile(filePath: string, label: string): Promise<void> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile() || stat.size <= 0) throw new Error(`${label} 不存在或为空: ${filePath}`);
}

function parseJsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function verifyBooks(): Promise<VerifiedBook[]> {
  const getBook = db.prepare('SELECT * FROM books WHERE id = ?');
  const verified: VerifiedBook[] = [];

  for (const definition of BOOKS) {
    const row = getBook.get(definition.id) as BookRow | undefined;
    if (!row) throw new Error(`未找到受影响教材记录: ${definition.id}`);

    const filePath = translateLegacyPath(row.filePath, 'filePath', definition.label);
    await assertExistingFile(filePath, `${definition.label} 原始 PDF`);

    if (definition.needsReparse) {
      verified.push({ definition, row, filePath });
      continue;
    }

    const mdPath = translateLegacyPath(row.mdPath, 'mdPath', definition.label);
    await assertExistingFile(mdPath, `${definition.label} 解析产物`);
    verified.push({ definition, row, filePath, mdPath });
  }

  return verified;
}

async function backupData(): Promise<string> {
  const backupDir = path.join(DATA_DIR, 'migrations', MIGRATION_ID);
  await fs.mkdir(backupDir, { recursive: true });
  const suffix = new Date().toISOString().replace(/[:.]/g, '-');
  const databaseBackupPath = path.join(backupDir, `hlos-${suffix}.db`);
  const metadataPath = path.join(DATA_DIR, 'metadata.json');

  // SQLite backup keeps a consistent snapshot even when the web process still holds the database open.
  await db.backup(databaseBackupPath);
  await fs.copyFile(metadataPath, path.join(backupDir, `metadata-${suffix}.json`)).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
  return backupDir;
}

function toMetadataRow(row: BookRow, filePath: string, mdPath: string, tableOfContents: unknown[], status: string) {
  return {
    ...row,
    type: 'textbook',
    filePath,
    mdPath,
    tableOfContents,
    status,
    tags: parseJsonArray(row.tags),
    imagePath: row.coverPath || undefined,
    timestamp: row.timestamp || Date.now(),
  };
}

async function updateLegacyMetadataFile(updated: Map<string, ReturnType<typeof toMetadataRow>>): Promise<void> {
  const metadataPath = path.join(DATA_DIR, 'metadata.json');
  const content = await fs.readFile(metadataPath, 'utf8').catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (content === null) return;
  const entries = JSON.parse(content) as Array<Record<string, unknown>>;
  const nextEntries = entries.map(entry => updated.get(String(entry.id)) || entry);
  await fs.writeFile(metadataPath, JSON.stringify(nextEntries, null, 2), 'utf8');
}

async function reparseChineseBook(book: VerifiedBook): Promise<{ mdPath: string; tableOfContents: unknown[] }> {
  const row = book.row;
  const markdown = await convertPDFToMarkdownWithDoubaoOCR(book.filePath, path.basename(book.filePath));
  if (markdown.trim().length < 500 || markdown.includes('OCR环境提取失败')) {
    throw new Error(`${book.definition.label} OCR 未产生可用正文，未更新教材记录`);
  }

  const tableOfContents = await extractTOCFromMarkdown(markdown, row.title);
  if (tableOfContents.length === 0) {
    throw new Error(`${book.definition.label} 未提取到目录，未更新教材记录`);
  }

  const metadata = {
    title: row.title,
    author: row.author || '',
    subject: row.subject || '语文',
    category: row.category || '教材',
    grade: row.grade || '',
    publisher: row.publisher || '',
    publishDate: row.publishDate || '',
    tags: parseJsonArray(row.tags),
    coverImage: row.coverPath || '',
  };
  const mdPath = await saveBookMarkdown(metadata, markdown, row.ownerId, row.userName || '大宝');
  await assertExistingFile(mdPath, `${book.definition.label} 新解析产物`);
  return { mdPath, tableOfContents };
}

function updateBooks(verifiedBooks: VerifiedBook[], chineseResult: { mdPath: string; tableOfContents: unknown[] } | undefined) {
  const updateBook = db.prepare(
    'UPDATE books SET filePath = @filePath, mdPath = @mdPath, tableOfContents = @tableOfContents, status = @status WHERE id = @id'
  );
  const updatedMetadata = new Map<string, ReturnType<typeof toMetadataRow>>();

  const transaction = db.transaction(() => {
    for (const book of verifiedBooks) {
      const isChinese = book.definition.needsReparse;
      const mdPath = isChinese ? chineseResult?.mdPath : book.mdPath;
      const tableOfContents = isChinese ? chineseResult?.tableOfContents : parseJsonArray(book.row.tableOfContents);
      if (!mdPath || !tableOfContents) throw new Error(`${book.definition.label} 缺少可写入的解析产物`);

      updateBook.run({
        id: book.row.id,
        filePath: book.filePath,
        mdPath,
        tableOfContents: JSON.stringify(tableOfContents),
        status: 'completed',
      });
      updatedMetadata.set(book.row.id, toMetadataRow(book.row, book.filePath, mdPath, tableOfContents, 'completed'));
    }
    db.exec('CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, appliedAt INTEGER NOT NULL)');
    db.prepare('INSERT OR REPLACE INTO _migrations (id, appliedAt) VALUES (?, ?)').run(MIGRATION_ID, Date.now());
  });

  transaction();
  return updatedMetadata;
}

async function verifyApplied(): Promise<void> {
  const getBook = db.prepare('SELECT id, filePath, mdPath, status, tableOfContents FROM books WHERE id = ?');
  for (const definition of BOOKS) {
    const row = getBook.get(definition.id) as Pick<BookRow, 'filePath' | 'mdPath' | 'status' | 'tableOfContents'> | undefined;
    if (!row || row.status !== 'completed') throw new Error(`${definition.label} 未完成写回`);
    await assertExistingFile(row.filePath || '', `${definition.label} 原始 PDF`);
    await assertExistingFile(row.mdPath || '', `${definition.label} 解析产物`);
    if (definition.needsReparse && parseJsonArray(row.tableOfContents).length === 0) {
      throw new Error(`${definition.label} 未保存可用目录`);
    }
  }
}

export async function runMigration(apply: boolean): Promise<void> {
  const verifiedBooks = await verifyBooks();
  const plan = verifiedBooks.map(book => ({
    id: book.row.id,
    title: book.definition.label,
    filePath: book.filePath,
    mdPath: book.mdPath || '将使用已配置模型重新解析',
  }));
  console.log(JSON.stringify({ migration: MIGRATION_ID, mode: apply ? 'apply' : 'dry-run', books: plan }, null, 2));

  if (!apply) return;

  const backupDir = await backupData();
  const chineseBook = verifiedBooks.find(book => book.definition.needsReparse);
  const chineseResult = chineseBook ? await reparseChineseBook(chineseBook) : undefined;
  const updatedMetadata = updateBooks(verifiedBooks, chineseResult);
  await updateLegacyMetadataFile(updatedMetadata);
  await verifyApplied();
  console.log(JSON.stringify({ migration: MIGRATION_ID, status: 'completed', backupDir }, null, 2));
}

export function closeMigrationDatabase(): void {
  db.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { apply } = parseArgs(process.argv.slice(2));
  runMigration(apply)
    .catch(error => {
      console.error(`[${MIGRATION_ID}] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    })
    .finally(closeMigrationDatabase);
}
