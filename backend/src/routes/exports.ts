import { Request, Response, Router } from 'express';
import { createExportJob, ExportValidationError, getExportJob } from '../services/exportService.js';
import { readLearningFeatureFlags } from '../services/learningDomain.js';

const router = Router();
const enabled = (res: Response) => { if (readLearningFeatureFlags().exports) return true; res.status(503).json({ success: false, error: 'PDF 导出功能尚未启用' }); return false; };
const inputError = (error: unknown, res: Response) => res.status(400).json({ success: false, field: error instanceof ExportValidationError ? error.field : 'ownerId', error: (error as Error).message });

router.post('/assessment-papers/:id/exports', (req: Request, res: Response) => {
  if (!enabled(res)) return;
  try { return res.status(202).json({ success: true, data: createExportJob({ ...(req.body || {}), paperId: req.params.id }) }); }
  catch (error) { if (error instanceof ExportValidationError) return inputError(error, res); return res.status(500).json({ success: false, error: '创建 PDF 导出失败，请稍后重试' }); }
});

router.get('/exports/:id', (req: Request, res: Response) => {
  if (!enabled(res)) return;
  try {
    const job = getExportJob(req.params.id, req.query.ownerId);
    if (!job) return res.status(404).json({ success: false, error: '导出任务不存在' });
    if (req.query.download !== '1') return res.json({ success: true, data: job });
    if (job.status !== 'completed' || typeof job.filePath !== 'string') return res.status(409).json({ success: false, error: 'PDF 尚未可下载' });
    return res.download(job.filePath, `${job.variant === 'answer' ? '原创答案卷' : '原创试卷'}-${job.paperId}.pdf`);
  } catch (error) { if (error instanceof ExportValidationError) return inputError(error, res); return res.status(500).json({ success: false, error: '读取 PDF 导出失败' }); }
});

export default router;
