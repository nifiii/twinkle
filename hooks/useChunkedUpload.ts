import { useState, useCallback } from 'react';
import { UploadProgress } from '../types';

export interface ChunkedUploadResult {
  success: boolean;
  filePath?: string;
  metadata?: any;
  error?: string;
  data?: any; // 支持 upload-book 接口返回的 data 结构
}

export interface UseChunkedUploadReturn {
  uploadProgress: UploadProgress | null;
  isUploading: boolean;
  uploadFile: (file: File, ownerId: string, endpoint: string) => Promise<ChunkedUploadResult>;
  resetProgress: () => void;
}

export const useChunkedUpload = (): UseChunkedUploadReturn => {
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const uploadFile = useCallback(async (
    file: File,
    ownerId: string,
    endpoint: string
  ): Promise<ChunkedUploadResult> => {
    setIsUploading(true);
    setUploadProgress({
      loaded: 0,
      total: file.size,
      percentage: 0,
      chunkIndex: 0,
      totalChunks: 1,
    });

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      
      // 监听上传进度
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          setUploadProgress({
            loaded: event.loaded,
            total: event.total,
            percentage: Math.round((event.loaded / event.total) * 100),
            chunkIndex: 0,
            totalChunks: 1,
          });
        }
      };

      // 监听请求完成
      xhr.onload = async () => {
        setIsUploading(false);
        
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            if (response.success) {
              resolve({
                success: true,
                data: response.data, // 返回完整数据
                filePath: response.data?.filePath || '', // 兼容旧代码
                metadata: response.data?.metadata // 兼容旧代码
              });
            } else {
              resolve({
                success: false,
                error: response.error || '上传失败'
              });
            }
          } catch (e) {
            resolve({
              success: false,
              error: '解析响应失败'
            });
          }
        } else {
          resolve({
            success: false,
            error: `HTTP ${xhr.status}: ${xhr.statusText}`
          });
        }
      };

      // 监听错误
      xhr.onerror = () => {
        setIsUploading(false);
        resolve({
          success: false,
          error: '网络错误，上传失败'
        });
      };

      // 发送请求
      const formData = new FormData();
      formData.append('file', file);
      formData.append('ownerId', ownerId);

      xhr.open('POST', endpoint, true);
      xhr.send(formData);
    });
  }, []);

  const resetProgress = useCallback(() => {
    setUploadProgress(null);
  }, []);

  return {
    uploadProgress,
    isUploading,
    uploadFile,
    resetProgress,
  };
};
