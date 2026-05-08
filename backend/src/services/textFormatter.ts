/**
 * textFormatter.ts
 * 本地轻量 PDF 文本 → Markdown 格式化器（零 AI 调用，毫秒级完成）
 *
 * 设计原则：
 * - 针对 pdf-parse 提取的中文教材文本特征
 * - 检测章节标题，数学公式用 $$ 包裹，保持段落可读性
 * - 不引入任何外部依赖
 */

/**
 * 将 pdf-parse 提取的原始文本格式化为 Markdown
 * 无 AI 调用，本地执行，耗时 < 10ms
 */
export function formatPdfTextToMarkdown(rawText: string, title?: string): string {
  if (!rawText || rawText.trim().length === 0) return '';

  // 1. 基础清理：统一换行符，去除多余空白行
  let lines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.trimEnd());

  const result: string[] = [];

  // 如果有书名，添加 H1 标题
  if (title) {
    result.push(`# ${title}\n`);
  }

  // 2. 逐行处理
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 跳过空行（统一由段落逻辑处理）
    if (trimmed === '') {
      // 已有内容时才加空行
      if (result.length > 0 && result[result.length - 1] !== '') {
        result.push('');
      }
      i++;
      continue;
    }

    // ── 标题检测规则 ────────────────────────────────────────
    // 规则 1: 纯数字 + 中文章节名（如 "1 位置与方向（一）"、"第一章 ..."）
    const chapterMatch = trimmed.match(/^(第[一二三四五六七八九十百零\d]+[章节课]|[\d]+[\s　]+[\u4e00-\u9fa5])/);
    // 规则 2: 短行（< 25字），全中文/字母，不含标点句号，可能是小节标题
    const sectionMatch = trimmed.length <= 25
      && /^[\u4e00-\u9fa5\w\s（）()【】·—]+$/.test(trimmed)
      && !trimmed.endsWith('。')
      && !trimmed.endsWith('，')
      && !trimmed.endsWith('：');

    // 规则 3: 例题标识（例1、例2、做一做）
    const exampleMatch = trimmed.match(/^(例\s*\d+|做一做|练习|习题|思考|试一试|想一想)/);

    if (chapterMatch) {
      result.push(`\n## ${trimmed}`);
      i++;
      continue;
    }

    if (exampleMatch) {
      result.push(`\n### ${trimmed}`);
      i++;
      continue;
    }

    // ── 数学公式检测 ─────────────────────────────────────────
    // 检测含有数学运算符的行（÷ × = ≈ ∶ 等）或形如 "30÷5=6" 的计算式
    const hasMathOps = /[÷×≈∶∴∵≠≤≥]/.test(trimmed)
      || /\d+\s*[+\-×÷*\/=]\s*\d+/.test(trimmed)
      || /\\begin\{|\\end\{|\\frac|\\times|\\div/.test(trimmed); // AI 残留 LaTeX

    if (hasMathOps && trimmed.length < 200) {
      // 将行内 \begin{aligned}...\end{aligned} 转换为 $$ 块
      let mathLine = trimmed
        .replace(/\\begin\{aligned\}/g, '')
        .replace(/\\end\{aligned\}/g, '')
        .replace(/\\quad/g, '  ')
        .replace(/\\times/g, '×')
        .replace(/\\div/g, '÷')
        .replace(/\\approx/g, '≈')
        .replace(/\\\\s*/g, '\n')     // \\ 换行转换
        .trim();

      // 如果是竖式计算或对齐公式，包成代码块保持格式
      if (mathLine.includes('\n') || mathLine.length > 60) {
        result.push('```');
        result.push(mathLine);
        result.push('```');
      } else {
        // 短公式：保持原文，不过度处理
        result.push(trimmed
          .replace(/\\begin\{aligned\}/g, '')
          .replace(/\\end\{aligned\}/g, '')
          .replace(/\\quad/g, '  ')
          .trim());
      }
      i++;
      continue;
    }

    // ── 普通段落 ─────────────────────────────────────────────
    // 合并短行（pdf-parse 有时把一段话拆成多行）
    let para = trimmed;
    while (
      i + 1 < lines.length
      && lines[i + 1].trim() !== ''
      && lines[i + 1].trim().length > 0
      // 如果下一行以汉字或字母开头（续写），则合并
      && /^[\u4e00-\u9fa5a-zA-Z0-9（]/.test(lines[i + 1].trim())
      // 当前行不以句号结尾（还没结束）
      && !para.endsWith('。')
      && !para.endsWith('？')
      && !para.endsWith('！')
      // 且下一行不是标题或例题
      && !lines[i + 1].trim().match(/^(第[一二三四五六七八九十百零\d]+[章节课]|[\d]+[\s　]+[\u4e00-\u9fa5])/)
      && !lines[i + 1].trim().match(/^(例\s*\d+|做一做|练习|习题)/)
    ) {
      i++;
      para += lines[i].trim();
    }

    result.push(para);
    i++;
  }

  // 3. 最终清理：去除超过2个连续空行
  const cleaned = result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}
