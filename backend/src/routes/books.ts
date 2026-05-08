import { Router, Request, Response, NextFunction } from 'express';
import { queryMetadata, getMetadataById, deleteMetadata, updateMetadataIndex } from '../services/fileStorage.js';
import fs from 'fs/promises';

const router = Router();

// 可编辑字段白名单 — 严禁覆盖文件路径、ownerId、id 等不可变/敏感字段
const EDITABLE_FIELDS = [
  'title', 'author', 'subject', 'category', 'grade',
  'publisher', 'publishDate', 'tags', 'tableOfContents',
] as const;
type EditableField = typeof EDITABLE_FIELDS[number];

/**
 * DELETE /api/books/:id
 * 删除教材及其关联文件
 */
router.delete('/books/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    console.log(`[books] 收到删除请求: ${id}`);

    await deleteMetadata(id);

    return res.json({
      success: true,
      message: '教材已成功删除'
    });
  } catch (error: any) {
    console.error('[books] 删除错误:', error);
    next(error);
  }
});

/**
 * GET /api/books
 * 查询教材列表
 */
router.get('/books', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ownerId, subject, limit } = req.query;

    console.log(`[books] 查询条件:`, { ownerId, subject, limit });

    // 查询元数据（只查询教材类型）
    const metadataList = await queryMetadata({
      ownerId: ownerId as string,
      subject: subject as string,
      type: 'textbook', // 只返回教材
      limit: limit ? parseInt(limit as string) : undefined,
    });

    // 读取每个教材文件的基本信息
    const books = await Promise.all(
      metadataList.map(async (meta) => {
        let fileSize = 0;
        let pageCount = 0;

        // 尝试获取文件大小
        if (meta.filePath) {
          try {
            const stats = await fs.stat(meta.filePath);
            fileSize = stats.size;
          } catch (error) {
            console.error(`[books] 无法获取��件大小: ${meta.filePath}`);
          }
        }

        return {
          id: meta.id,
          ownerId: meta.ownerId,
          userName: meta.userName,
          uploadedAt: meta.timestamp,
          filePath: meta.filePath,
          mdPath: (meta as any).mdPath,
          fileSize,
          pageCount,
          subject: meta.subject,
          status: (meta as any).status || 'completed',
          // 元数据 (从数据库读取真实字段)
          metadata: {
            title: (meta as any).title || `${meta.subject}教材`,
            author: (meta as any).author,
            subject: meta.subject,
            category: (meta as any).category,
            grade: (meta as any).grade,
            publisher: (meta as any).publisher,
            publishDate: (meta as any).publishDate,
            tags: (meta as any).tags || [],
            tableOfContents: (meta as any).tableOfContents ? JSON.parse((meta as any).tableOfContents) : [],
            coverImage: meta.imagePath,
          },
        };
      })
    );

    return res.json({
      success: true,
      data: books,
      count: books.length,
    });

  } catch (error: any) {
    console.error('[books] 错误:', error);
    next(error);
  }
});

/**
 * GET /api/books/:id
 * 获取单个教材详情
 */
router.get('/books/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    console.log(`[books] 获取详情: ${id}`);

    // 查询元数据
    const metadata = await getMetadataById(id);

    if (!metadata) {
      return res.status(404).json({
        success: false,
        error: '教材不存在'
      });
    }

    // 获取文件信息
    let fileSize = 0;
    if (metadata.filePath) {
      try {
        const stats = await fs.stat(metadata.filePath);
        fileSize = stats.size;
      } catch (error) {
        console.error(`[books] 无法获取文件大小: ${metadata.filePath}`);
      }
    }

    // 返回完整数据
    const book = {
      id: metadata.id,
      ownerId: metadata.ownerId,
      userName: metadata.userName,
      uploadedAt: metadata.timestamp,
      filePath: metadata.filePath,
      mdPath: (metadata as any).mdPath,
      fileSize,
      status: (metadata as any).status || 'completed',
      metadata: {
        title: (metadata as any).title || `${metadata.subject}教材`,
        author: (metadata as any).author,
        subject: metadata.subject,
        category: (metadata as any).category,
        grade: (metadata as any).grade,
        publisher: (metadata as any).publisher,
        publishDate: (metadata as any).publishDate,
        tags: (metadata as any).tags || [],
        tableOfContents: (metadata as any).tableOfContents ? JSON.parse((metadata as any).tableOfContents) : [],
        coverImage: metadata.imagePath,
      },
    };

    return res.json({
      success: true,
      data: book,
    });

  } catch (error: any) {
    console.error('[books] 错误:', error);
    next(error);
  }
});

/**
 * PATCH /api/books/:id
 * 更新教材元数据(仅可编辑字段)
 * 入参示例:{ subject: '科学', tags: ['xxx'] }
 */
router.patch('/books/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const body = req.body || {};

    const existing = await getMetadataById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: '教材不存在' });
    }
    if ((existing as any).type && (existing as any).type !== 'textbook' && ((existing as any).category !== '教材')) {
      return res.status(400).json({ success: false, error: '该条目不是教材,无法通过此接口编辑' });
    }

    // 仅取白名单字段,空字符串/undefined 不覆盖
    const patch: Record<string, any> = {};
    for (const f of EDITABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body, f) && body[f] !== undefined) {
        patch[f] = body[f];
      }
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, error: '没有可更新的字段' });
    }

    // 合并并重新落库 — updateMetadataIndex 走 INSERT ... ON CONFLICT UPDATE
    // existing.tableOfContents 在 books 表场景下是 JSON 字符串(getMetadataById 未解析),
    // 而 updateMetadataIndex 又会调用 JSON.stringify, 必须先解析回数组避免双重转义。
    const existingAny = existing as any;
    const normalizedToc =
      typeof existingAny.tableOfContents === 'string'
        ? (() => { try { return JSON.parse(existingAny.tableOfContents); } catch { return []; } })()
        : (existingAny.tableOfContents || []);

    const merged: any = {
      ...existing,
      tableOfContents: normalizedToc,
      ...patch,
      type: 'textbook',
      // 保留 timestamp 不变(timestamp 表示上传时间,不是修改时间)
      timestamp: existing.timestamp,
    };
    await updateMetadataIndex(merged);
    console.log(`[books] 已更新教材元数据: ${id} 字段=${Object.keys(patch).join(',')}`);

    return res.json({
      success: true,
      data: { id, updated: Object.keys(patch) },
    });
  } catch (error: any) {
    console.error('[books] 更新错误:', error);
    next(error);
  }
});

export default router;
