import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../services/databaseService.js';

const router = Router();

interface UserRow {
  id: string;
  name: string;
  avatar: string | null;
  birthDate: string | null;
  baseGrade: number | null;
  baseGradeSetAt: string | null;
  createdAt: number;
  updatedAt: number;
}

const GRADE_NAMES = [
  '小学一年级', '小学二年级', '小学三年级',
  '小学四年级', '小学五年级', '小学六年级',
  '初中七年级（初一）', '初中八年级（初二）', '初中九年级（初三）',
  '高中十年级（高一）', '高中十一年级（高二）', '高中十二年级（高三）',
];

const schoolYearStart = (date: Date): number => {
  return date.getMonth() + 1 >= 9 ? date.getFullYear() : date.getFullYear() - 1;
};

const computeGradeNum = (row: UserRow): number => {
  const now = new Date();
  const currentYear = schoolYearStart(now);

  if (row.baseGrade && row.baseGradeSetAt) {
    const [by, bm] = row.baseGradeSetAt.split('-').map(Number);
    const baseDate = new Date(by, (bm || 9) - 1, 1);
    const baseYear = schoolYearStart(baseDate);
    const grade = row.baseGrade + (currentYear - baseYear);
    return Math.max(1, Math.min(12, grade));
  }

  if (row.birthDate) {
    const [by, bm] = row.birthDate.split('-').map(Number);
    const birthDate = new Date(by, (bm || 9) - 1, 1);
    const birthYear = schoolYearStart(birthDate);
    const grade = currentYear - birthYear - 5;
    return Math.max(1, Math.min(12, grade));
  }

  return 1;
};

const formatUser = (row: UserRow) => {
  const gradeNum = computeGradeNum(row);
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar || '👤',
    birthDate: row.birthDate || undefined,
    baseGrade: row.baseGrade || undefined,
    baseGradeSetAt: row.baseGradeSetAt || undefined,
    grade: GRADE_NAMES[gradeNum - 1],
    gradeNum,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

router.get('/users', (_req: Request, res: Response) => {
  try {
    const rows = db.prepare('SELECT * FROM users ORDER BY createdAt ASC').all() as UserRow[];
    res.json({ success: true, data: rows.map(formatUser) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/users', (req: Request, res: Response) => {
  try {
    const { name, avatar, birthDate, baseGrade } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'name 不能为空' });
    }
    const id = uuidv4();
    const now = Date.now();
    const setAt = baseGrade ? new Date().toISOString().slice(0, 7) : null;
    db.prepare(
      `INSERT INTO users (id, name, avatar, birthDate, baseGrade, baseGradeSetAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, name.trim(), avatar || '👤', birthDate || null, baseGrade || null, setAt, now, now);

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
    res.json({ success: true, data: formatUser(row) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/users/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, avatar, birthDate, baseGrade } = req.body;

    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    if (!existing) return res.status(404).json({ success: false, error: '用户不存在' });

    const updates: string[] = [];
    const params: any[] = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
    if (avatar !== undefined) { updates.push('avatar = ?'); params.push(avatar); }
    if (birthDate !== undefined) { updates.push('birthDate = ?'); params.push(birthDate || null); }
    if (baseGrade !== undefined && baseGrade !== existing.baseGrade) {
      updates.push('baseGrade = ?');
      params.push(baseGrade || null);
      updates.push('baseGradeSetAt = ?');
      params.push(new Date().toISOString().slice(0, 7));
    }
    if (updates.length === 0) {
      return res.json({ success: true, data: formatUser(existing) });
    }
    updates.push('updatedAt = ?');
    params.push(Date.now());
    params.push(id);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
    res.json({ success: true, data: formatUser(row) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/users/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const count = db.prepare('SELECT COUNT(*) as c FROM users').get() as any;
    if (count.c <= 1) {
      return res.status(400).json({ success: false, error: '至少保留一个用户' });
    }
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '用户不存在' });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
