import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import db from './databaseService.js';

/**
 * 文件存储服务
 * 负责将数据保存到服务端文件系统（Obsidian + 原始文件）
 */

// 基础路径配置
const BASE_DIR = process.env.DATA_DIR || '/opt/twinkle/data';
const OBSIDIAN_DIR = path.join(BASE_DIR, 'obsidian');
const ORIGINALS_DIR = path.join(BASE_DIR, 'originals');
const METADATA_FILE = path.join(BASE_DIR, 'metadata.json');
const COVERS_DIR = path.join(OBSIDIAN_DIR, 'covers'); // 封面存储在 Obsidian 仓库内以便引用

// 目录映射
const DIR_MAP = {
  wrong_problem: 'Wrong_Problems',
  exam_paper: 'Exams_Homework',
  homework: 'Exams_Homework',
  note: 'Exams_Homework',
  courseware: 'Courses',
  mock_exam: 'Courses',
} as const;

/**
 * 确保目录结构存在
 */
export async function ensureDirectoryStructure(): Promise<void> {
  const dirs = [
    OBSIDIAN_DIR,
    path.join(OBSIDIAN_DIR, 'Wrong_Problems'),
    path.join(OBSIDIAN_DIR, 'Exams_Homework'),
    path.join(OBSIDIAN_DIR, 'Courses'),
    path.join(OBSIDIAN_DIR, 'Books'),
    COVERS_DIR,
    path.join(ORIGINALS_DIR, 'images'),
    path.join(ORIGINALS_DIR, 'books'),
  ];

  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      console.error(`创建目录失败: ${dir}`, error);
    }
  }

  // 确保元数据文件存在
  try {
    await fs.access(METADATA_FILE);
  } catch {
    await fs.writeFile(METADATA_FILE, JSON.stringify([]));
  }
}

/**
 * 保存原始图片到文件系统
 * @param base64Data - 图片的base64编码
 * @param ownerId - 用户ID
 * @param subject - 学科
 * @param userName - 用户名
 * @returns 图片文件路径 (Web URL)
 */
export async function saveOriginalImage(
  base64Data: string,
  ownerId: string,
  subject: string = '综合',
  userName: string = '未知学生'
): Promise<string> {
  await ensureDirectoryStructure();

  // 提取 base64 数据
  const base64String = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64String, 'base64');

  // 生成文件名: DD_HHMMSS_uuid.jpg
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const fileName = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}_${uuidv4().slice(0, 8)}.jpg`;

  // 路径策略: originals/Exams_Homework/YYYY-MM-DD/科目/学生/
  const safeSubject = subject.replace(/[/\\?%*:|"<>]/g, '-');
  const safeUserName = userName.replace(/[/\\?%*:|"<>]/g, '-');
  const targetDir = path.join(ORIGINALS_DIR, 'Exams_Homework', dateStr, safeSubject, safeUserName);

  await fs.mkdir(targetDir, { recursive: true });
  const filePath = path.join(targetDir, fileName);

  await fs.writeFile(filePath, buffer);

  // 返回相对 URL
  return `/data/originals/Exams_Homework/${dateStr}/${safeSubject}/${safeUserName}/${fileName}`;
}

/**
 * 生成单个错题的 Obsidian Markdown
 */
function generateWrongProblemMarkdown(
  problem: any,
  parentPaperLink: string,
  imagePaths: string[],
  userName: string,
  subject: string,
  timestamp: number
): string {
  const date = new Date(timestamp);
  const kpTags = (problem.knowledgePoints || []).map((kp: string) => `#${kp}`).join(' ');

  // 错题展示逻辑：展示所有相关页面的图片
  const imageEmbeds = imagePaths.map(p => `![[${p}|400]]`).join('\n');

  return `---
type: wrong_problem
subject: ${subject}
source_paper: "[[${parentPaperLink}]]"
knowledge_points: [${(problem.knowledgePoints || []).join(', ')}]
status: ${problem.status}
created: ${date.toISOString()}
---

# 错题复盘: ${subject} - ${problem.knowledgePoints?.[0] || '综合'}

${imageEmbeds}

## 1. 题目原题
${problem.content}

## 2. 错误记录
- **我的答案:** ${problem.studentAnswer || '无'}
- **老师/AI批注:** ${problem.teacherComment || '无'}

## 3. 正确解析
- **标准答案:** ${problem.standardAnswer || '未提供'}
- **涉及知识点:** ${kpTags}

---
归档于: ${date.toLocaleString('zh-CN')} | 来自: ${userName}
`;
}

