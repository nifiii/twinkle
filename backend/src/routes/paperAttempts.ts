import { Router, Request, Response } from 'express';
import { readLearningFeatureFlags } from '../services/learningDomain.js';
import { createPaperAttempt, getPaperAttempt, isPaperAttemptInputError, PaperAttemptValidationError, updatePaperAttempt } from '../services/paperAttemptService.js';
import db from '../services/databaseService.js';
import { getPaperAttemptReview, setAnswerReviewReinforcement } from '../services/answerReviewService.js';

const router = Router();
const enabled = (res: Response) => { if (readLearningFeatureFlags().attempts) return true; res.status(503).json({ success: false, error: '网页作答功能尚未启用' }); return false; };
const inputError = (error: unknown, res: Response) => res.status(400).json({ success: false, field: error instanceof PaperAttemptValidationError ? error.field : 'ownerId', error: (error as Error).message });

router.post('/paper-attempts', (req: Request, res: Response) => { if (!enabled(res)) return; try { return res.status(201).json({ success: true, data: createPaperAttempt(req.body || {}) }); } catch (error) { if (isPaperAttemptInputError(error)) return inputError(error, res); console.error('[paper-attempts] 创建失败:', error); return res.status(500).json({ success: false, error: '创建作答失败，请稍后重试' }); } });
router.get('/paper-attempts/:id', (req: Request, res: Response) => { if (!enabled(res)) return; try { const data = getPaperAttempt(req.params.id, req.query.ownerId); return data ? res.json({ success: true, data }) : res.status(404).json({ success: false, error: '作答记录不存在' }); } catch (error) { if (isPaperAttemptInputError(error)) return inputError(error, res); return res.status(500).json({ success: false, error: '读取作答失败，请稍后重试' }); } });
router.patch('/paper-attempts/:id', (req: Request, res: Response) => { if (!enabled(res)) return; try { return res.json({ success: true, data: updatePaperAttempt(req.params.id, req.body || {}) }); } catch (error) { if (isPaperAttemptInputError(error)) return inputError(error, res); console.error('[paper-attempts] 更新失败:', error); return res.status(500).json({ success: false, error: '保存作答失败，请稍后重试' }); } });
router.get('/paper-attempts/:id/review', (req: Request, res: Response) => { if (!enabled(res)) return; try { const data = getPaperAttemptReview(db, req.params.id, req.query.ownerId); return data ? res.json({ success: true, data }) : res.status(404).json({ success: false, error: '作答回顾不存在' }); } catch (error) { return inputError(error, res); } });
router.put('/paper-attempts/:id/review-items/:questionId/reinforcement', (req: Request, res: Response) => { if (!enabled(res)) return; try { const data = setAnswerReviewReinforcement(db, { ownerId: req.body?.ownerId, sourceType: 'paper_attempt', sourceId: req.params.id, questionId: req.params.questionId, needsReinforcement: req.body?.needsReinforcement }); return data ? res.json({ success: true, data }) : res.status(404).json({ success: false, error: '作答回顾不存在' }); } catch (error) { return inputError(error, res); } });
router.get('/paper-attempts/:id/diagnosis', (_req: Request, res: Response) => res.status(410).json({ success: false, errorCode: 'grading_retired', error: '学习诊断已下线，请查看作答回顾' }));
router.post('/paper-attempts/:id/reviews', (_req: Request, res: Response) => res.status(410).json({ success: false, errorCode: 'grading_retired', error: '改判已下线，请使用需巩固标记' }));
export default router;
