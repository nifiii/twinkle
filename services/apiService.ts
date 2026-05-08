import { ScannedItem, EBook, IndexStatus } from '../types';

/**
 * API ���务层
 * 封装所有后端 API 调用
 */

// API 基础路径
const API_BASE = '/api';

// 错误处理辅助函数
function handleApiError(response: Response, data: any): never {
  if (!data.success) {
    throw new Error(data.error || '请求失败');
  }
  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}

// ============ 扫描项相关 API ============

/**
 * 保存扫描项到服务器
 * @param scannedItem - 扫描项数据
 * @param originalImagesBase64 - 原始图片的 base64 编码数组
 * @returns 文件路径信息
 */
export async function saveScannedItemToServer(
  scannedItem: ScannedItem,
  originalImagesBase64: string | string[]
): Promise<{ items: any[]; mdPath: string; imagePath: string }> {
  try {
    const response = await fetch(`${API_BASE}/save-scanned-item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scannedItem, originalImagesBase64 }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      handleApiError(response, data);
    }

    return {
      items: data.data.items || [],
      mdPath: data.data.mdPath,
      imagePath: data.data.imagePath,
    };
  } catch (error) {
    console.error('[saveScannedItemToServer] 失败:', error);
    throw error;
  }
}

/**
 * 查询扫描项列表
 * @param filters - 过滤条件
 * @returns 扫描项列表（轻量级，不含完整内容）
 */
export async function fetchScannedItems(filters: {
  ownerId: string;
  subject?: string;
  type?: string;
  limit?: number;
}): Promise<any[]> {
  try {
    const params = new URLSearchParams();
    if (filters.ownerId) params.append('ownerId', filters.ownerId);
    if (filters.subject) params.append('subject', filters.subject);
    if (filters.type) params.append('type', filters.type);
    if (filters.limit) params.append('limit', filters.limit.toString());

    const response = await fetch(`${API_BASE}/scanned-items?${params}`);
    const data = await response.json();

    if (!response.ok || !data.success) {
      handleApiError(response, data);
    }

    return data.data;
  } catch (error) {
    console.error('[fetchScannedItems] 失败:', error);
    throw error;
  }
}

/**
 * 获取单个扫描项详情（包含完整 Markdown 内容）
 * @param id - 扫描项 ID
 * @returns 扫描项详情（含完整内容）
 */
export async function fetchScannedItemById(id: string): Promise<any> {
  try {
    const response = await fetch(`${API_BASE}/scanned-items/${id}`);
    const data = await response.json();

    if (!response.ok || !data.success) {
      handleApiError(response, data);
    }

    return data.data;
  } catch (error) {
    console.error('[fetchScannedItemById] 失败:', error);
    throw error;
  }
}

/**
 * 删除扫描项
 * @param id - 扫描项 ID
 */
export async function deleteScannedItem(id: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/scanned-items/${id}`, {
      method: 'DELETE',
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
      handleApiError(response, data);
    }
  } catch (error) {
    console.error('[deleteScannedItem] 失败:', error);
    throw error;
  }
}

// ============ 教材相关 API ============

/**
 * 保存教材到服务器
 * @param file - 教材文件
 * @param ownerId - 用户 ID
 * @returns 教材信息
 */
export async function saveBookToServer(
  file: File,
  ownerId: string
): Promise<any> {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('ownerId', ownerId);

    const response = await fetch(`${API_BASE}/save-book`, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      handleApiError(response, data);
    }

    return data.data;
  } catch (error) {
    console.error('[saveBookToServer] 失败:', error);
    throw error;
  }
}

/**
 * 查询教材列表
 * @param filters - 过滤条件
 * @returns 教材列表
 */
export async function fetchBooks(filters: {
  ownerId: string;
  subject?: string;
  limit?: number;
}): Promise<EBook[]> {
  try {
    const params = new URLSearchParams();
    if (filters.ownerId) params.append('ownerId', filters.ownerId);
    if (filters.subject) params.append('subject', filters.subject);
    if (filters.limit) params.append('limit', filters.limit.toString());

    const response = await fetch(`${API_BASE}/books?${params}`);
    const data = await response.json();

    if (!response.ok || !data.success) {
      handleApiError(response, data);
    }

    // 转换为 EBook 格式
    return data.data.map((item: any) => ({
      id: item.id,
      title: item.metadata?.title || `${item.subject}教材`,
      author: item.metadata?.author || '',
      fileFormat: 'pdf' as const, // 简化处理
      fileSize: item.fileSize,
      uploadedAt: item.uploadedAt,
      ownerId: item.ownerId,
      filePath: item.filePath,
      mdPath: item.mdPath,
      subject: item.subject,
      category: item.metadata?.category || '教材',
      grade: item.metadata?.grade || '',
      tags: item.metadata?.tags || [],
      tableOfContents: item.metadata?.tableOfContents || [],
      // 映射状态
      indexStatus: item.status === 'processing' ? IndexStatus.INDEXING : 
                  item.status === 'completed' ? IndexStatus.INDEXED : 
                  item.status === 'failed' ? IndexStatus.FAILED : IndexStatus.PENDING,
      anythingLlmDocId: item.anythingLlmDocId,
      coverUrl: item.metadata?.coverImage || undefined,
    }));
  } catch (error) {
    console.error('[fetchBooks] 失败:', error);
    throw error;
  }
}

