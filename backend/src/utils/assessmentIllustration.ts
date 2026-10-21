export type AssessmentIllustration = { description: string; svg: string };

// The same generated drawing is consumed by an image element and PDFKit. A
// positive SVG subset prevents either renderer from loading external resources.
export function normalizeAssessmentIllustration(value: unknown): AssessmentIllustration {
  const item = value as Partial<AssessmentIllustration> | null;
  if (!item || typeof item.description !== 'string' || !item.description.trim() || item.description.length > 500 || typeof item.svg !== 'string')
    throw new Error('配图必须包含 description 和完整 svg');
  const svg = item.svg.trim();
  if (svg.length > 20_000 || !/^<svg\s/.test(svg) || !svg.endsWith('</svg>') || /<!|<\?|url\s*\(/i.test(svg))
    throw new Error('配图不是受支持的静态 SVG');
  const tags = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc']);
  const attributes = new Set(['xmlns', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-rule', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'transform', 'opacity']);
  const stack: string[] = [];
  let end = 0;
  for (const match of svg.matchAll(/<(\/?)([A-Za-z][\w:-]*)([^<>]*)>/g)) {
    if (/[<>]/.test(svg.slice(end, match.index))) throw new Error('配图标签不完整');
    end = match.index! + match[0].length;
    const [, closing, tag, body] = match;
    if (!tags.has(tag) || (tag === 'svg' && (stack.length || match.index !== 0) && !closing)) throw new Error('配图包含未允许的标签');
    if (closing) {
      if (body.trim() || stack.pop() !== tag) throw new Error('配图标签未正确闭合');
      continue;
    }
    const rest = body.replace(/\s+([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, key, doubleValue, singleValue) => {
      const value = doubleValue ?? singleValue;
      if (!attributes.has(key) || /[<>&]/.test(value) || (key === 'xmlns' ? value !== 'http://www.w3.org/2000/svg' : /[:;\\]/.test(value)))
        throw new Error('配图包含未允许的属性或外部引用');
      return '';
    });
    if (!/^\s*\/?\s*$/.test(rest)) throw new Error('配图属性格式不完整');
    if (!/\/\s*$/.test(body)) stack.push(tag);
  }
  if (stack.length || end !== svg.length || !/\bviewBox\s*=\s*["']\s*0\s+0\s+[1-9]\d*(?:\.\d+)?\s+[1-9]\d*(?:\.\d+)?\s*["']/.test(svg))
    throw new Error('配图必须闭合并提供从 0 0 开始的有效 viewBox');
  return { description: item.description.trim(), svg };
}
