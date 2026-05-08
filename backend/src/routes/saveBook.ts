import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { saveBookFile, saveBookCover, saveBookMarkdown, updateMetadataIndex } from '../services/fileStorage.js';
import { convertToMarkdown } from '../services/llmService.js';
import { convertPDFToMarkdownWithDoubaoOCR, extractTOCFromMarkdown } from '../services/doubaoService.js';
import { normalizeSubject } from '../utils/subject.js';


const router = express.Router();

// 配置 multer (不再用于接收文件流，因为现在是纯 JSON 请求)
const upload = multer();

// 用户名映射
const USER_NAMES: Record<string, string> = {
  'child_1': '大宝',
  'child_2': '二宝',
  'shared': '共享',
};

/**
 * POST /api/save-book
 * 保存教材到文件系统、关联 Markdown 并更新数据库
 * 接收参数：metadata (JSON), coverImage (path), tempFilePath (path)
 */
router.post('/save-book', upload.none(), async (req: Request, res: Response) => {
  try {
    const { metadata, coverImage, tempFilePath, ownerId = 'shared' } = req.body;

    if (!metadata || !tempFilePath) {
      console.error('[saveBook] 缺少参数:', { metadata: !!metadata, tempFilePath: !!tempFilePath });
      return res.status(400).json({
        success: false,
        error: '缺少必要参数 (metadata, tempFilePath)',
      });
    }

    // 解析 metadata
    const bookMetadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    // 写入侧统一学科枚举
    bookMetadata.subject = normalizeSubject(bookMetadata.subject);
    const { title, subject, category, fileHash } = bookMetadata;
    const userName = USER_NAMES[ownerId] || '共享';
    const bookId = `book_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[saveBook] >>> 收到保存请求: ${title} (${subject}), ID: ${bookId}, Hash: ${fileHash}`);

    // 1. 路径修复与验证
    // 兼容多种路径格式: /uploads/temp/... 或 uploads/temp/... 或 绝对路径
    let relativePath = tempFilePath;
    if (relativePath.startsWith('/')) relativePath = relativePath.slice(1);

    // 统一使用项目根目录拼接，避免 Linux 下以 / 开头被误认为根目录绝对路径
    const absoluteTempPath = path.join(process.cwd(), relativePath);

    console.log(`[saveBook] [1/5] 验证临时文件: ${absoluteTempPath}`);
    try {
      await fs.access(absoluteTempPath);
    } catch (accessErr) {
      console.error(`[saveBook] ❌ 临时文件不存在: ${absoluteTempPath}`);
      return res.status(404).json({
        success: false,
        error: `临时文件不存在或已过期: ${tempFilePath}`,
      });
    }

    // 2. 移动并归档原始文件
    console.log(`[saveBook] [2/5] 正在归档原始文件...`);
    const fileBuffer = await fs.readFile(absoluteTempPath);
    const originalFileName = path.basename(absoluteTempPath);
    const savedFilePath = await saveBookFile(fileBuffer, originalFileName, ownerId, subject, userName);
    console.log(`[saveBook] ✓ 原始文件已归档: ${savedFilePath}`);

    // 3. 处理封面图片
    console.log(`[saveBook] [3/5] 正在处理封面图片...`);
    let webCoverPath = null;
    let obsidianCoverPath = null;

    if (coverImage) {
      let relativeCover = coverImage;
      if (relativeCover.startsWith('/')) relativeCover = relativeCover.slice(1);
      const tempCoverPath = path.join(process.cwd(), relativeCover);

      try {
        await fs.access(tempCoverPath);
        const coverFileName = path.basename(tempCoverPath);
        const savedFileName = await saveBookCover(tempCoverPath, coverFileName);
        webCoverPath = `/covers/${savedFileName}`;
        obsidianCoverPath = `[[${savedFileName}]]`;
        console.log(`[saveBook] ✓ 封面已归档: ${savedFileName}`);
      } catch (err) {
        console.warn(`[saveBook] ⚠️ 封面图片处理失败 (跳过): ${coverImage}`);
      }
    }

    // 4. 更新初步数据库记录 (标记为处理中)
    // Why: 此路由是「我的书架」专用入口,落库目标永远是 books 表。
    // 不依赖 LLM 返回的 category/type 判定 — 简历等非典型教材会被 LLM 标成
    // category: '其他',导致条目误写入 scanned_items,书架查询(type=textbook)永远漏掉。
    console.log(`[saveBook] [4/5] 正在更新数据库初步记录...`);
    const initialEntry = {
      id: bookId,
      ...bookMetadata,
      type: 'textbook',
      ownerId,
      userName,
      timestamp: Date.now(),
      filePath: savedFilePath,
      mdPath: undefined,
      imagePath: webCoverPath || undefined,
      fileHash: fileHash || undefined,
      status: 'processing'
    };
    await updateMetadataIndex(initialEntry);

    // 5. 返回成功响应给前端 (不再等待 Markdown 转换)
    res.json({
      success: true,
      data: {
        id: bookId,
        title,
        status: 'processing'
      },
    });

    // 6. 异步处理：转换 Markdown 并清理临时文件
    setImmediate(async () => {
      try {
        console.log(`[saveBook] [Async] 开始后台转换 Markdown: ${bookId}`);
        const tempTxtPath = absoluteTempPath.replace(path.extname(absoluteTempPath), '.txt');
        const tempMdPath = absoluteTempPath.replace(path.extname(absoluteTempPath), '.md');

        let mdFilePath = null;

        try {
          // 尝试读取由 upload 阶段写入的 .txt 文件
          // 注意：/api/upload-book/parse 接口在已存档路径下不写 .txt，
          // 此时 content 降级为空字符串，后续逻辑会走 OCR 分支处理原始 PDF
          let content = '';
          try {
            await fs.access(tempTxtPath);
            content = await fs.readFile(tempTxtPath, 'utf-8');
          } catch {
            console.warn(`[saveBook] [Async] .txt 文件不存在，内容降级为空 (将走 OCR/文本提取路径): ${tempTxtPath}`);
          }

          let markdownContent = '';

          // 核心启发式判断：纯文本缺失或极短，说明是扫描版或 .txt 未生成，走 OCR 路径
          if (content.length < 200 && absoluteTempPath.toLowerCase().endsWith('.pdf')) {
            console.log(`[saveBook] [Async] 纯文本极短或缺失 (${content.length} 字符)，调用 Doubao OCR 降级处理`);
            markdownContent = await convertPDFToMarkdownWithDoubaoOCR(absoluteTempPath, title || path.basename(absoluteTempPath));
          } else {
            // 非扫描版：调用 AI 小分片并发转换（6k 分片，最多6并发）
            console.log(`[saveBook] [Async] 非扫描版文本 (${content.length} 字符)，调用 AI 并发转换 Markdown`);
            markdownContent = await convertToMarkdown(content);
          }

          // 4.1 影印版特别增强：如果 OCR 成功且之前没有目录，则尝试从 Markdown 中二次提取目录
          const existingTOC = bookMetadata.tableOfContents || [];
          let finalTOC = existingTOC;

          if (existingTOC.length === 0 && markdownContent.length > 500) {
            console.log(`[saveBook] [Async] 影印版 PDF 目录为空，正在从 OCR Markdown 中二次提取...`);
            try {
              const extractedTOC = await extractTOCFromMarkdown(markdownContent, title);
              if (extractedTOC && extractedTOC.length > 0) {
                console.log(`[saveBook] [Async] ✓ 成功提取影印版目录: ${extractedTOC.length} 个条目`);
                finalTOC = extractedTOC;
              }
            } catch (tocErr) {
              console.warn(`[saveBook] [Async] ⚠️ 提取扫描版目录失败 (非致命):`, tocErr);
            }
          }

          // 保存正式的 Markdown 文件 (传入 finalTOC 确保元数据最新)
          const metadataForSave = { 
            ...bookMetadata, 
            tableOfContents: finalTOC,
            coverImage: obsidianCoverPath || '' 
          };
          mdFilePath = await saveBookMarkdown(metadataForSave, markdownContent, ownerId, userName);

          console.log(`[saveBook] [Async] ✓ Markdown 转换完成: ${mdFilePath}`);

          // 更新数据库记录为完成
          await updateMetadataIndex({
            ...initialEntry,
            tableOfContents: finalTOC, // 同步更新索引中的目录
            mdPath: mdFilePath,
            status: 'completed'
          });

        } catch (convErr) {
          console.error(`[saveBook] [Async] ❌ Markdown 转换失败: ${bookId}`, convErr);
          // 转换失败时，将状态标记为 failed
          await updateMetadataIndex({
            ...initialEntry,
            status: 'failed'
          });
        }

        // 清理所有临时文件
        try {
          await Promise.all([
            fs.unlink(absoluteTempPath).catch(() => { }),
            fs.unlink(tempMdPath).catch(() => { }),
            fs.unlink(tempTxtPath).catch(() => { })
          ]);
          console.log(`[saveBook] [Async] 临时文件清理完成: ${bookId}`);
        } catch (cleanupErr) {
          console.warn(`[saveBook] [Async] ⚠️ 清理临时文件时出现警告: ${bookId}`, cleanupErr);
        }
      } catch (err) {
        console.error(`[saveBook] [Async] ❌ 异步处理过程中出现严重错误: ${bookId}`, err);
      }
    });

  } catch (error) {
    console.error('[saveBook] ❌ 严重错误:', error);
    const message = error instanceof Error ? error.message : '保存失败';
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: message,
      });
    }
  }
});

/**
 * 根据 MIME 类型获取文件格式
 */
function getFileFormat(mimeType: string): 'pdf' | 'epub' | 'txt' {
  if (mimeType === 'application/pdf') {
    return 'pdf';
  } else if (mimeType === 'application/epub+zip') {
    return 'epub';
  } else if (mimeType === 'text/plain') {
    return 'txt';
  }
  throw new Error(`未知的 MIME 类型: ${mimeType}`);
}

export default router;
