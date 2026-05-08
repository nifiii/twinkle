import { Router, Request, Response, NextFunction } from 'express';
import {
  queryMetadata,
  getMetadataById,
  readMarkdownFile,
  deleteMetadata
} from '../services/fileStorage.js';

const router = Router();

/**
 * DELETE /api/scanned-items/:id
 * 删除扫描项及其关联文件
 */
router.delete('/scanned-items/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    console.log(`[scannedItems] 收到删除请求: ${id}`);

    await deleteMetadata(id);

    return res.json({
      success: true,
      message: '扫描项已成功删除'
    });
  } catch (error: any) {
    console.error('[scannedItems] 删除错误:', error);
    next(error);
  }
});

/**
 * GET /api/scanned-items
 * 查询扫描项列表
 */
router.get('/scanned-items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ownerId, subject, type, limit } = req.query;

    console.log(`[scannedItems] 查询条件:`, { ownerId, subject, type, limit });

    // 查询元数据
    const metadataList = await queryMetadata({
      ownerId: ownerId as string,
      subject: subject as string,
      type: type as string,
      limit: limit ? parseInt(limit as string) : undefined,
    });

    // 返回轻量级数据（包含题目预览 JSON）
    const items = metadataList.map(meta => ({
      id: meta.id,
      ownerId: meta.ownerId,
      userName: meta.userName,
      timestamp: meta.timestamp,
      mdPath: meta.mdPath,
      imagePath: meta.imagePath,
      problemsJson: (meta as any).problemsJson, // 包含结构化题目数据
      meta: {
        type: meta.type,
        subject: meta.subject,
        chapter_hint: meta.chapter,
      },
    }));

    return res.json({
      success: true,
      data: items,
      count: items.length,
    });

  } catch (error: any) {
    console.error('[scannedItems] 错误:', error);
    next(error);
  }
});

/**
 * GET /api/scanned-items/:id
 * 获取单个扫描项详情（包含完整Markdown内容）
 */
router.get('/scanned-items/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    console.log(`[scannedItems] 获取详情: ${id}`);

    // 查询元数据
    const metadata = await getMetadataById(id);

    if (!metadata) {
      return res.status(404).json({
        success: false,
        error: '扫描项不存在'
      });
    }

    // 读取 Markdown 文件内容
    let markdown = '';
    if (metadata.mdPath) {
      try {
        markdown = await readMarkdownFile(metadata.mdPath);
      } catch (error) {
        console.error(`[scannedItems] 读取Markdown失败: ${metadata.mdPath}`);
        markdown = '# 文件读取失败\n\n请检查文件是否存在。';
      }
    }

    // 返回完整数据
    const item = {
      id: metadata.id,
      ownerId: metadata.ownerId,
      userName: metadata.userName,
      timestamp: metadata.timestamp,
      mdPath: metadata.mdPath,
      imagePath: metadata.imagePath,
      markdown,
      problemsJson: (metadata as any).problemsJson,
      allImagesJson: (metadata as any).allImagesJson,
      meta: {
        type: metadata.type,
        subject: metadata.subject,
        chapter_hint: metadata.chapter,
      },
    };

    return res.json({
      success: true,
      data: item,
    });

  } catch (error: any) {
    console.error('[scannedItems] 错误:', error);
    next(error);
  }
});

export default router;
