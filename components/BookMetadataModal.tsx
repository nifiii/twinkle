import React, { useState } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import ConfidenceBadge from './ui/ConfidenceBadge';
import { EBook } from '../types';

interface BookMetadata {
  title: string;
  author: string;
  subject: string;
  grade: string;
  category: string;
  publisher: string;
  publishDate: string;
  notes?: string;
}

interface FieldConfidence {
  title?: number;
  author?: number;
  subject?: number;
  grade?: number;
  category?: number;
  publisher?: number;
  publishDate?: number;
}

interface ConfidenceData {
  overall: number;
  fields: FieldConfidence;
}

interface BookMetadataModalProps {
  fileName: string;
  initialMetadata: BookMetadata;
  confidence: ConfidenceData;
  isSaving?: boolean;
  onSave: (metadata: BookMetadata) => void;
  onCancel: () => void;
}

export const BookMetadataModal: React.FC<BookMetadataModalProps> = ({
  fileName,
  initialMetadata,
  confidence,
  isSaving = false,
  onSave,
  onCancel
}) => {
  const [metadata, setMetadata] = useState<BookMetadata>(initialMetadata);

  const handleChange = (field: keyof BookMetadata, value: string) => {
    setMetadata(prev => ({ ...prev, [field]: value }));
  };

  const handleAdopt = (field: keyof BookMetadata) => {
    setMetadata(prev => ({ ...prev, [field]: initialMetadata[field] }));
  };

  const handleSave = () => {
    // 验证必填项
    if (!metadata.title?.trim()) {
      alert('请输入书名');
      return;
    }

    onSave(metadata);
  };

  const getFieldConfidenceLevel = (field: keyof BookMetadata) => {
    if (field === 'notes') return 'none';  // notes 字段没有置信度
    const score = confidence.fields[field];
    if (!score) return 'none';
    if (score >= 0.8) return 'high';
    if (score >= 0.5) return 'medium';
    return 'low';
  };

  const getFieldBorderClass = (field: keyof BookMetadata) => {
    const level = getFieldConfidenceLevel(field);
    return {
      high: 'border-gray-300',
      medium: 'border-yellow-400',
      low: 'border-red-400',
      none: 'border-gray-300'
    }[level];
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">确认图书信息</h2>
              <p className="text-sm text-gray-600 mt-1">文件名：{fileName}</p>
            </div>
            <button
              onClick={onCancel}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* 整体置信度 */}
          <div className="mt-4">
            <ConfidenceBadge score={confidence.overall} size="lg" />
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* 左侧：AI 提取结果 */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">AI 提取结果</h3>

              {Object.entries(initialMetadata).map(([key, value]) => {
                if (key === 'notes') return null;

                const fieldKey = key as keyof Exclude<typeof initialMetadata, 'notes'>;
                const fieldLabel = {
                  title: '书名',
                  author: '作者',
                  subject: '学科',
                  grade: '年级',
                  category: '类型',
                  publisher: '出版社',
                  publishDate: '出版时间'
                }[key];

                const fieldScore = confidence.fields[fieldKey as keyof typeof confidence.fields];

                return (
                  <div
                    key={key}
                    className="p-4 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">{fieldLabel}</span>
                      {fieldScore !== undefined && (
                        <ConfidenceBadge score={fieldScore} size="sm" />
                      )}
                    </div>
                    <p className="text-gray-900 font-medium">{value || '(未识别)'}</p>
                  </div>
                );
              })}
            </div>

            {/* 右侧：编辑表单 */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">编辑信息</h3>

              {/* 书名 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  书名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={metadata.title || ''}
                  onChange={(e) => handleChange('title', e.target.value)}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${getFieldBorderClass('title')}`}
                  placeholder="请输入书名"
                />
                {confidence.fields.title !== undefined && confidence.fields.title < 0.8 && (
                  <button
                    onClick={() => handleAdopt('title')}
                    className="mt-1 text-sm text-blue-600 hover:text-blue-800"
                  >
                    采用 AI 结果
                  </button>
                )}
              </div>

              {/* 作者 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">作者</label>
                <input
                  type="text"
                  value={metadata.author || ''}
                  onChange={(e) => handleChange('author', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="请输入作者"
                />
              </div>

              {/* 学科 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">学科</label>
                <select
                  value={metadata.subject || ''}
                  onChange={(e) => handleChange('subject', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">请选择</option>
                  <option value="语文">语文</option>
                  <option value="数学">数学</option>
                  <option value="英语">英语</option>
                  <option value="科学">科学</option>
                  <option value="物理">物理</option>
                  <option value="化学">化学</option>
                  <option value="生物">生物</option>
                  <option value="历史">历史</option>
                  <option value="地理">地理</option>
                  <option value="政治">政治</option>
                  <option value="其他">其他</option>
                </select>
              </div>

              {/* 年级 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">年级</label>
                <input
                  type="text"
                  value={metadata.grade || ''}
                  onChange={(e) => handleChange('grade', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="如：三年级上册"
                />
              </div>

              {/* 类型 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">类型</label>
                <select
                  value={metadata.category || ''}
                  onChange={(e) => handleChange('category', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="教科书">教科书</option>
                  <option value="培训资料">培训资料</option>
                  <option value="工具书">工具书</option>
                  <option value="课外读物">课外读物</option>
                </select>
              </div>

              {/* 出版社 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">出版社</label>
                <input
                  type="text"
                  value={metadata.publisher || ''}
                  onChange={(e) => handleChange('publisher', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="请输入出版社"
                />
              </div>

              {/* 出版时间 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">出版时间</label>
                <input
                  type="text"
                  value={metadata.publishDate || ''}
                  onChange={(e) => handleChange('publishDate', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="如：2023-06"
                />
              </div>

              {/* 备注 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">备注</label>
                <textarea
                  value={metadata.notes || ''}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={3}
                  placeholder="可选填写备注信息"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={`px-6 py-2 rounded-lg text-white transition-colors flex items-center gap-2 ${
              isSaving ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                正在保存...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                保存到图书馆
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BookMetadataModal;