/**
 * 获取单个教材详情
 * @param id - 教材 ID
 * @returns 教材详情
 */
export async function fetchBookById(id: string): Promise<EBook | null> {
  try {
    const response = await fetch(`${API_BASE}/books/${id}`);
    const data = await response.json();

    if (!response.ok || !data.success) {
      handleApiError(response, data);
    }

    const item = data.data;
    return {
      id: item.id,
      title: item.metadata?.title || `${item.subject}教材`,
      author: item.metadata?.author || '',
      fileFormat: 'pdf' as const,
      fileSize: item.fileSize,
      uploadedAt: item.uploadedAt,
      ownerId: item.ownerId,
      filePath: item.filePath,
      mdPath: item.mdPath,
      subject: item.subject,
      category: item.metadata?.category || '教材',
      grade: item.metadata?.grade || '',
      tags: item.metadata?.tags || [],
      tableOfContents: item.metadata?.tableOfContents || [],
      indexStatus: item.status === 'processing' ? IndexStatus.INDEXING : 
                  item.status === 'completed' ? IndexStatus.INDEXED : 
                  item.status === 'failed' ? IndexStatus.FAILED : IndexStatus.PENDING,
      anythingLlmDocId: item.anythingLlmDocId,
      coverUrl: item.metadata?.coverImage || undefined,
    };
  } catch (error) {
    console.error('[fetchBookById] 失败:', error);
    return null;
  }
}

/**
 * 更新教材元数据(白名单字段:title/author/subject/category/grade/publisher/publishDate/tags/tableOfContents)
 */
export async function updateBook(
  id: string,
  patch: Partial<Pick<EBook, 'title' | 'author' | 'subject' | 'category' | 'grade' | 'tags' | 'tableOfContents'>> & {
    publisher?: string;
    publishDate?: string;
  }
): Promise<{ id: string; updated: string[] }> {
  try {
    const response = await fetch(`${API_BASE}/books/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      handleApiError(response, data);
    }
    return data.data;
  } catch (error) {
    console.error('[updateBook] 失败:', error);
    throw error;
  }
}

/**
 * 删除教材
 * @param id - 教材 ID
 */
export async function deleteBook(id: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/books/${id}`, {
      method: 'DELETE',
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
      handleApiError(response, data);
    }
  } catch (error) {
    console.error('[deleteBook] 失败:', error);
    throw error;
  }
}

// ============ 健康检查 ============

/**
 * 健康检查 API
 */
export async function healthCheck(): Promise<{ status: string; timestamp: number }> {
  try {
    const response = await fetch(`${API_BASE}/health`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('[healthCheck] 失败:', error);
    throw error;
  }
}

/**
 * 检查文件哈希值是否已存在
 * @param hash - 文件哈希值
 * @returns 冲突信息或 null
 */
export async function checkFileHash(hash: string): Promise<any | null> {
  try {
    const response = await fetch(`${API_BASE}/files/check-hash/${hash}`);
    const data = await response.json();
    if (data.success && data.exists) {
      return data.data;
    }
    return null;
  } catch (error) {
    console.error('[checkFileHash] 失败:', error);
    return null; // 查重失败默认允许上传
  }
}

/**
 * 确认上传并保存图书
 * @param metadata - 图书元数据
 * @param tempFilePath - 临时文件路径
 * @param ownerId - 用户 ID
 * @returns 保存结果
 */
export async function confirmBookUpload(
  metadata: any,
  tempFilePath: string,
  ownerId: string
): Promise<any> {
  try {
    const response = await fetch(`${API_BASE}/save-book`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        metadata,
        coverImage: metadata.coverImage,
        tempFilePath,
        ownerId,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      handleApiError(response, data);
    }

    return data.data;
  } catch (error) {
    console.error('[confirmBookUpload] 失败:', error);
    throw error;
  }
}
