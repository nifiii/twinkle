import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type Database from 'better-sqlite3';

const RESET_ID = '2026-08-04_learning_assistant_reset';
const LEGACY_WRONG_PROBLEM_DATA_PREFIX = '/opt/hl-os/data/';
const DERIVED_TABLES = [
  { name: 'classroom_items', idColumns: ['id'], where: "type IN ('courseware', 'quiz')" },
  { name: 'quiz_results', idColumns: ['id'] },
  { name: 'wrong_problem_quiz_links', idColumns: ['id', 'scannedItemId', 'problemIndex'] },
  { name: 'learning_tasks', idColumns: ['id'] },
  { name: 'learning_task_links', idColumns: ['taskId', 'entityType', 'entityId', 'role'] },
  { name: 'learning_task_events', idColumns: ['id'] },
  { name: 'learning_packages', idColumns: ['id'] },
  { name: 'learning_package_progress', idColumns: ['ownerId', 'packageId'] },
  { name: 'assessment_blueprints', idColumns: ['id'] },
  { name: 'assessment_papers', idColumns: ['id'] },
  { name: 'paper_attempts', idColumns: ['id'] },
  { name: 'attempt_item_results', idColumns: ['attemptId', 'questionId'] },
  { name: 'review_events', idColumns: ['id'] },
  { name: 'export_jobs', idColumns: ['id'] },
] as const;

type Row = Record<string, unknown>;
type FileReference = { path: string; recordId: string; field: string };
type ManifestFile = FileReference & { sha256: string; backupPath: string };
type RetiredContentEntry = { ownerId: string; entityType: string; entityId: string };

export type ResetManifest = {
  resetId: string;
  mode: 'dry-run';
  runId: string;
  generatedAt: string;
  backup: { directory: string; databasePath: string; databaseSha256: string; metadataPath?: string; metadataSha256?: string };
  delete: {
    tables: Array<{ table: string; count: number; identifiers: string[] }>;
    wrongProblems: { count: number; identifiers: string[] };
    files: { candidates: ManifestFile[]; sharedWithRetained: FileReference[]; missing: FileReference[] };
    metadataWrongIdentifiers: string[];
    retiredContent: RetiredContentEntry[];
  };
  retain: {
    books: { count: number; identifiers: string[] };
    scannedItems: { count: number; identifiers: string[] };
    files: Array<FileReference & { sha256?: string; missing?: boolean }>;
    metadataEntryCount: number;
  };
  blockers: Array<{ code: string; message: string; recordId?: string; field?: string; value?: string }>;
};

export type ResetDryRunDependencies = {
  database: Database.Database;
  dataDir: string;
  now?: Date;
};

export type ResetApplyDependencies = ResetDryRunDependencies & { approvedManifestPath: string };

export type ResetApplyResult = {
  runId: string;
  backupDirectory: string;
  deletedTables: Array<{ table: string; count: number }>;
  deletedWrongProblems: number;
  stagedFiles: number;
};

type MetadataPlan = { exists: boolean; wrongIdentifiers: string[]; retainedEntryCount: number; nextContent?: string };

