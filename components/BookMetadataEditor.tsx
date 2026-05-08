import React, { useState } from 'react';
import { Save, X, Tag, BookOpen, User, GraduationCap, Trash2 } from 'lucide-react';
import { EBook, ChapterNode } from '../types';

interface BookMetadataEditorProps {
  initialMetadata: Partial<EBook>;
  onSave: (metadata: Partial<EBook>) => void;
  onCancel: () => void;
  onDelete?: (bookId: string) => void;
}

export const BookMetadataEditor: React.FC<BookMetadataEditorProps> = ({
  initialMetadata,
  onSave,
  onCancel,
  onDelete,
}) => {
  const [metadata, setMetadata] = useState<Partial<EBook>>(initialMetadata);
  const [newTag, setNewTag] = useState('');

  const handleChange = (field: keyof EBook, value: any) => {
    setMetadata((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddTag = () => {
    if (newTag.trim()) {
      const currentTags = metadata.tags || [];
      handleChange('tags', [...currentTags, newTag.trim()]);
      setNewTag('');
    }
  };

  const handleRemoveTag = (index: number) => {
    const currentTags = metadata.tags || [];
    handleChange('tags', currentTags.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    onSave(metadata);
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-gray-800">编辑图书信息</h3>
        <button
          onClick={onCancel}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-6">
        {/* 基本信息 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <BookOpen className="w-4 h-4 inline mr-1" />
              书名 *
            </label>
            <input
              type="text"
              value={metadata.title || ''}
              onChange={(e) => handleChange('title', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="请输入书名"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <User className="w-4 h-4 inline mr-1" />
              作者
            </label>
            <input
              type="text"
              value={metadata.author || ''}
              onChange={(e) => handleChange('author', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="请输入作者"
            />
          </div>
        </div>

        {/* 分类信息 */}
        <div className="grid grid-cols-3 gap-4">
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">类别</label>
            <select
              value={metadata.category || ''}
              onChange={(e) => handleChange('category', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">请选择</option>
              <option value="教材">教材</option>
              <option value="教辅">教辅</option>
              <option value="竞赛资料">竞赛资料</option>
              <option value="考试真题">考试真题</option>
              <option value="课外读物">课外读物</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <GraduationCap className="w-4 h-4 inline mr-1" />
              年级段
            </label>
            <select
              value={metadata.grade || ''}
              onChange={(e) => handleChange('grade', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">请选择</option>
              <option value="小学">小学</option>
              <option value="初中">初中</option>
              <option value="高中">高中</option>
              <option value="大学">大学</option>
              <option value="其他">其他</option>
            </select>
          </div>
        </div>

        {/* 标签 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            <Tag className="w-4 h-4 inline mr-1" />
            标签
          </label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="输入标签后按回车添加"
            />
            <button
              onClick={handleAddTag}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              添加
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(metadata.tags || []).map((tag, index) => (
              <span
                key={index}
                className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm"
              >
                {tag}
                <button
                  onClick={() => handleRemoveTag(index)}
                  className="hover:text-blue-900"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* 章节目录预览 */}
        {metadata.tableOfContents && metadata.tableOfContents.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              章节目录（共 {metadata.tableOfContents.length} 章）
            </label>
            <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-4 bg-gray-50">
              {metadata.tableOfContents.map((chapter, index) => (
                <div
                  key={index}
                  className="py-1 text-sm text-gray-700"
                  style={{ paddingLeft: `${(chapter.level - 1) * 16}px` }}
                >
                  {chapter.title}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center justify-between pt-6 border-t border-gray-200 mt-8">
          <div className="flex gap-3 flex-1">
            <button
              onClick={handleSave}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-sm"
            >
              <Save className="w-5 h-5" />
              保存修改
            </button>
            <button
              onClick={onCancel}
              className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            >
              取消
            </button>
          </div>

          {onDelete && metadata.id && (
            <button
              onClick={() => onDelete(metadata.id!)}
              className="ml-8 flex items-center gap-2 px-4 py-3 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-all text-sm font-medium border border-transparent hover:border-red-100"
              title="永久删除此图书"
            >
              <Trash2 className="w-4 h-4" />
              删除图书
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
