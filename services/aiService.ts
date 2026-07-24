import { StructuredMetaData } from "../types";

/**
 * 统一错误处理
 */
const handleApiError = (error: any) => {
  console.error("API Error Detail:", error);
  throw error;
};

/**
 * 图像分析 - 异步任务模式
 * Why: 豆包深度推理模型单图 OCR 实测 ~200s,同步等待会阻塞 UI 且易超时。
 *      改为提交→拿 taskId→轮询的异步模式,服务端在 setImmediate worker 中调用豆包,
 *      结果存 SQLite,前端轮询直到 success/failed。外部签名保持不变。
 */
export const analyzeImage = async (base64Image: string): Promise<{ text: string; meta: StructuredMetaData }> => {
  try {
    // 1. 提交任务
    const submitResp = await fetch('/api/analyze-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Image })
    });
    if (!submitResp.ok) {
      const errorData = await submitResp.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${submitResp.status}: ${submitResp.statusText}`);
    }
    const submitJson = await submitResp.json();
    if (!submitJson.success || !submitJson.data?.taskId) {
      throw new Error(submitJson.error || '提交识别任务失败');
    }
    const taskId: string = submitJson.data.taskId;

    // 2. 轮询：每 3s 一次，最长 10 分钟（与服务端 600s 硬超时一致）
    const POLL_INTERVAL_MS = 3000;
    const MAX_POLL_MS = 10 * 60 * 1000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < MAX_POLL_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const pollResp = await fetch(`/api/analyze-task/${taskId}`);
      if (!pollResp.ok) {
        // 404 视为任务丢失（重启 + 已清理），直接失败
        if (pollResp.status === 404) throw new Error('识别任务不存在或已过期，请重试。');
        // 5xx/网络抖动：跳过这一轮，下一轮再试
        continue;
      }
      const pollJson = await pollResp.json();
      if (!pollJson.success) continue;
      const { status, result, error } = pollJson.data || {};
      if (status === 'success' && result) {
        return result;
      }
      if (status === 'failed') {
        throw new Error(error || '识别失败');
      }
      // pending / processing → 继续轮询
    }
    throw new Error('识别超时（10 分钟），请重试。');
  } catch (error) {
    return handleApiError(error);
  }
};

/**
 * 生成课件 - 通过 Serverless Function 代理
 */
export const generateCourseware = async (bookTitle: string, chapter: string, studentName: string): Promise<string> => {
  try {
    const response = await fetch('/api/generate-courseware', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ bookTitle, chapter, studentName })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || '课件生成失败');
    }

    return result.data;
  } catch (error) {
    return handleApiError(error);
  }
};

/**
 * 生成试卷 - 通过 Serverless Function 代理
 */
export const generateAssessment = async (request: any, contextItems: string[], studentName: string): Promise<string> => {
  try {
    const response = await fetch('/api/generate-assessment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ request, contextItems, studentName })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || '试卷生成失败');
    }

    return result.data;
  } catch (error) {
    return handleApiError(error);
  }
};
