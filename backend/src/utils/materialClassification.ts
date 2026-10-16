// Source tags describe the material's role. Titles alone cannot distinguish a textbook's exam chapter from a source paper.
export function isSourcePaperMaterial(material: { category?: string | null; tags?: string[] | string | null }): boolean {
  let tags: string[] = [];
  if (Array.isArray(material.tags)) tags = material.tags;
  else { try { const parsed = JSON.parse(material.tags || '[]'); if (Array.isArray(parsed)) tags = parsed; } catch { /* Invalid historical tags do not establish a source type. */ } }
  const classification = [material.category || '', ...tags].join(' ');
  return !/奥数|数学竞赛/.test(classification) && /试卷|试题|测试卷|测验卷|考试卷|期中卷|期末卷|模拟卷/.test(classification);
}
