import { Router, Request, Response } from 'express';
import { readLearningFeatureFlags } from '../services/learningDomain.js';
import {
  createLearningPackage,
  getLearningPackage,
  updateLearningPackagePlayback,
  isLearningPackageInputError,
  LearningPackageValidationError,
  ListeningNotPlayedError,
} from '../services/learningPackageService.js';

const router = Router();

function requirePackagesFeature(res: Response): boolean {
  if (readLearningFeatureFlags().packages) return true;
  res.status(503).json({ success: false, error: '学习包功能尚未启用' });
  return false;
}

router.post('/learning-packages', async (req: Request, res: Response) => {
  if (!requirePackagesFeature(res)) return;
  try {
    const data = await createLearningPackage(req.body || {});
    return res.status(201).json({ success: true, data });
  } catch (error) {
    if (isLearningPackageInputError(error)) {
      return res.status(400).json({
        success: false,
        field: error instanceof LearningPackageValidationError ? error.field : 'ownerId',
        error: error.message,
      });
    }
    console.error('[learning-packages] 创建失败:', error);
    return res.status(500).json({ success: false, error: '学习包创建失败，请稍后重试' });
  }
});

router.get('/learning-packages/:id', (req: Request, res: Response) => {
  if (!requirePackagesFeature(res)) return;
  try {
    const data = getLearningPackage(req.params.id, req.query.ownerId);
    if (!data) return res.status(404).json({ success: false, error: '学习包不存在' });
    return res.json({ success: true, data });
  } catch (error) {
    if (isLearningPackageInputError(error)) {
      return res.status(400).json({
        success: false,
        field: error instanceof LearningPackageValidationError ? error.field : 'ownerId',
        error: error.message,
      });
    }
    console.error('[learning-packages] 读取失败:', error);
    return res.status(500).json({ success: false, error: '学习包读取失败，请稍后重试' });
  }
});

router.post('/learning-packages/:id/playback', (req: Request, res: Response) => {
  if (!requirePackagesFeature(res)) return;
  try {
    const data = updateLearningPackagePlayback(req.params.id, req.body?.ownerId, req.body?.event, undefined, req.body?.answers);
    return res.json({ success: true, data });
  } catch (error) {
    if (isLearningPackageInputError(error)) {
      return res.status(400).json({
        success: false,
        field: error instanceof LearningPackageValidationError ? error.field : 'ownerId',
        errorCode: error instanceof ListeningNotPlayedError ? 'listening_not_played' : undefined,
        error: error.message,
      });
    }
    console.error('[learning-packages] 播放状态更新失败:', error);
    return res.status(500).json({ success: false, error: '播放状态更新失败，请稍后重试' });
  }
});

export default router;
