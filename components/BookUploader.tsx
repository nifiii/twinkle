import React, { useState } from 'react';
import { Upload, FileText, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { EBook, IndexStatus } from '../types';
import { useChunkedUpload, ChunkedUploadResult } from '../hooks/useChunkedUpload';
import UploadProgressBar from './UploadProgressBar';
import { checkFileHash } from '../services/apiService';
import { calculateFileHash } from '../utils/hashUtils';

interface UploadResult {
  fileName: string;
  fileFormat: 'pdf' | 'epub' | 'txt';
  fileSize: number;
  pageCount: number;
  content: string;
  metadata: {
    title: string;
    author?: string;
    subject: string;
    category: string;
    grade: string;
    tags: string[];
    tableOfContents: any[];
    notes?: string;
  };
  confidence?: {
    overall: number;
    fields: {
      title?: number;
      author?: number;
      subject?: number;
      grade?: number;
      category?: number;
      publisher?: number;
      publishDate?: number;
    };
  };
  extractionMethod?: string;
}

// 扩展 ChunkedUploadResult 以支持置信度
interface ExtendedChunkedUploadResult extends Omit<ChunkedUploadResult, 'metadata'> {
  tempFilePath?: string; // 添加临时文件路径字段
  fileHash?: string; // 添加文件哈希字段
  metadata?: {
    title: string;
    author?: string;
    subject: string;
    category: string;
    grade: string;
    tags: string[];
    tableOfContents?: any[];
    notes?: string;
    fileName?: string;
    fileFormat?: 'pdf' | 'epub' | 'txt';
    fileSize?: number;
    pageCount?: number;
    publisher?: string;
    publishDate?: string;
  };
  confidence?: {
    overall: number;
    fields: {
      title?: number;
      author?: number;
      subject?: number;
      grade?: number;
      category?: number;
      publisher?: number;
      publishDate?: number;
    };
  };
  extractionMethod?: string;
}

interface BookUploaderProps {
  onUploadSuccess: (uploadResult: UploadResult) => void;
  onMetadataConfirmed: () => void;
  ownerId: string;
}

export const BookUploader: React.FC<BookUploaderProps> = ({ onUploadSuccess, onMetadataConfirmed, ownerId }) => {
  const { uploadProgress, isUploading, uploadFile, resetProgress } = useChunkedUpload();
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<ExtendedChunkedUploadResult | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [processingStage, setProcessingStage] = useState('');

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    const allowedTypes = ['application/pdf', 'application/epub+zip', 'text/plain'];
    if (!allowedTypes.includes(file.type)) {
      setError('仅支持 PDF、EPUB、TXT 格式');
      return;
    }

    // 验证文件大小 (200MB)
    const maxSize = 200 * 1024 * 1024;
    if (file.size > maxSize) {
      setError('文件大小不能超过 200MB');
      return;
    }

    setSelectedFile(file);
    setError('');
    setSuccess(false);

    // 计算哈希并查重
    let fileHash = '';
    try {
      fileHash = await calculateFileHash(file);
      const duplicate = await checkFileHash(fileHash);
      
      if (duplicate) {
        const uploadDate = new Date(duplicate.timestamp).toLocaleDateString();
        setError(`该文件已存在：${duplicate.title} (上传于 ${uploadDate})`);
        setSelectedFile(null);
        return;
      }
      
      // 保存哈希值供后续使用
      setUploadResult(prev => ({ ...prev, fileHash } as any));
    } catch (err) {
      console.error('哈希计算失败:', err);
      // 失败不中断流程
    }

    console.log('📤 开始上传图书，端点: /api/upload-book (全量流式)');
    // 使用单文件流式上传 (已改为磁盘存储，不会超时)
    const result = await uploadFile(file, ownerId, '/api/upload-book', fileHash ? { fileHash } : undefined);

    if (result.success && result.data) {
      try {
        setIsParsing(true);
        setProcessingStage('已上传，正在排队...');
        setError('');
        const taskId = result.data.taskId;
        if (!taskId) throw new Error('图书任务未创建');
        const startedAt = Date.now();
        while (Date.now() - startedAt < 15 * 60 * 1000) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const response = await fetch(`/api/upload-book/task/${taskId}?ownerId=${encodeURIComponent(ownerId)}`);
          if (!response.ok) continue;
          const task = (await response.json()).data;
          if (task.status === 'queued') {
            setProcessingStage(`正在排队，当前第 ${task.queuePosition || 1} 位...`);
            continue;
          }
          if (task.status === 'running') {
            setProcessingStage(`正在${task.stage === 'render_pages' ? '转图' : task.stage === 'markdown' ? '生成 Markdown' : '解析图书'}...`);
            continue;
          }
          if (task.status === 'failed') throw new Error(task.error || '图书解析失败');
          if (task.status === 'completed') break;
        }
        if (Date.now() - startedAt >= 15 * 60 * 1000) throw new Error('图书解析超时，请稍后在书架查看结果');
        setSuccess(true);
        onMetadataConfirmed();
        setSelectedFile(null);
        setUploadResult(null);
        resetProgress();
      } catch (err: any) {
        console.error('书籍任务失败:', err);
        setError(`上传成功，但图书解析失败: ${err.message}`);
      } finally {
        setIsParsing(false);
        setProcessingStage('');
      }
    } else {
      setError(result.error || '上传失败，请检查网络连接');
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center gap-3 mb-4">
        <FileText className="w-6 h-6 text-blue-600" />
        <h3 className="text-lg font-semibold text-gray-800">上传电子书</h3>
      </div>

      <div className="space-y-4">
        {/* 文件选择区域 */}
        <label
          htmlFor="book-upload"
          className={`
            flex flex-col items-center justify-center
            border-2 border-dashed rounded-lg p-8
            cursor-pointer transition-all
            ${isUploading ? 'border-gray-300 bg-gray-50 cursor-not-allowed' : 'border-blue-300 bg-blue-50 hover:bg-blue-100'}
          `}
        >
          <Upload className={`w-12 h-12 mb-3 ${isUploading || isParsing ? 'text-gray-400 animate-pulse' : 'text-blue-600'}`} />
          <p className="text-sm text-gray-700 font-medium">
            {isParsing ? processingStage || '正在解析图书...' : (isUploading ? '正在上传中...' : '点击选择文件或拖拽到此处')}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {isParsing ? '任务将在完成后自动出现在书架，可再编辑元数据' : '支持 PDF、EPUB、TXT 格式，最大 200MB'}
          </p>
          <input
            id="book-upload"
            type="file"
            accept=".pdf,.epub,.txt"
            onChange={handleFileChange}
            disabled={isUploading || isParsing}
            className="hidden"
          />
        </label>

        {/* 上传解析进度 */}
        {uploadProgress && (
          <div className="space-y-2">
            <UploadProgressBar
              progress={uploadProgress}
              fileName={selectedFile?.name || ''}
            />
            {isParsing && (
              <div className="flex items-center gap-2 text-sm text-blue-600 animate-pulse">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{processingStage || '文件上传完成，正在解析图书...'}</span>
              </div>
            )}
          </div>
        )}

        {/* 成功提示 - 移除，直接显示编辑器 */}

        {/* 错误提示 */}
        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-50 rounded-lg border border-red-200">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <span className="text-sm text-red-800">{error}</span>
          </div>
        )}

        {/* 使用说明 */}
        <div className="text-xs text-gray-500 space-y-1 mt-6">
          <p className="font-medium text-gray-700">上传说明：</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>系统将自动提取书籍元数据（书名、作者、学科等）</li>
            <li>AI 会智能识别章节目录结构</li>
            <li>您可以在上传后手动编辑所有信息</li>
            <li>书籍内容将保存在本地，不会上传到服务器</li>
          </ul>
        </div>
      </div>

    </div>
  );
};
