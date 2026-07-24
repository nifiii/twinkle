import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { normalizeSubject } from '../utils/subject.js';
import { initJobDatabase } from './jobs.js';

const DATA_DIR = process.env.DATA_DIR || '/opt/twinkle/data';
const DB_PATH = path.join(DATA_DIR, 'hlos.db');

// 确保目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

/**
 * 初始化数据库表
 */
export function initDatabase() {
  console.log(`[Database] 正在初始化数据库: ${DB_PATH}`);
  
  // 书籍表
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      subject TEXT,
      category TEXT,
      grade TEXT,
      publisher TEXT,
      publishDate TEXT,
      tags TEXT, -- 存储为 JSON 字符串
      ownerId TEXT NOT NULL,
      userName TEXT,
      filePath TEXT,
      mdPath TEXT,
      coverPath TEXT,
      status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
      fileHash TEXT,
      tableOfContents TEXT, -- 存储为 JSON 字符串
      extractionMethod TEXT, -- 'doubao' | 'manual' | 'legacy_ai'
      timestamp INTEGER
    )
  `);

  // 扫描项表 (包含试卷、作业、错题归档)
  db.exec(`
    CREATE TABLE IF NOT EXISTS scanned_items (
      id TEXT PRIMARY KEY,
      type TEXT,
      subject TEXT,
      chapter TEXT,
      ownerId TEXT,
      userName TEXT,
      mdPath TEXT,
      imagePath TEXT,
      problemsJson TEXT, -- 存储识别出的结构化题目数据 (JSON)
      fileHash TEXT,
      timestamp INTEGER
    )
  `);

  // AI课堂条目表（课件 + 测验，持久化存储）
  db.exec(`
    CREATE TABLE IF NOT EXISTS classroom_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,           -- 'courseware' | 'quiz'
      bookTitle TEXT NOT NULL,
      chapter TEXT NOT NULL,
      subject TEXT NOT NULL,
      ownerId TEXT NOT NULL,
      userName TEXT,
      contentJson TEXT NOT NULL,    -- JSON: slides[] 或 questions[]
      slideCount INTEGER,           -- courseware 幻灯片数量
      questionCount INTEGER,        -- quiz 题目数量
      lastStudiedAt INTEGER,        -- 课件最近一次被连播的时间戳；null=未学（仅 type=courseware 有意义）
      source TEXT DEFAULT 'manual', -- 'manual' | 'wrong_problem'
      sourceProblemId TEXT,         -- 仅 source='wrong_problem' 时填充："scannedItemId:problemIndex"
      createdAt INTEGER NOT NULL
    )
  `);

  // 错题→讲解/测验 关联表（阶段 C）
  db.exec(`
    CREATE TABLE IF NOT EXISTS wrong_problem_quiz_links (
      id TEXT PRIMARY KEY,
      scannedItemId TEXT NOT NULL,
      problemIndex INTEGER NOT NULL,
      ownerId TEXT NOT NULL,
      coursewareId TEXT NOT NULL,
      quizId TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      UNIQUE(scannedItemId, problemIndex, coursewareId)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_wpql_owner ON wrong_problem_quiz_links(ownerId)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_wpql_source ON wrong_problem_quiz_links(scannedItemId, problemIndex)`);

  // 测验结果归档表（测验完成后，结果持久化于此，原 quiz 记录删除）
  db.exec(`
    CREATE TABLE IF NOT EXISTS quiz_results (
      id TEXT PRIMARY KEY,
      quizId TEXT NOT NULL,         -- 原 classroom_items.id（已删除，仅作关联引用）
      bookTitle TEXT NOT NULL,
      chapter TEXT NOT NULL,
      subject TEXT NOT NULL,
      ownerId TEXT NOT NULL,
      userName TEXT,
      correctCount INTEGER NOT NULL,
      total INTEGER NOT NULL,
      percentage INTEGER NOT NULL,
      resultsJson TEXT NOT NULL,    -- JSON: GradeResult[] 详细批改结果
      suggestions TEXT,             -- AI 学习建议
      status TEXT DEFAULT 'completed', -- pending | completed | failed
      gradedAt INTEGER,
      userOverridesJson TEXT,       -- JSON: { [questionId]: { isCorrect, overriddenAt } }
      createdAt INTEGER NOT NULL
    )
  `);

  // 用户档案表（替代 localStorage 持久化）
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT,
      birthDate TEXT,           -- YYYY-MM
      baseGrade INTEGER,        -- 1-12 学年制基准
      baseGradeSetAt TEXT,      -- YYYY-MM
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `);

  // 拍题异步识别任务表
  db.exec(`
    CREATE TABLE IF NOT EXISTS analyze_tasks (
      id TEXT PRIMARY KEY,
      ownerId TEXT,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_analyze_tasks_createdAt ON analyze_tasks(createdAt)`);

  initJobDatabase(db);

  console.log('[Database] 数据库初始化完成');

  // 数据库迁移逻辑
  try {
    // 1. 检查 scanned_items 表
    const scannedItemsCols = db.prepare("PRAGMA table_info(scanned_items)").all() as any[];
    const scannedItemsNames = scannedItemsCols.map(c => c.name);
    
    if (!scannedItemsNames.includes('problemsJson')) {
      console.log('[Database] 迁移: 为 scanned_items 表添加 problemsJson 字段');
      db.exec("ALTER TABLE scanned_items ADD COLUMN problemsJson TEXT");
    }
    if (!scannedItemsNames.includes('userName')) {
      console.log('[Database] 迁移: 为 scanned_items 表添加 userName 字段');
      db.exec("ALTER TABLE scanned_items ADD COLUMN userName TEXT");
    }
    if (!scannedItemsNames.includes('allImagesJson')) {
      console.log('[Database] 迁移: 为 scanned_items 表添加 allImagesJson 字段');
      db.exec("ALTER TABLE scanned_items ADD COLUMN allImagesJson TEXT");
    }
    if (!scannedItemsNames.includes('fileHash')) {
      console.log('[Database] 迁移: 为 scanned_items 表添加 fileHash 字段');
      db.exec("ALTER TABLE scanned_items ADD COLUMN fileHash TEXT");
    }

    // 2. 检查 books 表
    const booksCols = db.prepare("PRAGMA table_info(books)").all() as any[];
    const booksNames = booksCols.map(c => c.name);
    
    if (!booksNames.includes('userName')) {
      console.log('[Database] 迁移: 为 books 表添加 userName 字段');
      db.exec("ALTER TABLE books ADD COLUMN userName TEXT");
    }
    if (!booksNames.includes('fileHash')) {
      console.log('[Database] 迁移: 为 books 表添加 fileHash 字段');
      db.exec("ALTER TABLE books ADD COLUMN fileHash TEXT");
    }
    if (!booksNames.includes('tableOfContents')) {
      console.log('[Database] 迁移: 为 books 表添加 tableOfContents 字段');
      db.exec("ALTER TABLE books ADD COLUMN tableOfContents TEXT");
    }
    if (!booksNames.includes('extractionMethod')) {
      // Why: 历史图书的提取来源必须保留为可读数据，不能因移除旧 SDK 而丢失该语义。
      console.log('[Database] 迁移: 为 books 表添加 extractionMethod 字段');
      db.exec("ALTER TABLE books ADD COLUMN extractionMethod TEXT");
    }
    // 3. 检查 classroom_items 表（新表，迁移检查）
    const classroomCols = db.prepare("PRAGMA table_info(classroom_items)").all() as any[];
    if (classroomCols.length > 0) {
      // 表已存在，检查字段完整性（未来扩展用）
      const classroomNames = classroomCols.map((c: any) => c.name);
      if (!classroomNames.includes('slideCount')) {
        console.log('[Database] 迁移: 为 classroom_items 表添加 slideCount 字段');
        db.exec('ALTER TABLE classroom_items ADD COLUMN slideCount INTEGER');
      }
      if (!classroomNames.includes('questionCount')) {
        console.log('[Database] 迁移: 为 classroom_items 表添加 questionCount 字段');
        db.exec('ALTER TABLE classroom_items ADD COLUMN questionCount INTEGER');
      }
      // 阶段 B：课件已学习时间戳。null = 未学；任意一段连播成功后写入；后续覆盖
      if (!classroomNames.includes('lastStudiedAt')) {
        console.log('[Database] 迁移: 为 classroom_items 表添加 lastStudiedAt 字段');
        db.exec('ALTER TABLE classroom_items ADD COLUMN lastStudiedAt INTEGER');
      }
      // 阶段 C：错题来源标记
      if (!classroomNames.includes('source')) {
        console.log('[Database] 迁移: 为 classroom_items 表添加 source 字段');
        db.exec("ALTER TABLE classroom_items ADD COLUMN source TEXT DEFAULT 'manual'");
      }
      if (!classroomNames.includes('sourceProblemId')) {
        console.log('[Database] 迁移: 为 classroom_items 表添加 sourceProblemId 字段');
        db.exec('ALTER TABLE classroom_items ADD COLUMN sourceProblemId TEXT');
      }
    }

    // 4. 检查 quiz_results 表新增字段
    const quizResultsCols = db.prepare("PRAGMA table_info(quiz_results)").all() as any[];
    const quizResultsNames = quizResultsCols.map((c: any) => c.name);
    if (!quizResultsNames.includes('status')) {
      console.log('[Database] 迁移: 为 quiz_results 表添加 status 字段');
      db.exec("ALTER TABLE quiz_results ADD COLUMN status TEXT DEFAULT 'completed'");
    }
    if (!quizResultsNames.includes('gradedAt')) {
      console.log('[Database] 迁移: 为 quiz_results 表添加 gradedAt 字段');
      db.exec('ALTER TABLE quiz_results ADD COLUMN gradedAt INTEGER');
    }
    if (!quizResultsNames.includes('userOverridesJson')) {
      console.log('[Database] 迁移: 为 quiz_results 表添加 userOverridesJson 字段');
      db.exec('ALTER TABLE quiz_results ADD COLUMN userOverridesJson TEXT');
    }

    // 5. 一次性归一化历史数据的 subject 字段
    // Why: 历史数据中存在 'English'/'english'/'Math' 等英文与大小写变体，
    //     新写入侧已统一调用 normalizeSubject，但历史行需一次性回填为中文枚举。
    db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id TEXT PRIMARY KEY,
        appliedAt INTEGER NOT NULL
      )
    `);
    const SUBJECT_MIGRATION_ID = '2026-05-06_normalize_subject';
    const migrationApplied = db.prepare('SELECT id FROM _migrations WHERE id = ?').get(SUBJECT_MIGRATION_ID);
    if (!migrationApplied) {
      console.log('[Database] 迁移: 一次性归一化历史 subject 字段');
      const SUBJECT_TABLES = ['scanned_items', 'classroom_items', 'quiz_results', 'books'];
      const updateStmts: Record<string, Database.Statement> = {};
      let totalUpdated = 0;
      for (const table of SUBJECT_TABLES) {
        // 表存在性检查（books/quiz_results/classroom_items 上面 CREATE 已保证；保险起见）
        const exists = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
        ).get(table);
        if (!exists) continue;
        const rows = db.prepare(`SELECT rowid, subject FROM ${table}`).all() as any[];
        updateStmts[table] = db.prepare(`UPDATE ${table} SET subject = ? WHERE rowid = ?`);
        let updated = 0;
        const tx = db.transaction(() => {
          for (const r of rows) {
            const normalized = normalizeSubject(r.subject);
            if (normalized !== r.subject) {
              updateStmts[table].run(normalized, r.rowid);
              updated++;
            }
          }
        });
        tx();
        if (updated > 0) console.log(`[Database] 归一化 ${table}: ${updated} 行`);
        totalUpdated += updated;
      }
      db.prepare('INSERT INTO _migrations (id, appliedAt) VALUES (?, ?)').run(SUBJECT_MIGRATION_ID, Date.now());
      console.log(`[Database] subject 归一化完成，共更新 ${totalUpdated} 行`);
    }

    const LEGACY_EXTRACTION_METHOD_MIGRATION_ID = '2026-07-24_normalize_legacy_extraction_method';
    const legacyExtractionMigrationApplied = db.prepare('SELECT id FROM _migrations WHERE id = ?').get(LEGACY_EXTRACTION_METHOD_MIGRATION_ID);
    if (!legacyExtractionMigrationApplied) {
      // Why: 新版本不再识别旧提供商，但历史图书仍需在书架与详情中可读。
      const result = db.prepare(`
        UPDATE books
        SET extractionMethod = 'legacy_ai'
        WHERE lower(coalesce(extractionMethod, '')) IN ('ge' || 'mini', 'anything' || 'llm')
      `).run();
      db.prepare('INSERT INTO _migrations (id, appliedAt) VALUES (?, ?)').run(LEGACY_EXTRACTION_METHOD_MIGRATION_ID, Date.now());
      console.log(`[Database] 旧提取方式归一化完成，共更新 ${result.changes} 行`);
    }

    // 6. 默认用户植入（如果 users 表为空）
    const userCount = db.prepare("SELECT COUNT(*) as c FROM users").get() as any;
    if (userCount.c === 0) {
      console.log('[Database] 植入默认用户: child_1, child_2');
      const now = Date.now();
      const insertUser = db.prepare(
        `INSERT INTO users (id, name, avatar, birthDate, baseGrade, baseGradeSetAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      insertUser.run('child_1', '大宝', '👦', null, 11, '2025-09', now, now);
      insertUser.run('child_2', '二宝', '👧', null, 7, '2025-09', now, now);
    }
  } catch (err) {
    console.error('[Database] 迁移失败:', err);
  }
}

export default db;