/**
 * 保存 Obsidian Markdown 文件 (全卷归档 + 错题剥离)
 * @param scannedItem - 扫描项数据
 * @param userName - 用户名
 * @param imagePaths - 原始图片路径数组
 * @returns Markdown 文件路径 (主文件) 和 剥离出的错题元数据列表
 */
export async function saveObsidianMarkdown(
  scannedItem: any,
  userName: string,
  imagePaths: string | string[]
): Promise<{ mainFilePath: string; wrongProblems: any[] }> {
  await ensureDirectoryStructure();

  const paths = Array.isArray(imagePaths) ? imagePaths : [imagePaths];
  const { meta, timestamp } = scannedItem;
  const date = new Date(timestamp);
  const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD

  // 目录策略: obsidian/Exams_Homework/YYYY-MM-DD/科目/学生/
  const docType = meta.type as keyof typeof DIR_MAP;
  const categoryDir = DIR_MAP[docType] || 'Exams_Homework';
  const safeSubject = (meta.subject || '综合').replace(/[/\\?%*:|"<>]/g, '-');
  const safeUserName = userName.replace(/[/\\?%*:|"<>]/g, '-');
  
  const mainFileName = `${dateStr}_${safeSubject}_整卷.md`;
  const mainTargetDir = path.join(OBSIDIAN_DIR, categoryDir, dateStr, safeSubject, safeUserName);
  
  await fs.mkdir(mainTargetDir, { recursive: true });
  const mainFilePath = path.join(mainTargetDir, mainFileName);

  // 生成主文件内容
  const mainMarkdown = generateObsidianMarkdown(scannedItem, userName, paths);
  await fs.writeFile(mainFilePath, mainMarkdown, 'utf-8');

  // --- 2. 错题原子化剥离 (存储于 Wrong_Problems 文件夹) ---
  const wrongProblemsMetadata: any[] = [];

  if (meta.problems && meta.problems.length > 0) {
    const wrongProblems = meta.problems.filter((p: any) => p.status === 'wrong' || p.status === 'corrected');
    
    for (const problem of wrongProblems) {
      const kp = problem.knowledgePoints?.[0] || '综合';
      const wpId = uuidv4();
      const wpFileName = `${dateStr}_${kp.replace(/[/\\?%*:|"<>]/g, '-')}_${wpId.slice(0, 8)}_错题.md`;
      const wpTargetDir = path.join(OBSIDIAN_DIR, 'Wrong_Problems', dateStr, safeSubject, safeUserName);
      
      await fs.mkdir(wpTargetDir, { recursive: true });
      const wpFilePath = path.join(wpTargetDir, wpFileName);
      
      const wpMarkdown = generateWrongProblemMarkdown(
        problem,
        mainFileName.replace('.md', ''),
        paths,
        userName,
        meta.subject || '综合',
        timestamp
      );
      
      await fs.writeFile(wpFilePath, wpMarkdown, 'utf-8');

      // 收集错题元数据以便后续写入数据库
      wrongProblemsMetadata.push({
        id: wpId,
        type: 'wrong_problem',
        ownerId: scannedItem.ownerId,
        userName,
        subject: meta.subject || '综合',
        chapter: problem.knowledgePoints?.[0] || meta.chapter_hint || '',
        timestamp: timestamp,
        mdPath: wpFilePath,
        imagePath: paths[0],
        allImagesJson: JSON.stringify(paths),
        problemsJson: JSON.stringify([problem]),
        fileHash: scannedItem.fileHash || null,
      });
    }
  }

  return {
    mainFilePath,
    wrongProblems: wrongProblemsMetadata
  };
}

/**
 * 生成 Obsidian Markdown 文件内容 (全卷模式)
 */
function generateObsidianMarkdown(
  scannedItem: any,
  userName: string,
  imagePaths: string[]
): string {
  const { meta, rawMarkdown, timestamp } = scannedItem;
  const date = new Date(timestamp);

  const imageEmbeds = imagePaths.map(p => `![[${p}|600]]`).join('\n\n');

  // Frontmatter
  const frontmatter = `---
type: ${meta.type}
subject: ${meta.subject}
chapter: ${meta.chapter_hint || ''}
owner: ${scannedItem.ownerId}
created: ${date.toISOString()}
images: [${imagePaths.map(p => `"${p}"`).join(', ')}]
problems_count: ${meta.problems?.length || 0}
tags: [${meta.subject}, ${meta.type}]
---

# ${meta.subject} 试卷/作业记录 (${date.toLocaleDateString('zh-CN')})

${imageEmbeds}

## 题目列表与校对记录

${meta.problems?.map((p: any, idx: number) => `
### Q${idx + 1}: ${p.questionNumber || (idx + 1)} [${p.status === 'correct' ? '✅' : p.status === 'wrong' ? '❌' : '✏️'}]
- **内容:** ${p.content}
- **学生答案:** ${p.studentAnswer || '无'}
- **标准答案:** ${p.standardAnswer || '未提供'}
${p.teacherComment ? `- **批注:** ${p.teacherComment}` : ''}
${p.knowledgePoints ? `- **知识点:** ${p.knowledgePoints.join(', ')}` : ''}
`).join('\n')}

---
## 原始识别流 (Markdown)
${rawMarkdown}
`;

  return frontmatter;
}

/**
 * 保存教材文件
 * @param fileBuffer - 文件二进制数据
 * @param fileName - 原始文件名
 * @param ownerId - 用户ID
 * @param subject - 学科 (可选，用于分类)
 * @param userName - 用户名 (可选，用于分类)
 * @returns 文件路径
 */
export async function saveBookFile(
  fileBuffer: Buffer,
  fileName: string,
  ownerId: string,
  subject: string = '其他',
  userName: string = 'shared'
): Promise<string> {
  await ensureDirectoryStructure();

  // 策略：originals/books/用户名/学科/
  const safeSubject = subject.replace(/[/\\?%*:|"<>]/g, '-');
  const targetDir = path.join(ORIGINALS_DIR, 'books', userName, safeSubject);

  await fs.mkdir(targetDir, { recursive: true });
  const filePath = path.join(targetDir, fileName);

  await fs.writeFile(filePath, fileBuffer);

  return filePath;
}

/**
 * 保存图书封面
 * @param tempCoverPath - 临时封面路径
 * @param fileName - 目标文件名
 * @returns 相对封面路径 (用于前端访问)
 */
export async function saveBookCover(
  tempCoverPath: string,
  fileName: string
): Promise<string> {
  await ensureDirectoryStructure();

  const targetPath = path.join(COVERS_DIR, fileName);
  await fs.copyFile(tempCoverPath, targetPath);

  // 返回文件名，由调用方决定如何构建路径（Web URL 或 Obsidian 相对路径）
  return fileName;
}

/**
 * 保存图书 Markdown
 * @param metadata - 图书元数据
 * @param content - Markdown 内容
 * @param ownerId - 用户ID
 * @param userName - 用户名
 * @returns 文件路径
 */
export async function saveBookMarkdown(
  metadata: any,
  content: string,
  ownerId: string,
  userName: string
): Promise<string> {
  await ensureDirectoryStructure();

  const { title, subject, category, tags, coverImage } = metadata;
  
  const safeSubject = (subject || '其他').replace(/[/\\?%*:|"<>]/g, '-');
  const safeTitle = title.replace(/[/\\?%*:|"<>]/g, '-');
  const mdFileName = `${safeTitle}.md`;
  
  // 路径: obsidian/Books/用户名/学科/
  const targetDir = path.join(OBSIDIAN_DIR, 'Books', userName, safeSubject);
  
  await fs.mkdir(targetDir, { recursive: true });
  const filePath = path.join(targetDir, mdFileName);

  // 构建 Frontmatter
  const frontmatter = `---
title: ${title}
author: ${metadata.author || ''}
subject: ${subject}
category: ${category}
grade: ${metadata.grade}
publisher: ${metadata.publisher || ''}
publishDate: ${metadata.publishDate || ''}
tags: [${tags ? tags.join(', ') : ''}]
cover: ${coverImage || ''}
created: ${new Date().toISOString()}
owner: ${ownerId}
---

# ${title}

${content}
`;

  await fs.writeFile(filePath, frontmatter, 'utf-8');
  return filePath;
}

/**
 * 保存课件/测验 Markdown
 * @param ownerId - 用户ID
 * @param userName - 用户名
 * @param subject - 学科
 * @param chapter - 章节
 * @param content - Markdown 内容
 * @param type - 类型（courseware/quiz）
 * @returns Markdown 文件路径
 */
export async function saveCoursewareMarkdown(
  ownerId: string,
  userName: string,
  subject: string,
  chapter: string,
  content: string,
  type: 'courseware' | 'quiz'
): Promise<string> {
  await ensureDirectoryStructure();

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

  // 生成文件名
  const typeLabel = type === 'courseware' ? '课件' : '测验';
  const safeChapter = chapter.replace(/[/\\?%*:|"<>]/g, '-');
  const fileName = `${dateStr}_${safeChapter}_${typeLabel}_${uuidv4().slice(0, 8)}.md`;

  // 构建路径: obsidian/Courses/大宝/数学/
  const targetDir = path.join(
    OBSIDIAN_DIR,
    'Courses',
    userName,
    subject
  );

  await fs.mkdir(targetDir, { recursive: true });
  const filePath = path.join(targetDir, fileName);

  // 生成 Frontmatter
  const frontmatter = `---
type: ${type === 'courseware' ? 'COURSEWARE' : 'MOCK_EXAM'}
subject: ${subject}
chapter: ${chapter}
owner: ${ownerId}
created: ${now.toISOString()}
tags: [${subject}, ${chapter}, ${type}]
---

# ${subject} - ${chapter} ${typeLabel}

${content}
`;

  await fs.writeFile(filePath, frontmatter, 'utf-8');

  return filePath;
}

/**
 * 读取 Markdown 文件内容
 * @param filePath - 文件路径
 * @returns 文件内容
 */
export async function readMarkdownFile(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content;
  } catch (error) {
    console.error(`读取文件失败: ${filePath}`, error);
    throw new Error(`文件不存在或无法读取: ${filePath}`);
  }
}

/**
 * 元数据条目接口
 */
interface MetadataEntry {
  id: string;
  type: string;
  ownerId: string;
  userName: string;
  subject: string;
  chapter?: string;
  timestamp: number;
  mdPath?: string;
  imagePath?: string;
  filePath?: string; // 用于教材文件
  fileHash?: string; // 文件哈希值
  tableOfContents?: any[]; // 章节目录
}

/**
 * 根据哈希值获取文件信息 (用于查重)
 * @param hash - 文件哈希值
 * @returns 匹配的元数据条目或null
 */
export async function getFileByHash(hash: string): Promise<MetadataEntry | null> {
  try {
    // 1. 先从 scanned_items 表查找
    const scannedItem = db.prepare('SELECT * FROM scanned_items WHERE fileHash = ?').get(hash) as any;
    if (scannedItem) {
      return {
        ...scannedItem,
        imagePath: scannedItem.imagePath,
        problemsJson: scannedItem.problemsJson,
        allImagesJson: scannedItem.allImagesJson,
      } as MetadataEntry;
    }

    // 2. 再从 books 表查找
    const book = db.prepare('SELECT * FROM books WHERE fileHash = ?').get(hash) as any;
    if (book) {
      return {
        ...book,
        tags: JSON.parse(book.tags || '[]'),
        imagePath: book.coverPath,
      } as MetadataEntry;
    }

    return null;
  } catch (error) {
    console.error('[Database] 按哈希查询失败:', error);
    return null;
  }
}

/**
 * 更新元数据索引 (同时支持 JSON 和 SQLite)
 * @param entry - 元数据条目
 */
export async function updateMetadataIndex(entry: MetadataEntry): Promise<void> {
  await ensureDirectoryStructure();

  // 1. 更新 SQLite (首选)
  try {
    // 根据类型决定更新哪个表
    // Why: 仅以显式 type 字段决定落表。category 由 LLM 返回,不可控
    // (历史上简历类 PDF 被标为 '其他' 导致漏入 books 表)。
    if (entry.type === 'textbook') {
      const stmt = db.prepare(`
        INSERT INTO books (
          id, title, author, subject, category, grade, publisher, publishDate, 
          tags, ownerId, userName, filePath, mdPath, coverPath, status, 
          fileHash, tableOfContents, timestamp
        ) VALUES (
          @id, @title, @author, @subject, @category, @grade, @publisher, @publishDate, 
          @tags, @ownerId, @userName, @filePath, @mdPath, @coverPath, @status, 
          @fileHash, @tableOfContents, @timestamp
        )
        ON CONFLICT(id) DO UPDATE SET
          title=excluded.title,
          author=excluded.author,
          subject=excluded.subject,
          category=excluded.category,
          grade=excluded.grade,
          publisher=excluded.publisher,
          publishDate=excluded.publishDate,
          tags=excluded.tags,
          ownerId=excluded.ownerId,
          userName=excluded.userName,
          filePath=excluded.filePath,
          mdPath=excluded.mdPath,
          coverPath=excluded.coverPath,
          status=excluded.status,
          fileHash=excluded.fileHash,
          tableOfContents=excluded.tableOfContents,
          timestamp=excluded.timestamp
      `);

      const params = {
        ...entry,
        title: (entry as any).title || entry.subject || '未命名',
        author: (entry as any).author || '',
        category: (entry as any).category || '教材',
        grade: (entry as any).grade || '',
        publisher: (entry as any).publisher || '',
        publishDate: (entry as any).publishDate || '',
        tags: JSON.stringify((entry as any).tags || []),
        coverPath: entry.imagePath || '',
        status: (entry as any).status || 'completed',
        fileHash: entry.fileHash || null,
        tableOfContents: JSON.stringify(entry.tableOfContents || []),
        timestamp: entry.timestamp
      };
      stmt.run(params);
    } else {
      // 更新 scanned_items 表 (试卷、作业、错题)
      const stmt = db.prepare(`
        INSERT INTO scanned_items (
          id, type, subject, chapter, ownerId, userName, mdPath, imagePath, allImagesJson, problemsJson, fileHash, timestamp
        ) VALUES (
          @id, @type, @subject, @chapter, @ownerId, @userName, @mdPath, @imagePath, @allImagesJson, @problemsJson, @fileHash, @timestamp
        )
        ON CONFLICT(id) DO UPDATE SET
          type=excluded.type,
          subject=excluded.subject,
          chapter=excluded.chapter,
          ownerId=excluded.ownerId,
          userName=excluded.userName,
          mdPath=excluded.mdPath,
          imagePath=excluded.imagePath,
          allImagesJson=excluded.allImagesJson,
          problemsJson=excluded.problemsJson,
          fileHash=excluded.fileHash,
          timestamp=excluded.timestamp
      `);

      const params = {
        id: entry.id,
        type: entry.type,
        subject: entry.subject,
        chapter: entry.chapter || '',
        ownerId: entry.ownerId,
        userName: entry.userName,
        mdPath: entry.mdPath,
        imagePath: entry.imagePath,
        allImagesJson: (entry as any).allImagesJson || '[]',
        problemsJson: (entry as any).problemsJson || '[]',
        fileHash: entry.fileHash || null,
        timestamp: entry.timestamp
      };
      stmt.run(params);
    }
    console.log(`[Database] 成功更新索引: ${entry.id}`);
  } catch (dbError) {
    console.error('[Database] 更新索引失败:', dbError);
  }

  // 2. 更新 JSON (保持兼容性)
  let metadata: MetadataEntry[] = [];
  try {
    const content = await fs.readFile(METADATA_FILE, 'utf-8');
    metadata = JSON.parse(content);
  } catch (error) {
    metadata = [];
  }

  const existingIndex = metadata.findIndex(m => m.id === entry.id);
  if (existingIndex >= 0) {
    metadata[existingIndex] = entry;
  } else {
    metadata.push(entry);
  }

  metadata.sort((a, b) => b.timestamp - a.timestamp);
  await fs.writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2));
}

/**
 * 查询元数据 (优先从 SQLite 查询)
 * @param filters - 过滤条件
 * @returns 元数据列表
 */
export async function queryMetadata(filters: {
  ownerId?: string;
  subject?: string;
  type?: string;
  limit?: number;
}): Promise<MetadataEntry[]> {
  try {
    // 根据类型决定查询哪个表
    const isBookQuery = filters.type === 'textbook';
    const tableName = isBookQuery ? 'books' : 'scanned_items';
    
    let query = `SELECT * FROM ${tableName} WHERE 1=1`;
    const params: any = {};

    if (filters.ownerId) {
      query += " AND (ownerId = @ownerId OR ownerId = 'shared')";
      params.ownerId = filters.ownerId;
    }
    if (filters.subject) {
      query += ' AND subject = @subject';
      params.subject = filters.subject;
    }
    
    // 如果不是查全部，且在 scanned_items 表中，可以按具体类型过滤
    if (!isBookQuery && filters.type && filters.type !== 'all') {
      query += ' AND type = @type';
      params.type = filters.type;
    }

    query += ' ORDER BY timestamp DESC';
    if (filters.limit) {
      query += ' LIMIT @limit';
      params.limit = filters.limit;
    }

    const rows = db.prepare(query).all(params);
    
    return rows.map((row: any) => ({
      ...row,
      tags: isBookQuery ? JSON.parse(row.tags || '[]') : undefined,
      imagePath: isBookQuery ? row.coverPath : row.imagePath,
      problemsJson: !isBookQuery ? row.problemsJson : undefined,
      allImagesJson: !isBookQuery ? row.allImagesJson : undefined,
    })) as MetadataEntry[];
  } catch (error) {
    console.error('[Database] 查询失败，回退到 JSON:', error);
    // 回退到 JSON 逻辑 (原有逻辑)
    const content = await fs.readFile(METADATA_FILE, 'utf-8');
    let metadata: MetadataEntry[] = JSON.parse(content);
    // ... 原有过滤逻辑
    return metadata;
  }
}

/**
 * 获取单个元数据条目
 * @param id - ID
 * @returns 元数据条目或null
 */
export async function getMetadataById(id: string): Promise<MetadataEntry | null> {
  try {
    // 1. 先从 scanned_items 表查找
    const scannedItem = db.prepare('SELECT * FROM scanned_items WHERE id = ?').get(id) as any;
    if (scannedItem) {
      return {
        ...scannedItem,
        imagePath: scannedItem.imagePath,
        problemsJson: scannedItem.problemsJson,
        allImagesJson: scannedItem.allImagesJson,
      } as MetadataEntry;
    }

    // 2. 再从 books 表查找
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id) as any;
    if (book) {
      return {
        ...book,
        tags: JSON.parse(book.tags || '[]'),
        imagePath: book.coverPath,
      } as MetadataEntry;
    }

    // 3. 回退到 JSON 查找 (兼容旧数据)
    const content = await fs.readFile(METADATA_FILE, 'utf-8');
    const metadata: MetadataEntry[] = JSON.parse(content);
    return metadata.find(m => m.id === id) || null;
  } catch (error) {
    console.error('[Database] 获取详情失败:', error);
    return null;
  }
}

/**
 * 删除元数据条目及其关联的物理文件
 * @param id - ID
 */
export async function deleteMetadata(id: string): Promise<void> {
  await ensureDirectoryStructure();

  try {
    // 1. 先获取详情，以便知道要删除哪些物理文件
    const item = await getMetadataById(id);
    if (!item) {
      console.warn(`[deleteMetadata] 未找到条目: ${id}，跳过文件删除`);
    } else {
      console.log(`[deleteMetadata] 正在删除条目: ${id} (${item.subject})`);

      // 待删除文件列表
      const filesToDelete: string[] = [];

      // A. 删除 Markdown 文件
      if (item.mdPath) {
        filesToDelete.push(item.mdPath);
        // 如果是扫描项，可能还有剥离出来的错题 MD 文件
        // 注意：目前错题文件名包含日期和知识点，较难精准定位，暂不处理批量删除错题 MD，
        // 后续建议在 metadata 中记录所有生成的 MD 路径。
      }

      // B. 删除教材原始文件 (PDF 等)
      if (item.filePath) {
        filesToDelete.push(item.filePath);
      }

      // C. 删除图片
      // 转换 Web URL 为绝对路径的辅助函数
      const urlToPath = (url: string) => {
        if (!url || !url.startsWith('/data/')) return null;
        // 去掉开头的 /data/，加上 BASE_DIR
        return path.join(BASE_DIR, url.replace(/^\/data\//, ''));
      };

      if (item.imagePath) {
        const p = urlToPath(item.imagePath);
        if (p) filesToDelete.push(p);
      }

      // 处理多图列表
      if ((item as any).allImagesJson) {
        try {
          const allImages = JSON.parse((item as any).allImagesJson);
          if (Array.isArray(allImages)) {
            allImages.forEach(url => {
              const p = urlToPath(url);
              if (p) filesToDelete.push(p);
            });
          }
        } catch (e) {
          console.error('[deleteMetadata] 解析 allImagesJson 失败', e);
        }
      }

      // 执行物理删除
      for (const filePath of [...new Set(filesToDelete)]) { // 去重
        try {
          await fs.unlink(filePath);
          console.log(`[deleteMetadata] 已物理删除文件: ${filePath}`);
        } catch (err: any) {
          if (err.code !== 'ENOENT') { // 忽略文件不存在的错误
            console.error(`[deleteMetadata] 删除文件失败: ${filePath}`, err);
          }
        }
      }
    }

    // 2. 从 SQLite 删除
    try {
      db.prepare('DELETE FROM scanned_items WHERE id = ?').run(id);
      db.prepare('DELETE FROM books WHERE id = ?').run(id);
      console.log(`[Database] 已从数据库删除记录: ${id}`);
    } catch (dbError) {
      console.error('[Database] 从数据库删除记录失败:', dbError);
    }

    // 3. 从 legacy JSON 删除 (保持兼容性)
    const content = await fs.readFile(METADATA_FILE, 'utf-8');
    let metadata: MetadataEntry[] = JSON.parse(content);
    const initialCount = metadata.length;
    metadata = metadata.filter(m => m.id !== id);
    if (metadata.length !== initialCount) {
      await fs.writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2));
      console.log(`[JSON] 已从 metadata.json 删除记录: ${id}`);
    }

  } catch (error) {
    console.error('执行删除流程失败:', error);
    throw error;
  }
}
