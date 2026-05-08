// 学科字段统一为中文枚举。
// Why: 历史数据中 OCR/上游返回过 'English'/'english'/'Math' 等英文与大小写变体，
// 导致 AI 课堂学科筛选、概述页 trendBySubject 漏匹配。
// 写入侧统一在此映射，读取侧无需再做兼容（迁移脚本会一次性归一化历史数据）。

const SUBJECT_MAP: Record<string, string> = {
  // 中文标准枚举（自映射，便于 case-insensitive trim）
  '语文': '语文', '数学': '数学', '英语': '英语', '科学': '科学',
  '物理': '物理', '化学': '化学', '生物': '生物',
  '历史': '历史', '地理': '地理', '政治': '政治',
  '美术': '美术', '音乐': '音乐', '体育': '体育', '其他': '其他', '综合': '综合',
  // 英文 → 中文
  'math': '数学', 'mathematics': '数学', 'maths': '数学',
  'chinese': '语文',
  'english': '英语',
  'science': '科学', 'general science': '科学',
  'physics': '物理',
  'chemistry': '化学',
  'biology': '生物',
  'history': '历史',
  'geography': '地理', 'geo': '地理',
  'politics': '政治', 'civics': '政治',
  'art': '美术',
  'music': '音乐',
  'pe': '体育', 'physical education': '体育',
};

/**
 * 归一化学科字段。
 * 空值/未识别值落到 '综合'，确保 DB 中 subject 永远非空且为中文。
 */
export function normalizeSubject(raw: any): string {
  if (raw === null || raw === undefined) return '综合';
  const s = String(raw).trim();
  if (!s) return '综合';
  const hit = SUBJECT_MAP[s.toLowerCase()];
  if (hit) return hit;
  // 已是未列入枚举的中文（如学校自定义"道法"），原样保留
  return s;
}
