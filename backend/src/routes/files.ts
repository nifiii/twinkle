import { Router, Request, Response } from 'express';
import { getFileByHash } from '../services/fileStorage.js';

const router = Router();

/**
 * GET /api/files/check-hash/:hash
 * 根据哈希值检查文件是否已存在
 */
router.get('/check-hash/:hash', async (req: Request, res: Response) => {
  try {
    const { hash } = req.params;
    
    if (!hash) {
      return res.status(400).json({
        success: false,
        error: '缺少哈希值'
      });
    }

    const existingFile = await getFileByHash(hash);

    if (existingFile) {
      return res.json({
        success: true,
        exists: true,
        data: {
          id: existingFile.id,
          type: existingFile.type,
          subject: existingFile.subject,
          timestamp: existingFile.timestamp,
          title: (existingFile as any).title || existingFile.subject || '未命名文件'
        }
      });
    }

    return res.json({
      success: true,
      exists: false
    });

  } catch (error: any) {
    console.error('[files] 查重错误:', error);
    res.status(500).json({
      success: false,
      error: error.message || '内部服务器错误'
    });
  }
});

export default router;
