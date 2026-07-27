import { Router, Request, Response } from 'express';
import { readLearningFeatureFlags } from '../services/learningDomain.js';
import { AssessmentPaperValidationError, createAssessmentBlueprint, createAssessmentPaper, getAssessmentPaper, isAssessmentPaperInputError } from '../services/assessmentPaperService.js';

const router = Router();
function enabled(res: Response) { if (readLearningFeatureFlags().assessments) return true; res.status(503).json({ success: false, error: '原创试卷功能尚未启用' }); return false; }
function badRequest(error: unknown, res: Response) { return res.status(400).json({ success: false, field: error instanceof AssessmentPaperValidationError ? error.field : 'ownerId', error: (error as Error).message }); }

router.post('/assessment-blueprints', async (req: Request, res: Response) => { if (!enabled(res)) return; try { return res.status(201).json({ success: true, data: await createAssessmentBlueprint(req.body || {}) }); } catch (error) { if (isAssessmentPaperInputError(error)) return badRequest(error, res); console.error('[assessment-blueprints] 创建失败:', error); return res.status(500).json({ success: false, error: '命题蓝图创建失败，请稍后重试' }); } });
router.post('/assessment-papers', async (req: Request, res: Response) => { if (!enabled(res)) return; try { return res.status(201).json({ success: true, data: await createAssessmentPaper(req.body || {}) }); } catch (error) { if (isAssessmentPaperInputError(error)) return badRequest(error, res); console.error('[assessment-papers] 生成失败:', error); return res.status(500).json({ success: false, error: '原创试卷生成失败，请稍后重试' }); } });
router.get('/assessment-papers/:id', (req: Request, res: Response) => { if (!enabled(res)) return; try { const data = getAssessmentPaper(req.params.id, req.query.ownerId); return data ? res.json({ success: true, data }) : res.status(404).json({ success: false, error: '原创试卷不存在' }); } catch (error) { if (isAssessmentPaperInputError(error)) return badRequest(error, res); console.error('[assessment-papers] 读取失败:', error); return res.status(500).json({ success: false, error: '原创试卷读取失败，请稍后重试' }); } });
export default router;
