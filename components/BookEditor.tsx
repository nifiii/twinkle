import React, { useState, useEffect } from 'react';
import { Save, X } from 'lucide-react';

interface BookMetadata {
  title: string;
  author: string;
  subject: string;
  grade: string;
  category: string;
  publisher: string;
  publishDate: string;
  tags: string[];
  coverImage?: string | null;
}

interface BookEditorProps {
  metadata: BookMetadata;
  onSave: (updatedMetadata: BookMetadata) => void;
  onCancel: () => void;
  userName?: string;  // 用户名，用于添加默认标签
}

const SUBJECT_OPTIONS = [
  '语文', '数学', '英语', '物理', '化学', '生物', '科学', '历史', '地理', '政治', '其他'
];

const GRADE_OPTIONS = [
  '一年级上', '一年级下', '二年级上', '二年级下',
  '三年级上', '三年级下', '四年级上', '四年级下',
  '五年级上', '五年级下', '六年级上', '六年级下',
  '七年级上', '七年级下', '八年级上', '八年级下',
  '九年级上', '九年级下',
  '高一上', '高一下', '高二上', '高二下', '高三上', '高三下',
  ''
];

const CATEGORY_OPTIONS = [
  { value: '教科书', label: '教科书' },
  { value: '培训资料', label: '培训资料' },
  { value: '工具书', label: '工具书' },
  { value: '课外读物', label: '课外读物' }
];

export const BookEditor: React.FC<BookEditorProps> = ({
  metadata,
  onSave,
  onCancel,
  userName
}) => {
  const [formData, setFormData] = useState<BookMetadata>({
    title: metadata.title || '',
    author: metadata.author || '',
    subject: metadata.subject || '其他',
    grade: metadata.grade || '',
    category: metadata.category || '教科书',
    publisher: metadata.publisher || '',
    publishDate: metadata.publishDate || '',
    tags: metadata.tags || [],
    coverImage: metadata.coverImage || null,
  });
  const [tagInput, setTagInput] = useState('');

  // 初始化时添加用户名作为默认标签
  useEffect(() => {
    if (formData.tags.length === 0 && userName) {
      setFormData(prev => ({
        ...prev,
        tags: [userName]
      }));
    }
  }, [userName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  const addTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData({
        ...formData,
        tags: [...formData.tags, tagInput.trim()]
      });
      setTagInput('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setFormData({
      ...formData,
      tags: formData.tags.filter(tag => tag !== tagToRemove)
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h3 className="text-xl font-bold text-gray-800 mb-4">编辑图书信息</h3>

          {/* 封面预览 */}
          {formData.coverImage && (
            <div className="mb-4 p-4 bg-gray-50 rounded-lg flex justify-center">
              <img
                src={`data:image/png;base64,${formData.coverImage}`}
                alt="封面预览"
                className="max-w-xs rounded shadow"
              />
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 书名 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                书名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="请输入书名"
                required
              />
            </div>

            {/* 作者 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">作者</label>
              <input
                type="text"
                value={formData.author}
                onChange={(e) => setFormData({ ...formData, author: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="请输入作者"
              />
            </div>

            {/* 学科 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">学科</label>
              <select
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {SUBJECT_OPTIONS.map(subject => (
                  <option key={subject} value={subject}>{subject}</option>
                ))}
              </select>
            </div>

            {/* 年级 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">年级</label>
              <select
                value={formData.grade}
                onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {GRADE_OPTIONS.map(grade => (
                  <option key={grade} value={grade}>{grade || '未指定'}</option>
                ))}
              </select>
            </div>

            {/* 类型 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {CATEGORY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* 出版社 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">出版社</label>
              <input
                type="text"
                value={formData.publisher}
                onChange={(e) => setFormData({ ...formData, publisher: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="请输入出版社"
              />
            </div>

            {/* 出版时间 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">出版时间</label>
              <input
                type="month"
                value={formData.publishDate}
                onChange={(e) => setFormData({ ...formData, publishDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* 标签 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">标签</label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="输入标签后按回车"
                />
                <button
                  type="button"
                  onClick={addTag}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  添加
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.tags.map(tag => (
                  <span
                    key={tag}
                    className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm flex items-center gap-1"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                取消
              </button>
              <button
                type="submit"
                disabled={!formData.title}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                保存
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default BookEditor;
