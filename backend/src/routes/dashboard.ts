import { Router, Request, Response } from 'express';
import db from '../services/databaseService.js';

const router = Router();

/**
 * GET /api/dashboard/overview?ownerId=xxx
 * 概述页一次性聚合接口（5-7 条 SQL）。
 *
 * 设计要点：
 * - "待学课件" = source='manual' 且 lastStudiedAt IS NULL（不含错题讲解）
 * - "待订正错题" = scanned_items.type='wrong_problem' 中尚未生成讲解+测验的题目数
 * - "待完成测验" = classroom_items.type='quiz' 仍存在的条目（提交答卷会删除）
 * - 作答回顾不进行系统评分，因此不计算掌握率或成绩趋势
 */
router.get('/dashboard/overview', (req: Request, res: Response) => {
  const { ownerId } = req.query;
  if (!ownerId || typeof ownerId !== 'string') {
    return res.status(400).json({ success: false, error: '缺少参数: ownerId' });
  }

  try {
    // 1. 待学课件数 + TOP 5
    const pendingCwRow = db.prepare(`
      SELECT COUNT(*) AS cnt FROM classroom_items
      WHERE type = 'courseware'
        AND (ownerId = ? OR ownerId = 'shared')
        AND (source IS NULL OR source = 'manual')
        AND lastStudiedAt IS NULL
    `).get(ownerId) as any;
    const pendingCoursewareCount = pendingCwRow?.cnt || 0;

    const pendingCourseware = db.prepare(`
      SELECT id, bookTitle, chapter, subject, slideCount, createdAt
      FROM classroom_items
      WHERE type = 'courseware'
        AND (ownerId = ? OR ownerId = 'shared')
        AND (source IS NULL OR source = 'manual')
        AND lastStudiedAt IS NULL
      ORDER BY createdAt DESC
      LIMIT 5
    `).all(ownerId);

    // 2. 待完成测验数 + TOP 5
    // 提交后通过 /quiz-result/start 删除原记录；存量即为"待完成"。
    const pendingQuizRow = db.prepare(`
      SELECT COUNT(*) AS cnt FROM classroom_items
      WHERE type = 'quiz'
        AND (ownerId = ? OR ownerId = 'shared')
    `).get(ownerId) as any;
    const pendingQuizCount = pendingQuizRow?.cnt || 0;

    const pendingQuizzes = db.prepare(`
      SELECT id, bookTitle, chapter, subject, questionCount, source, createdAt
      FROM classroom_items
      WHERE type = 'quiz'
        AND (ownerId = ? OR ownerId = 'shared')
      ORDER BY createdAt DESC
      LIMIT 5
    `).all(ownerId);

    // 3. 待订正错题数 + TOP 5
    // 总错题数：scanned_items.type='wrong_problem' 中所有 problemsJson 项
    // 已生成集合：wrong_problem_quiz_links 中 (scannedItemId, problemIndex)
    // 待订正 = 总数 - 已生成
    const wrongRows = db.prepare(`
      SELECT id, subject, timestamp, problemsJson
      FROM scanned_items
      WHERE type = 'wrong_problem' AND ownerId = ?
      ORDER BY timestamp DESC
    `).all(ownerId) as any[];

    const linkRows = db.prepare(`
      SELECT scannedItemId, problemIndex FROM wrong_problem_quiz_links WHERE ownerId = ?
    `).all(ownerId) as any[];
    const generatedSet = new Set(linkRows.map(r => `${r.scannedItemId}:${r.problemIndex}`));

    let pendingWrongProblemCount = 0;
    const pendingWrongProblems: any[] = [];
    for (const row of wrongRows) {
      let problems: any[] = [];
      try { problems = JSON.parse(row.problemsJson || '[]'); } catch { /* skip */ }
      problems.forEach((p: any, idx: number) => {
        const key = `${row.id}:${idx}`;
        if (generatedSet.has(key)) return;
        const content: string = p.content || p.question || '';
        const standardAnswer: string = p.standardAnswer || p.answer || '';
        // 仅有标准答案的错题才能"订正"，否则也无法生成讲解
        if (!content.trim() || !standardAnswer.trim()) return;
        pendingWrongProblemCount++;
        if (pendingWrongProblems.length < 5) {
          pendingWrongProblems.push({
            scannedItemId: row.id,
            problemIndex: idx,
            snippet: content.slice(0, 50),
            subject: row.subject || '综合',
            timestamp: row.timestamp,
          });
        }
      });
    }

    return res.json({
      success: true,
      data: {
        stats: {
          pendingCoursewareCount,
          pendingWrongProblemCount,
          pendingQuizCount,
        },
        pendingCourseware,
        pendingWrongProblems,
        pendingQuizzes,
      },
    });
  } catch (err: any) {
    console.error('[Dashboard] overview 查询失败:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
