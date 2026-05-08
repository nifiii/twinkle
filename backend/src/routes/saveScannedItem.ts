import { Router, Request, Response, NextFunction } from 'express';
import {
  saveOriginalImage,
  saveObsidianMarkdown,
  updateMetadataIndex
} from '../services/fileStorage.js';
import { normalizeSubject } from '../utils/subject.js';

const router = Router();

// 用户名映射
const USER_NAMES: Record<string, string> = {
  'child_1': '大宝',
  'child_2': '二宝',
  'shared': '共享',
};

/**
 * POST /api/save-scanned-item
 * 保存扫描项到文件系统
 */
router.post('/save-scanned-item', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { scannedItem, originalImagesBase64 } = req.body;

    if (!scannedItem || !originalImagesBase64) {
      return res.status(400).json({
        success: false,
        error: '缺少必需参数: scannedItem, originalImagesBase64'
      });
    }

    console.log(`[saveScannedItem] 开始保存扫描项: ${scannedItem.id}`);

    const userName = USER_NAMES[scannedItem.ownerId] || '未知用户';
    // 写入侧统一学科枚举，避免 OCR 返回的英文/大小写值污染 DB
    scannedItem.meta.subject = normalizeSubject(scannedItem.meta.subject);
    const subject = scannedItem.meta.subject;

    // 1. 保存原始图片 (支持分类存储，支持多图)
    const imageBase64Array = Array.isArray(originalImagesBase64) 
      ? originalImagesBase64 
      : [originalImagesBase64];
    
    const imagePaths: string[] = [];
    for (const base64 of imageBase64Array) {
      const path = await saveOriginalImage(base64, scannedItem.ownerId, subject, userName);
      imagePaths.push(path);
    }
    
    console.log(`[saveScannedItem] ${imagePaths.length} 张原始图片已保存`);

    // 2. 保存 Obsidian Markdown (支持错题剥离)
    const { mainFilePath, wrongProblems } = await saveObsidianMarkdown(scannedItem, userName, imagePaths);
    console.log(`[saveScannedItem] Markdown已保存: ${mainFilePath}`);

    // 3. 更新元数据索引 (同步到 SQLite)
    const savedItems: any[] = [];

    // 3.1 保存主试卷索引
    const isMainPaper = scannedItem.meta.type !== 'wrong_problem';
    const mainEntry = {
      id: scannedItem.id,
      type: scannedItem.meta.type,
      ownerId: scannedItem.ownerId,
      userName,
      subject: scannedItem.meta.subject,
      chapter: scannedItem.meta.chapter_hint,
      timestamp: scannedItem.timestamp,
      mdPath: mainFilePath,
      imagePath: imagePaths[0], // SQLite 中存第一张作为主图
      // 优化存储：归集文档不再存储完整的题目和图片列表 JSON，减少体积
      allImagesJson: isMainPaper ? '[]' : JSON.stringify(imagePaths), 
      problemsJson: isMainPaper ? '[]' : JSON.stringify(scannedItem.meta.problems || []),
      fileHash: scannedItem.fileHash || null, // 保存文件哈希值
    };
    
    await updateMetadataIndex(mainEntry as any);
    savedItems.push(mainEntry);

    // 3.2 保存剥离出的错题索引 (归集到错题分类)
    if (wrongProblems && wrongProblems.length > 0) {
      console.log(`[saveScannedItem] 正在归集 ${wrongProblems.length} 道错题...`);
      for (const wp of wrongProblems) {
        await updateMetadataIndex(wp);
        savedItems.push(wp);
      }
    }
    
    console.log(`[saveScannedItem] 元数据索引已更新，共保存 ${savedItems.length} 个条目`);

    return res.json({
      success: true,
      data: {
        items: savedItems,
        mdPath: mainFilePath,
        imagePath: imagePaths[0],
      }
    });

  } catch (error: any) {
    console.error('[saveScannedItem] 错误:', error);
    next(error);
  }
});

export default router;
