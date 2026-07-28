import { Router, Request, Response } from 'express';
import db from '../services/databaseService.js';
import { LearningOwnerContextError, readLearningFeatureFlags } from '../services/learningDomain.js';
import { LearningTaskValidationError, retryLearningTask } from '../services/learningTaskService.js';
import { getClassroomTask, learningTaskTargetExists, listClassroomTasks, parseLegacyTaskReference } from '../services/classroomTaskQueryService.js';

const router = Router();
const enabled = (res: Response) => {
  if (readLearningFeatureFlags().tasks) return true;
  res.status(503).json({ success: false, errorCode: 'feature_disabled', error: '学习任务功能尚未启用' });
  return false;
};
const fail = (error: unknown, res: Response) => {
  if (error instanceof LearningOwnerContextError) return res.status(400).json({ success: false, errorCode: 'invalid_context', error: '需要当前学生档案' });
  if (error instanceof LearningTaskValidationError) return res.status(400).json({ success: false, errorCode: 'invalid_source', field: error.field, error: error.message });
  console.error('[learning-tasks]', error);
  return res.status(500).json({ success: false, errorCode: 'generation_failed', error: '学习任务读取失败，请稍后重试' });
};

router.get('/learning-tasks', (req: Request, res: Response) => {
  if (!enabled(res)) return;
  try {
    const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
      return res.status(400).json({ success: false, errorCode: 'invalid_source', field: 'limit', error: '分页数量必须为 1 到 100' });
    }
    return res.json({ success: true, data: listClassroomTasks(db, req.query.ownerId, {
      generationStatus: typeof req.query.status === 'string' ? req.query.status : undefined,
      subject: typeof req.query.subject === 'string' ? req.query.subject : undefined,
      taskType: typeof req.query.type === 'string' ? req.query.type : undefined,
      bookId: typeof req.query.bookId === 'string' ? req.query.bookId : undefined,
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      limit,
    }) });
  } catch (error) { return fail(error, res); }
});
router.get('/learning-tasks/:id', (req: Request, res: Response) => {
  if (!enabled(res)) return;
  try {
    const task = getClassroomTask(db, req.params.id, req.query.ownerId);
    if (!task) {
      const legacyReference = parseLegacyTaskReference(req.params.id);
      if (legacyReference && !learningTaskTargetExists(db, req.query.ownerId, legacyReference)) {
        return res.status(410).json({ success: false, errorCode: 'task_target_missing', error: '关联学习内容已不存在' });
      }
      return res.status(404).json({ success: false, errorCode: 'task_not_found', error: '学习任务不存在' });
    }
    if (task.primaryLink && !learningTaskTargetExists(db, req.query.ownerId, task.primaryLink)) {
      return res.status(410).json({ success: false, errorCode: 'task_target_missing', error: '关联学习内容已不存在' });
    }
    return res.json({ success: true, data: task });
  } catch (error) { return fail(error, res); }
});
router.post('/learning-tasks/:id/retry', (req: Request, res: Response) => {
  if (!enabled(res)) return;
  try { return res.json({ success: true, data: retryLearningTask(db, req.params.id, req.body?.ownerId) }); } catch (error) { return fail(error, res); }
});
export default router;
