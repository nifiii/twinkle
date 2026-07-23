import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../services/databaseService.js';
import { normalizeSubject } from '../utils/subject.js';
import { readCoursewareJobResult, submitCoursewareJob } from '../services/coursewareJobs.js';
import { jobStore } from '../services/jobRuntime.js';

const router = Router();

// 课件生成接口（保持原 path 向后兼容）
router.post('/generate-courseware', async (req: Request, res: Response) => {
  try {
    const {
      bookTitle, chapter, chapters, studentName, subject,
      teachingStyle, wrongProblems, ownerId,
      autoSave,
      existingSections, // 复用前一次生成结果，仅做保存
    } = req.body;

    if (!bookTitle || !chapter || !studentName) {
      return res.status(400).json({
        success: false,
        error: '缺少必需参数: bookTitle, chapter, studentName'
      });
    }

    // 多章节支持：优先使用 chapters 数组
    const chapterList: string[] = Array.isArray(chapters) && chapters.length > 0
      ? chapters
      : String(chapter).split(/[；;、,]/).map(s => s.trim()).filter(Boolean);
    const chapterCount = chapterList.length || 1;

    // 如果客户端传入 existingSections（用户在预览模态点保存），直接落库不再调 LLM
    if (autoSave === true && Array.isArray(existingSections) && existingSections.length > 0) {
      const id = uuidv4();
      const resolvedOwnerId = ownerId || 'shared';
      try {
        db.prepare(`
          INSERT INTO classroom_items
            (id, type, bookTitle, chapter, subject, ownerId, userName, contentJson, slideCount, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, 'courseware', bookTitle, chapterList.join('；'),
          normalizeSubject(subject), resolvedOwnerId, studentName,
          JSON.stringify(existingSections), existingSections.length, Date.now()
        );
        console.log(`[Courseware] 复用已生成内容保存: ${id} (${existingSections.length} 节)`);
        return res.json({
          success: true,
          data: existingSections,
          id,
          saved: true,
          slideCount: existingSections.length,
        });
      } catch (dbErr: any) {
        console.error('[Courseware] 保存失败:', dbErr);
        return res.status(500).json({ success: false, error: '保存失败：' + dbErr.message });
      }
    }

    const submission = await submitCoursewareJob({
      bookTitle, chapter, chapters, studentName, subject, teachingStyle, wrongProblems, ownerId: ownerId || 'shared',
    });
    if (!submission.accepted) return res.status(429).json({ success: false, error: '当前任务队列已满，请稍后重试' });
    return res.status(202).json({ success: true, data: { taskId: submission.job!.id } });
  } catch (error: any) {
    console.error('[Courseware] 任务提交失败:', error);
    return res.status(500).json({ success: false, error: '课件任务提交失败，请稍后重试' });
  }
});

router.get('/generate-courseware/task/:id', async (req: Request, res: Response) => {
  const ownerId = typeof req.query.ownerId === 'string' && req.query.ownerId ? req.query.ownerId : 'shared';
  const job = jobStore.getForOwner(req.params.id, ownerId);
  if (!job || job.type !== 'courseware') return res.status(404).json({ success: false, error: '课件任务不存在' });
  try {
    return res.json({ success: true, data: { status: job.status, stage: job.stage, queuePosition: jobStore.getQueuePosition(job.id), result: await readCoursewareJobResult(job), error: job.status === 'failed' ? '课件生成失败，请重试' : undefined } });
  } catch {
    return res.status(500).json({ success: false, error: '课件任务结果读取失败' });
  }
});

export default router;
