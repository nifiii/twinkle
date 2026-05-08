import { analyzeMetadataWithDoubao, convertToMarkdownWithDoubao } from './doubaoService.js';
import { ChapterNode } from '../types.js';

export type LLMProvider = 'doubao';

// 定义统一的返回接口
export interface LLMMetadataResult {
  title: string;
  author?: string;
  subject: string;
  category: string;
  grade: string;
  tags: string[];
  publisher?: string;
  publishDate?: string;
  tableOfContents: ChapterNode[];
}

/**
 * 统一的元数据分析入口 (目前强制使用 Doubao)
 */
export async function analyzeMetadata(
  text: string,
  fileName: string,
  provider?: LLMProvider
): Promise<LLMMetadataResult> {
  console.log(`正在使用 doubao 服务分析元数据...`);
  return analyzeMetadataWithDoubao(text, fileName);
}

/**
 * 统一的 Markdown 转换入口 (目前强制使用 Doubao)
 */
export async function convertToMarkdown(
  text: string,
  provider?: LLMProvider
): Promise<string> {
  console.log(`正在使用 doubao 服务转换 Markdown...`);
  return convertToMarkdownWithDoubao(text);
}