function quote(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function tableExists(database: Database.Database, table: string): boolean {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function columnsFor(database: Database.Database, table: string): Set<string> {
  if (!tableExists(database, table)) return new Set();
  return new Set((database.prepare(`PRAGMA table_info(${quote(table)})`).all() as Array<{ name: string }>).map(column => column.name));
}

function identifiers(rows: Row[], idColumns: readonly string[]): string[] {
  return rows.map(row => idColumns.filter(column => row[column] !== undefined).map(column => `${column}=${String(row[column])}`).join('|'));
}

function rowsFor(database: Database.Database, table: string, fields: string[], where?: string): Row[] {
  const columns = columnsFor(database, table);
  if (columns.size === 0) return [];
  const selected = fields.filter(field => columns.has(field));
  if (selected.length === 0) return [];
  const clause = where ? ` WHERE ${where}` : '';
  return database.prepare(`SELECT ${selected.map(quote).join(', ')} FROM ${quote(table)}${clause}`).all() as Row[];
}

function parsePaths(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
  } catch {
    throw new Error('invalid_json');
  }
}

function dataPath(dataDir: string, value: string, allowLegacyWrongProblemPath: boolean, field: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null;
  // This prefix is a verified retired container mount. Restricting it to wrong-problem cleanup
  // lets missing derived attachments be audited and deleted without accepting arbitrary host paths.
  if (allowLegacyWrongProblemPath && value.startsWith(LEGACY_WRONG_PROBLEM_DATA_PREFIX)) {
    return path.resolve(dataDir, value.slice(LEGACY_WRONG_PROBLEM_DATA_PREFIX.length));
  }
  // Book records expose archived cover files through the site's /covers static route.
  // Resolve only this field-specific URL back to its storage location for retention checks.
  if (field === 'coverPath' && value.startsWith('/covers/')) {
    return path.resolve(dataDir, 'obsidian', 'covers', value.slice('/covers/'.length));
  }
  if (value.startsWith('/data/')) return path.resolve(dataDir, value.slice('/data/'.length));
  if (path.isAbsolute(value)) return path.resolve(value);
  return path.resolve(dataDir, value);
}

function withinDataDir(dataDir: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(dataDir), candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function collectReferences(rows: Row[], dataDir: string, blockers: ResetManifest['blockers'], source: 'wrong' | 'retained'): FileReference[] {
  const references: FileReference[] = [];
  for (const row of rows) {
    const recordId = String(row.id || 'unknown');
    const fields: Array<[string, unknown]> = [
      ['filePath', row.filePath],
      ['mdPath', row.mdPath],
      ['imagePath', row.imagePath],
      ['coverPath', row.coverPath],
    ];
    try {
      for (const imagePath of parsePaths(row.allImagesJson)) fields.push(['allImagesJson', imagePath]);
    } catch {
      if (source === 'wrong') blockers.push({ code: 'invalid_image_list', message: '错题图片列表无法解析', recordId, field: 'allImagesJson' });
    }

    for (const [field, raw] of fields) {
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const resolved = dataPath(dataDir, raw, source === 'wrong', field);
      if (!resolved || !withinDataDir(dataDir, resolved)) {
        blockers.push({
          code: 'unsafe_file_path',
          message: source === 'wrong' ? '错题文件不在数据卷内' : '保留资料文件不在数据卷内',
          recordId,
          field,
          value: raw,
        });
        continue;
      }
      references.push({ path: resolved, recordId, field });
    }
  }
  return references;
}

async function sha256(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function inspectRetainedFiles(references: FileReference[]): Promise<ResetManifest['retain']['files']> {
  const unique = new Map(references.map(reference => [reference.path, reference]));
  const files: ResetManifest['retain']['files'] = [];
  for (const reference of unique.values()) {
    try {
      const stat = await fs.stat(reference.path);
      files.push({ ...reference, ...(stat.isFile() ? { sha256: await sha256(reference.path) } : { missing: true }) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') files.push({ ...reference, missing: true });
      else throw error;
    }
  }
  return files;
}

async function backupWrongFiles(references: FileReference[], retainedPaths: Set<string>, backupDir: string): Promise<ResetManifest['delete']['files']> {
  const candidates: ManifestFile[] = [];
  const sharedWithRetained: FileReference[] = [];
  const missing: FileReference[] = [];
  const unique = new Map(references.map(reference => [reference.path, reference]));
  const filesDir = path.join(backupDir, 'wrong-files');

  for (const reference of unique.values()) {
    if (retainedPaths.has(reference.path)) {
      sharedWithRetained.push(reference);
      continue;
    }
    try {
      const stat = await fs.stat(reference.path);
      if (!stat.isFile()) throw new Error(`错题引用不是文件: ${reference.path}`);
      const digest = await sha256(reference.path);
      const backupPath = path.join(filesDir, `${digest}-${path.basename(reference.path)}`);
      await fs.mkdir(filesDir, { recursive: true });
      await fs.copyFile(reference.path, backupPath);
      if (await sha256(backupPath) !== digest) throw new Error(`错题文件备份校验失败: ${reference.path}`);
      candidates.push({ ...reference, sha256: digest, backupPath });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') missing.push(reference);
      else throw error;
    }
  }
  return { candidates, sharedWithRetained, missing };
}

async function backupMetadata(dataDir: string, backupDir: string): Promise<Pick<ResetManifest['backup'], 'metadataPath' | 'metadataSha256'>> {
  const metadataPath = path.join(dataDir, 'metadata.json');
  try {
    const digest = await sha256(metadataPath);
    const backupPath = path.join(backupDir, 'metadata.json');
    await fs.copyFile(metadataPath, backupPath);
    if (await sha256(backupPath) !== digest) throw new Error('metadata.json 备份校验失败');
    return { metadataPath: backupPath, metadataSha256: digest };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

function timestamp(now: Date): string {
  return `${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
}

async function metadataPlan(dataDir: string, blockers: ResetManifest['blockers']): Promise<MetadataPlan> {
  const metadataPath = path.join(dataDir, 'metadata.json');
  try {
    const entries = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as unknown;
    if (!Array.isArray(entries)) throw new Error('metadata.json 顶层不是数组');
    const wrongEntries = entries.filter((entry): entry is Row => Boolean(entry) && typeof entry === 'object' && (entry as Row).type === 'wrong_problem');
    return {
      exists: true,
      wrongIdentifiers: wrongEntries.map(entry => `id=${String(entry.id || 'unknown')}`).sort(),
      retainedEntryCount: entries.length - wrongEntries.length,
      nextContent: wrongEntries.length > 0
        ? JSON.stringify(entries.filter(entry => !(entry && typeof entry === 'object' && (entry as Row).type === 'wrong_problem')), null, 2)
        : undefined,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false, wrongIdentifiers: [], retainedEntryCount: 0 };
    blockers.push({ code: 'invalid_metadata', message: error instanceof Error ? error.message : 'metadata.json 无法解析' });
    return { exists: true, wrongIdentifiers: [], retainedEntryCount: 0 };
  }
}

function derivedTablePlan(database: Database.Database): ResetManifest['delete']['tables'] {
  return DERIVED_TABLES.map(definition => {
    const rows = rowsFor(database, definition.name, [...definition.idColumns], 'where' in definition ? definition.where : undefined);
    return { table: definition.name, count: rows.length, identifiers: identifiers(rows, definition.idColumns) };
  });
}

function retiredContentPlan(database: Database.Database, blockers: ResetManifest['blockers']): RetiredContentEntry[] {
  const sources: Array<{ table: string; entityType: string; where?: string }> = [
    { table: 'learning_tasks', entityType: 'learning_task' },
    { table: 'classroom_items', entityType: 'classroom_courseware', where: "type = 'courseware'" },
    { table: 'classroom_items', entityType: 'classroom_quiz', where: "type = 'quiz'" },
    { table: 'learning_packages', entityType: 'learning_package' },
    { table: 'assessment_papers', entityType: 'assessment_paper' },
    { table: 'quiz_results', entityType: 'quiz_result' },
  ];
  const entries: RetiredContentEntry[] = [];
  for (const source of sources) {
    const rows = rowsFor(database, source.table, ['id', 'ownerId'], source.where);
    for (const row of rows) {
      if (typeof row.id !== 'string' || !row.id || typeof row.ownerId !== 'string' || !row.ownerId.trim()) {
        blockers.push({ code: 'missing_retirement_owner', message: '待清理学习内容缺少 ownerId，无法建立下线索引', recordId: typeof row.id === 'string' ? row.id : undefined, field: 'ownerId' });
        continue;
      }
      entries.push({ ownerId: row.ownerId.trim(), entityType: source.entityType, entityId: row.id });
    }
  }
  if (entries.length > 0 && !tableExists(database, 'retired_learning_content')) {
    blockers.push({ code: 'retirement_index_unavailable', message: '下线索引表不存在，无法安全区分已下线内容和未知地址' });
  }
  return entries.sort((left, right) => `${left.ownerId}:${left.entityType}:${left.entityId}`.localeCompare(`${right.ownerId}:${right.entityType}:${right.entityId}`));
}

/**
 * The dry-run makes a standalone recovery snapshot before exposing a deletion
 * plan, so an operator never has to trust a plan generated from live rows alone.
 */
export async function runLearningAssistantResetDryRun(dependencies: ResetDryRunDependencies): Promise<ResetManifest> {
  const { database, dataDir } = dependencies;
  const now = dependencies.now || new Date();
  const runId = timestamp(now);
  const backupDir = path.join(path.resolve(dataDir), 'migrations', RESET_ID, runId);
  await fs.mkdir(backupDir, { recursive: true });

  const databasePath = path.join(backupDir, 'hlos.db');
  await database.backup(databasePath);
  const databaseSha256 = await sha256(databasePath);
  const metadataBackup = await backupMetadata(dataDir, backupDir);
  const blockers: ResetManifest['blockers'] = [];
  const metadata = await metadataPlan(dataDir, blockers);

  const bookRows = rowsFor(database, 'books', ['id', 'filePath', 'mdPath', 'coverPath']);
  const scannedColumns = columnsFor(database, 'scanned_items');
  const scannedFields = ['id', 'type', 'mdPath', 'imagePath', 'allImagesJson'].filter(field => scannedColumns.has(field));
  const wrongRows = scannedFields.length ? rowsFor(database, 'scanned_items', scannedFields, "type = 'wrong_problem'") : [];
  const retainedScannedRows = scannedFields.length ? rowsFor(database, 'scanned_items', scannedFields, "type <> 'wrong_problem' OR type IS NULL") : [];

  const retainedReferences = [
    ...collectReferences(bookRows, dataDir, blockers, 'retained'),
    ...collectReferences(retainedScannedRows, dataDir, blockers, 'retained'),
  ];
  const wrongReferences = collectReferences(wrongRows, dataDir, blockers, 'wrong');
  const retainedFiles = await inspectRetainedFiles(retainedReferences);
  const retainedPaths = new Set(retainedReferences.map(reference => reference.path));
  const wrongFiles = await backupWrongFiles(wrongReferences, retainedPaths, backupDir);

  const manifest: ResetManifest = {
    resetId: RESET_ID,
    mode: 'dry-run',
    runId,
    generatedAt: now.toISOString(),
    backup: { directory: backupDir, databasePath, databaseSha256, ...metadataBackup },
    delete: {
      tables: derivedTablePlan(database),
      wrongProblems: { count: wrongRows.length, identifiers: identifiers(wrongRows, ['id']) },
      files: wrongFiles,
      metadataWrongIdentifiers: metadata.wrongIdentifiers,
      retiredContent: retiredContentPlan(database, blockers),
    },
    retain: {
      books: { count: bookRows.length, identifiers: identifiers(bookRows, ['id']) },
      scannedItems: { count: retainedScannedRows.length, identifiers: identifiers(retainedScannedRows, ['id']) },
      files: retainedFiles,
      metadataEntryCount: metadata.retainedEntryCount,
    },
    blockers,
  };
  await fs.writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

function comparableManifest(manifest: ResetManifest): string {
  return JSON.stringify({
    resetId: manifest.resetId,
    delete: {
      tables: manifest.delete.tables.map(table => ({ table: table.table, identifiers: [...table.identifiers].sort() })),
      wrongProblems: [...manifest.delete.wrongProblems.identifiers].sort(),
      files: manifest.delete.files.candidates.map(file => ({ path: file.path, sha256: file.sha256 })).sort((left, right) => left.path.localeCompare(right.path)),
      sharedFiles: manifest.delete.files.sharedWithRetained.map(file => file.path).sort(),
      missingFiles: manifest.delete.files.missing.map(file => file.path).sort(),
      metadataWrongIdentifiers: [...manifest.delete.metadataWrongIdentifiers].sort(),
      retiredContent: manifest.delete.retiredContent.map(entry => `${entry.ownerId}:${entry.entityType}:${entry.entityId}`).sort(),
    },
    retain: {
      books: [...manifest.retain.books.identifiers].sort(),
      scannedItems: [...manifest.retain.scannedItems.identifiers].sort(),
      files: manifest.retain.files.map(file => ({ path: file.path, sha256: file.sha256 || null, missing: Boolean(file.missing) })).sort((left, right) => left.path.localeCompare(right.path)),
      metadataEntryCount: manifest.retain.metadataEntryCount,
    },
    blockers: manifest.blockers,
  });
}

async function readApprovedManifest(filePath: string): Promise<ResetManifest> {
  const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as ResetManifest;
  if (parsed.resetId !== RESET_ID || parsed.mode !== 'dry-run') throw new Error('批准清单不是本次学习助手清理 dry-run 输出');
  return parsed;
}

function writeRetiredContentIndex(database: Database.Database, entries: RetiredContentEntry[], retiredAt: number): void {
  if (entries.length === 0) return;
  if (!tableExists(database, 'retired_learning_content')) throw new Error('下线索引表不存在，未执行删除');
  const insert = database.prepare(`
    INSERT OR IGNORE INTO retired_learning_content (ownerId, entityType, entityId, retiredAt)
    VALUES (?, ?, ?, ?)
  `);
  for (const entry of entries) insert.run(entry.ownerId, entry.entityType, entry.entityId, retiredAt);
}

function deleteDerivedRows(database: Database.Database): void {
  const deletionOrder = [
    'attempt_item_results', 'review_events', 'paper_attempts', 'assessment_papers', 'assessment_blueprints', 'export_jobs',
    'learning_task_events', 'learning_task_links', 'learning_tasks', 'learning_package_progress', 'learning_packages',
    'wrong_problem_quiz_links', 'quiz_results',
  ];
  for (const table of deletionOrder) if (tableExists(database, table)) database.prepare(`DELETE FROM ${quote(table)}`).run();
  if (tableExists(database, 'classroom_items')) database.prepare("DELETE FROM classroom_items WHERE type IN ('courseware', 'quiz')").run();
  if (tableExists(database, 'scanned_items')) database.prepare("DELETE FROM scanned_items WHERE type = 'wrong_problem'").run();
}

async function stageFiles(files: ManifestFile[], backupDirectory: string): Promise<Array<{ source: string; staged: string }>> {
  const staged: Array<{ source: string; staged: string }> = [];
  const directory = path.join(backupDirectory, 'staged-files');
  await fs.mkdir(directory, { recursive: true });
  for (const file of files) {
    const fileName = `${createHash('sha256').update(file.path).digest('hex')}-${path.basename(file.path)}`;
    const destination = path.join(directory, fileName);
    await fs.rename(file.path, destination);
    staged.push({ source: file.path, staged: destination });
  }
  return staged;
}

async function restoreStagedFiles(staged: Array<{ source: string; staged: string }>): Promise<void> {
  for (const file of [...staged].reverse()) {
    await fs.mkdir(path.dirname(file.source), { recursive: true });
    await fs.rename(file.staged, file.source);
  }
}

async function replaceMetadata(dataDir: string, backupPath: string | undefined, nextContent: string | undefined): Promise<void> {
  if (nextContent === undefined) return;
  const metadataPath = path.join(dataDir, 'metadata.json');
  const temporaryPath = `${metadataPath}.learning-assistant-reset.tmp`;
  await fs.writeFile(temporaryPath, nextContent, 'utf8');
  await fs.rename(temporaryPath, metadataPath);
  if (backupPath && await sha256(metadataPath) === await sha256(backupPath)) {
    throw new Error('metadata.json 未移除旧错题记录');
  }
}

async function restoreMetadata(dataDir: string, backupPath: string | undefined): Promise<void> {
  if (!backupPath) return;
  await fs.copyFile(backupPath, path.join(dataDir, 'metadata.json'));
}

export async function runLearningAssistantResetApply(dependencies: ResetApplyDependencies): Promise<ResetApplyResult> {
  const approved = await readApprovedManifest(dependencies.approvedManifestPath);
  const current = await runLearningAssistantResetDryRun(dependencies);
  if (current.blockers.length > 0) throw new Error(`当前清理清单存在阻断项: ${current.blockers.map(blocker => blocker.code).join(', ')}`);
  if (comparableManifest(approved) !== comparableManifest(current)) throw new Error('批准清单与当前数据集合不一致，未执行删除');

  const currentMetadata = await metadataPlan(dependencies.dataDir, current.blockers);
  if (currentMetadata.wrongIdentifiers.length !== current.delete.metadataWrongIdentifiers.length) {
    throw new Error('metadata.json 错题集合在执行前发生变化，未执行删除');
  }

  const staged: Array<{ source: string; staged: string }> = [];
  let metadataChanged = false;
  try {
    staged.push(...await stageFiles(current.delete.files.candidates, current.backup.directory));
    await replaceMetadata(dependencies.dataDir, current.backup.metadataPath, currentMetadata.nextContent);
    metadataChanged = currentMetadata.nextContent !== undefined;
    dependencies.database.transaction(() => {
      writeRetiredContentIndex(dependencies.database, current.delete.retiredContent, (dependencies.now || new Date()).getTime());
      deleteDerivedRows(dependencies.database);
    })();
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    if (metadataChanged) await restoreMetadata(dependencies.dataDir, current.backup.metadataPath).catch(rollbackError => rollbackErrors.push(rollbackError));
    await restoreStagedFiles(staged).catch(rollbackError => rollbackErrors.push(rollbackError));
    if (rollbackErrors.length > 0) throw new Error(`清理失败且恢复不完整: ${rollbackErrors.map(item => String(item)).join('; ')}`);
    throw error;
  }

  const result: ResetApplyResult = {
    runId: current.runId,
    backupDirectory: current.backup.directory,
    deletedTables: current.delete.tables.map(table => ({ table: table.table, count: table.count })),
    deletedWrongProblems: current.delete.wrongProblems.count,
    stagedFiles: staged.length,
  };
  await fs.writeFile(path.join(current.backup.directory, 'result.json'), JSON.stringify({ status: 'completed', ...result }, null, 2), 'utf8');
  return result;
}

function parseArgs(args: string[]): { mode: 'dry-run' } | { mode: 'apply'; manifestPath: string } {
  if (args.length === 1 && args[0] === '--dry-run') return { mode: 'dry-run' };
  if (args.length === 3 && args[0] === '--apply' && args[1] === '--manifest' && args[2]) return { mode: 'apply', manifestPath: args[2] };
  throw new Error('用法: --dry-run 或 --apply --manifest <absolute-manifest-path>');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { default: database } = await import('../services/databaseService.js');
  const dependencies = { database, dataDir: process.env.DATA_DIR || '/opt/twinkle/data' };
  if (args.mode === 'apply') {
    console.log(JSON.stringify(await runLearningAssistantResetApply({ ...dependencies, approvedManifestPath: args.manifestPath }), null, 2));
    return;
  }
  const manifest = await runLearningAssistantResetDryRun(dependencies);
  console.log(JSON.stringify({ resetId: manifest.resetId, mode: manifest.mode, runId: manifest.runId, backup: manifest.backup, summary: {
    deleteTables: manifest.delete.tables.map(table => ({ table: table.table, count: table.count })),
    wrongProblems: manifest.delete.wrongProblems.count,
    candidateFiles: manifest.delete.files.candidates.length,
    sharedFiles: manifest.delete.files.sharedWithRetained.length,
    blockers: manifest.blockers.length,
  } }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`[${RESET_ID}] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
