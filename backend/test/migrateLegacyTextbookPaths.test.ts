import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import test from 'node:test';
import Database from 'better-sqlite3';

test('dry-run validates exactly the four repaired textbook files without writing paths', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'twinkle-textbook-migration-'));
  const legacyRoot = '/opt/hl-os/data';
  const books = [
    ['book_1773391888189_y1x36uh8s', '科学', false],
    ['book_1773386082323_ds0c9rxor', '英语', false],
    ['book_1773313132813_58hn5f4mm', '数学', false],
    ['book_1770715192926_zk7ffb37q', '语文', true],
  ] as const;

  try {
    const database = new Database(path.join(dataDir, 'hlos.db'));
    database.exec(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY, title TEXT, author TEXT, subject TEXT, category TEXT, grade TEXT,
        publisher TEXT, publishDate TEXT, tags TEXT, ownerId TEXT, userName TEXT, filePath TEXT,
        mdPath TEXT, coverPath TEXT, status TEXT, fileHash TEXT, tableOfContents TEXT, timestamp INTEGER
      );
    `);
    for (const [id, subject, needsReparse] of books) {
      const relativePdf = `originals/books/大宝/${subject}/${id}.pdf`;
      const currentPdf = path.join(dataDir, relativePdf);
      await fs.mkdir(path.dirname(currentPdf), { recursive: true });
      await fs.writeFile(currentPdf, 'PDF');

      const relativeMd = `obsidian/Books/大宝/${subject}/${id}.md`;
      if (!needsReparse) {
        const currentMd = path.join(dataDir, relativeMd);
        await fs.mkdir(path.dirname(currentMd), { recursive: true });
        await fs.writeFile(currentMd, '# 教材');
      }
      database.prepare(`
        INSERT INTO books (id, title, subject, category, tags, ownerId, userName, filePath, mdPath, status, tableOfContents, timestamp)
        VALUES (?, ?, ?, '教材', '[]', 'shared', '大宝', ?, ?, 'completed', '[]', 1)
      `).run(id, `${subject}三年级下册`, subject, `${legacyRoot}/${relativePdf}`, `${legacyRoot}/${relativeMd}`);
    }
    database.close();

    process.env.DATA_DIR = dataDir;
    const { closeMigrationDatabase, runMigration } = await import('../src/scripts/migrateLegacyTextbookPaths.js');
    await runMigration(false);
    closeMigrationDatabase();

    const check = new Database(path.join(dataDir, 'hlos.db'));
    const row = check.prepare('SELECT filePath, mdPath FROM books WHERE id = ?').get('book_1773313132813_58hn5f4mm') as { filePath: string; mdPath: string };
    assert.equal(row.filePath.startsWith(legacyRoot), true);
    assert.equal(row.mdPath.startsWith(legacyRoot), true);
    check.close();
  } finally {
    delete process.env.DATA_DIR;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
