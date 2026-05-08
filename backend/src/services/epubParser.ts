import EPub from 'epub2';
import { ChapterNode } from '../types';
import { BookParseResult } from './pdfParser';

/**
 * 解析 EPUB 文件
 * @param buffer EPUB 文件的 Buffer
 * @returns 解析结果包含文本内容、章节数、元数据
 */
export async function parseEPUB(buffer: Buffer): Promise<BookParseResult> {
  return new Promise((resolve, reject) => {
    try {
      const epub = new EPub(buffer as any);

      epub.on('error', (error: any) => {
        console.error('EPUB 解析失败:', error);
        const message = error instanceof Error ? error.message : '未知错误';
        reject(new Error(`EPUB 解析失败: ${message}`));
      });

      epub.on('end', async () => {
        try {
          // 提取元数据
          const subject = epub.metadata.subject;
          const estimatedMetadata = {
            title: epub.metadata.title || undefined,
            author: epub.metadata.creator || undefined,
            subject: Array.isArray(subject) ? subject.join(', ') : subject || undefined,
          };

          // 提取章节信息
          const tableOfContents = extractEPUBTableOfContents(epub.flow);

          // 提取所有章节文本
          const content = await extractEPUBContent(epub);

          // EPUB 的 pageCount 用章节数代替
          const pageCount = epub.flow.length;

          resolve({
            content,
            pageCount,
            estimatedMetadata,
            tableOfContents,
          });
        } catch (error) {
          reject(error);
        }
      });

      epub.parse();
    } catch (error) {
      console.error('EPUB 初始化失败:', error);
      const message = error instanceof Error ? error.message : '未知错误';
      reject(new Error(`EPUB 初始化失败: ${message}`));
    }
  });
}

/**
 * 从 EPUB 的 flow 数组中提取章节目录
 */
function extractEPUBTableOfContents(flow: any[]): ChapterNode[] {
  const chapters: ChapterNode[] = [];

  flow.forEach((chapter, index) => {
    if (chapter.title) {
      chapters.push({
        id: chapter.id || `chapter-${index}`,
        title: chapter.title,
        level: 1, // EPUB 的一级章节
        children: [],
      });
    }
  });

  return chapters;
}

/**
 * 提取 EPUB 所有章节的文本内容
 */
async function extractEPUBContent(epub: any): Promise<string> {
  const contentParts: string[] = [];

  for (const chapter of epub.flow) {
    try {
      const chapterText = await getChapterText(epub, chapter.id);
      if (chapterText) {
        contentParts.push(`\n\n=== ${chapter.title} ===\n\n${chapterText}`);
      }
    } catch (error) {
      console.error(`提取章节 ${chapter.id} 失败:`, error);
    }
  }

  return contentParts.join('\n');
}

/**
 * 获取单个章节的文本内容
 */
function getChapterText(epub: any, chapterId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    epub.getChapter(chapterId, (error: Error, text: string) => {
      if (error) {
        reject(error);
      } else {
        // 移除 HTML 标签
        const cleanText = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        resolve(cleanText);
      }
    });
  });
}
