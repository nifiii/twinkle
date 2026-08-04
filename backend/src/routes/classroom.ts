import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../services/databaseService.js';
import { isRetiredLearningContent } from '../services/retiredLearningContentService.js';
import { createReviewItems, getQuizResultReview, setAnswerReviewReinforcement } from '../services/answerReviewService.js';

const router = Router();

// GET /api/classroom?type=courseware&ownerId=xxx[&source=manual|wrong_problem]
// 返回当前用户的课件或测验列表（不含 contentJson，避免数据量过大）
// source 过滤语义：
//   - 省略：仅返回 source IS NULL 或 'manual'（默认教材方案，向后兼容）
//   - 'wrong_problem'：仅返回错题来源的条目
//   - 'all'：不限制
router.get('/classroom', (req: Request, res: Response) => {
  const { type, ownerId, source } = req.query;

  if (!type || !ownerId) {
    return res.status(400).json({ success: false, error: '缺少参数: type, ownerId' });
  }
  if (type !== 'courseware' && type !== 'quiz') {
    return res.status(400).json({ success: false, error: 'type 必须为 courseware 或 quiz' });
  }

  try {
    let sourceClause = " AND (source IS NULL OR source = 'manual') ";
    if (source === 'wrong_problem') sourceClause = " AND source = 'wrong_problem' ";
    else if (source === 'all') sourceClause = '';

    const rows = db.prepare(`
      SELECT id, type, bookTitle, chapter, subject, ownerId, userName,
             slideCount, questionCount, lastStudiedAt, source, sourceProblemId, createdAt
      FROM classroom_items
      WHERE type = ? AND (ownerId = ? OR ownerId = 'shared') ${sourceClause}
      ORDER BY createdAt DESC
    `).all(type, ownerId as string);

    return res.json({ success: true, data: rows });
  } catch (err: any) {
    console.error('[Classroom] 查询列表失败:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/classroom/:id
// 返回单条记录完整内容（含 contentJson 解析后的数组）
router.get('/classroom/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const row = db.prepare('SELECT * FROM classroom_items WHERE id = ?').get(id) as any;
    if (!row) {
      if (isRetiredLearningContent(db, req.query.ownerId, id, ['classroom_courseware', 'classroom_quiz'])) {
        return res.status(410).json({ success: false, errorCode: 'learning_content_retired', error: '该学习内容已下线' });
      }
      return res.status(404).json({ success: false, error: '记录不存在' });
    }

    let content: any;
    try {
      content = JSON.parse(row.contentJson);
    } catch {
      content = [];
    }

    return res.json({
      success: true,
      data: {
        id: row.id,
        type: row.type,
        bookTitle: row.bookTitle,
        chapter: row.chapter,
        subject: row.subject,
        ownerId: row.ownerId,
        userName: row.userName,
        slideCount: row.slideCount,
        questionCount: row.questionCount,
        createdAt: row.createdAt,
        content  // slides[] 或 questions[]
      }
    });
  } catch (err: any) {
    console.error('[Classroom] 查询详情失败:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/classroom/:id/mark-studied
// 阶段 B：课件全文连播任意一段成功后由前端调用，写入 lastStudiedAt（覆盖式）。
// 仅对 type=courseware 有意义，但不强制校验类型——type=quiz 调用属客户端 bug，写了也无害。
router.post('/classroom/:id/mark-studied', (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const row = db.prepare('SELECT id, lastStudiedAt FROM classroom_items WHERE id = ?').get(id) as any;
    if (!row) {
      return res.status(404).json({ success: false, error: '记录不存在' });
    }
    const now = Date.now();
    db.prepare('UPDATE classroom_items SET lastStudiedAt = ? WHERE id = ?').run(now, id);
    return res.json({ success: true, data: { id, lastStudiedAt: now } });
  } catch (err: any) {
    console.error('[Classroom] mark-studied 失败:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/classroom/:id
// 删除单条课件或测验记录
router.delete('/classroom/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const row = db.prepare('SELECT id FROM classroom_items WHERE id = ?').get(id);
    if (!row) {
      return res.status(404).json({ success: false, error: '记录不存在' });
    }
    db.prepare('DELETE FROM classroom_items WHERE id = ?').run(id);
    console.log(`[Classroom] 已删除记录: ${id}`);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Classroom] 删除失败:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});


// POST /api/quiz-result/start
// 提交答卷后只保存作答回顾快照，避免将学习核对伪装成系统判卷。
router.post('/quiz-result/start', (req: Request, res: Response) => {
  const {
    quizId, questions, answers,
    bookTitle, chapter, subject, ownerId, userName,
  } = req.body;

  if (!quizId || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ success: false, error: '缺少必需参数: quizId, questions' });
  }
  if (!bookTitle || !ownerId) {
    return res.status(400).json({ success: false, error: '缺少必需参数: bookTitle, ownerId' });
  }

  try {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO quiz_results
        (id, quizId, bookTitle, chapter, subject, ownerId, userName,
         correctCount, total, percentage, resultsJson, suggestions, status, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, quizId, bookTitle, chapter || '', subject || '', ownerId, userName || '',
      0, 0, 0, JSON.stringify(createReviewItems(questions, answers || {})), '', 'submitted', Date.now()
    );

    // 立即删除原测验记录
    db.prepare('DELETE FROM classroom_items WHERE id = ?').run(quizId);

    return res.json({ success: true, id, status: 'submitted' });
  } catch (err: any) {
    console.error('[QuizResult/start] 失败:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/quiz-results/:id/override', (_req: Request, res: Response) => {
  return res.status(410).json({ success: false, errorCode: 'grading_retired', error: '改判已下线，请使用需巩固标记' });
});


// GET /api/quiz-results?ownerId=xxx
// 查询用户的测验结果历史列表
router.get('/quiz-results', (req: Request, res: Response) => {
  const { ownerId } = req.query;
  if (!ownerId) {
    return res.status(400).json({ success: false, error: '缺少参数: ownerId' });
  }
  try {
    const rows = db.prepare(`
      SELECT id, quizId, bookTitle, chapter, subject, ownerId, userName,
             status, createdAt
      FROM quiz_results
      WHERE ownerId = ?
      ORDER BY createdAt DESC
    `).all(ownerId as string);
    return res.json({ success: true, data: rows });
  } catch (err: any) {
    console.error('[QuizResults] 查询失败:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/quiz-results/:id
// 查询单条作答回顾，不暴露任何旧评分字段。
router.get('/quiz-results/:id', (req: Request, res: Response) => {
  try {
    const data = getQuizResultReview(db, req.params.id, req.query.ownerId);
    return data ? res.json({ success: true, data }) : res.status(404).json({ success: false, error: '作答回顾不存在' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/quiz-results/:id/review-items/:questionId/reinforcement', (req: Request, res: Response) => {
  try {
    const data = setAnswerReviewReinforcement(db, {
      ownerId: req.body?.ownerId,
      sourceType: 'quiz_result',
      sourceId: req.params.id,
      questionId: req.params.questionId,
      needsReinforcement: req.body?.needsReinforcement,
    });
    return data ? res.json({ success: true, data }) : res.status(404).json({ success: false, error: '作答回顾不存在' });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

export default router;
