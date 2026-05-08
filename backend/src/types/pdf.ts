/**
 * PDF 相关类型定义
 */

export interface PageExtractionResult {
  text: string;
  pageNumber: number;
}

export interface CoverImageResult {
  base64: string;
  format: 'png' | 'jpeg';
}
