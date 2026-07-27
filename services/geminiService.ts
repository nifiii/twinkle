import { StructuredMetaData } from "../types";

/**
 * 统一错误处理
 */
const handleApiError = (error: any) => {
  console.error("API Error Detail:", error);
  throw error;
};

/**
 * 根据已等待时间返回下一次轮询间隔（毫秒）。
 * Why: 固定 3s 轮询在 200s 内产生 ~66 次无效请求。
 *      分段动态间隔在等待前期保持快速响应，等待后期减少无效负载。
 */
function getPollingInterval(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 2000;   // 前 30s: 2s（快速响应期）
  if (elapsedMs < 120_000) return 4000;  // 30s-2min: 4s（正常等待期）
  return 6000;                           // 2min+: 6s（减少无效请求）
}

/**
 * 图像分析 - 异步任务模式（完整 OCR + 结构化）
 * Why: 豆包深度推理模型单图 OCR 实测 ~200s，同步等待会阻塞 UI 且易超时。
 *      改为提交→拿 taskId→轮询的异步模式。
 *      onProgress 回调在关键阶段推送文案，让用户感知到进度而非盯着旋转圈。
 */
export const analyzeImage = async (
  base64Image: string,
  onProgress?: (stage: string) => void,
  ownerId?: string,
): Promise<{ text: string; meta: StructuredMetaData }> => {
  try {
    // 1. 提交任务
    onProgress?.("正在提交识别任务...");
    const submitResp = await fetch('/api/analyze-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Image, ownerId })
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

    onProgress?.("已提交，等待 AI 开始处理...");

    // 2. 动态间隔轮询，最长 10 分钟（与服务端 600s 硬超时一致）
    const MAX_POLL_MS = 10 * 60 * 1000;
    const startedAt = Date.now();
    let progressUpdated30 = false;
    let progressUpdated60 = false;

    while (Date.now() - startedAt < MAX_POLL_MS) {
      const elapsed = Date.now() - startedAt;
      const interval = getPollingInterval(elapsed);
      await new Promise((r) => setTimeout(r, interval));

      // 阶段性进度文案
      const nowElapsed = Date.now() - startedAt;
      if (nowElapsed >= 30_000 && !progressUpdated30) {
        onProgress?.("AI 正在深度分析试卷...");
        progressUpdated30 = true;
      }
      if (nowElapsed >= 60_000 && !progressUpdated60) {
        onProgress?.("正在识别手写内容与批改痕迹...");
        progressUpdated60 = true;
      }

      const jobResp = await fetch(`/api/jobs/${taskId}?ownerId=${encodeURIComponent(ownerId || 'shared')}`);
      if (jobResp.ok) {
        const jobJson = await jobResp.json();
        const job = jobJson.data;
        if (job?.status === 'queued') onProgress?.(`正在排队，当前第 ${job.queuePosition || 1} 位...`);
        if (job?.status === 'running') onProgress?.('AI 正在识别试卷...');
        if (job?.status === 'failed') throw new Error('识别失败，请重试。');
      }

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
        onProgress?.("识别完成！");
        return result;
      }
      if (status === 'failed') {
        throw new Error(error || '识别失败');
      }
      if (status === 'processing' && !progressUpdated30) {
        onProgress?.("AI 正在深度分析试卷...");
      }
      // pending / processing → 继续轮询
    }
    throw new Error('识别超时（10 分钟），请重试。');
  } catch (error) {
    return handleApiError(error);
  }
};

/**
 * Step 1: 快速 OCR — 仅转录文本为 Markdown，不做结构化分析。
 * Why: 将一步走（60-200s）拆为两步走。
 *      Step 1 使用简化 Prompt，仅做文字转录，速度快（预期 10-30s）。
 *      Step 2 用文本模型分析转录结果，期间用户可审核/编辑 OCR 内容。
 */
export const analyzeImageOcr = async (
  base64Image: string,
  onProgress?: (stage: string) => void
): Promise<{ markdown: string }> => {
  try {
    onProgress?.("正在提交 OCR 任务...");
    const submitResp = await fetch('/api/analyze-image-ocr', {
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
      throw new Error(submitJson.error || '提交 OCR 任务失败');
    }
    const taskId: string = submitJson.data.taskId;

    onProgress?.("AI 正在快速识别图片文字...");

    // 轮询，最长 5 分钟（OCR-only 比全量分析快很多）
    const MAX_POLL_MS = 5 * 60 * 1000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < MAX_POLL_MS) {
      const elapsed = Date.now() - startedAt;
      const interval = getPollingInterval(elapsed);
      await new Promise((r) => setTimeout(r, interval));

      if (Date.now() - startedAt >= 30_000) {
        onProgress?.("正在识别手写内容...");
      }

      const pollResp = await fetch(`/api/analyze-task-ocr/${taskId}`);
      if (!pollResp.ok) {
        if (pollResp.status === 404) throw new Error('OCR 任务不存在或已过期，请重试。');
        continue;
      }
      const pollJson = await pollResp.json();
      if (!pollJson.success) continue;
      const { status, result, error } = pollJson.data || {};
      if (status === 'success' && result) {
        onProgress?.("文字识别完成，请核对内容");
        return result;
      }
      if (status === 'failed') {
        throw new Error(error || 'OCR 识别失败');
      }
    }
    throw new Error('OCR 超时（5 分钟），请重试。');
  } catch (error) {
    return handleApiError(error);
  }
};

/**
 * Step 2: 文本模型分析 Markdown → 提取结构化 problems[]
 * Why: 用户审核 OCR 文本后，将确认后的 markdown 发给纯文本模型做结构化分析。
 *      文本模型无图片输入，处理速度通常 5-15s，可同步返回。
 */
export const analyzeMarkdown = async (
  markdown: string
): Promise<{ text: string; meta: StructuredMetaData }> => {
  try {
    const resp = await fetch('/api/analyze-markdown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown })
    });
    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${resp.status}: ${resp.statusText}`);
    }
    const json = await resp.json();
    if (!json.success) throw new Error(json.error || '分析失败');
    return json.data;
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
