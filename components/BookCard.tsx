import React from 'react';
import { BookOpen, User, Tag, GraduationCap, FileText, Trash2, Edit, CheckCircle, Clock, AlertCircle, Sparkle } from 'lucide-react';
import { EBook, IndexStatus } from '../types';

interface BookCardProps {
  book: EBook;
  onSelect: (book: EBook) => void;
  onEdit: (book: EBook) => void;
  onDelete: (bookId: string) => void;
}

export const BookCard: React.FC<BookCardProps> = ({ book, onSelect, onEdit, onDelete }) => {
  // 获取索引状态图标和文本
  const getIndexStatusInfo = (status: IndexStatus) => {
    switch (status) {
      case IndexStatus.INDEXED:
        return {
          icon: <CheckCircle className="w-4 h-4 text-green-600" />,
          text: '已索引',
          color: 'text-green-600',
        };
      case IndexStatus.INDEXING:
        return {
          icon: <Clock className="w-4 h-4 text-blue-600 animate-spin" />,
          text: '索引中',
          color: 'text-blue-600',
        };
      case IndexStatus.FAILED:
        return {
          icon: <AlertCircle className="w-4 h-4 text-red-600" />,
          text: '索引失败',
          color: 'text-red-600',
        };
      default:
        return {
          icon: <Clock className="w-4 h-4 text-gray-400" />,
          text: '待索引',
          color: 'text-gray-400',
        };
    }
  };

  const statusInfo = getIndexStatusInfo(book.indexStatus);

  // 格式化文件大小
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // 格式化日期
  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString('zh-CN');
  };

  return (
    <div
      className="bg-cyber-surface/60 backdrop-blur-md rounded-2xl border border-cyber-border/60 hover:border-neon-blue/60 hover:shadow-glow-sm hover:scale-[1.01] transition-all duration-300 overflow-hidden group cursor-pointer"
      onClick={() => onSelect(book)}
    >
      {/* 封面区域 */}
      <div className="relative h-48 bg-gradient-to-br from-neon-blue/40 via-sky-500/40 to-neon-purple/40 flex items-center justify-center">
        {book.coverUrl ? (
          <img
            src={book.coverUrl}
            alt={book.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <BookOpen className="w-16 h-16 text-white opacity-80" />
        )}

        {/* AI 提取标识 */}
        {book.aiConfidence !== undefined && book.extractionMethod === 'gemini' && (
          <div className="absolute top-2 left-2 bg-gradient-to-r from-purple-500 to-indigo-500 text-white px-2 py-1 rounded-full text-xs flex items-center gap-1 shadow-sm">
            <Sparkle className="w-3 h-3" />
            AI 提取
          </div>
        )}

        {/* 索引状态标签 */}
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 bg-cyber-surface/80 backdrop-blur-sm border border-cyber-border/60 rounded-full shadow-sm">
          {statusInfo.icon}
          <span className={`text-xs font-medium ${statusInfo.color}`}>
            {statusInfo.text}
          </span>
        </div>

        {/* 文件格式标签 */}
        <div className="absolute top-2 left-2 px-2 py-1 bg-white/80 backdrop-blur-sm border border-neon-blue/40 text-neon-blue text-xs font-medium rounded uppercase">
          {book.fileFormat}
        </div>

        {/* 操作按钮（悬停显示）—— 浅色 hover 蒙层 */}
        <div className="absolute inset-0 bg-white/0 group-hover:bg-white/30 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(book);
            }}
            className="p-2 bg-cyber-surface/80 backdrop-blur-md border border-neon-blue/40 rounded-full hover:bg-neon-blue/20 hover:shadow-glow-sm transition-all"
            title="修改图书信息"
          >
            <Edit className="w-5 h-5 text-neon-blue" />
          </button>
        </div>
      </div>

      {/* 信息区域 */}
      <div className="p-4 space-y-3">
        {/* 书名 */}
        <h4 className="font-semibold text-cyber-text line-clamp-2 min-h-[3rem]">
          {book.title}
        </h4>

        {/* 作者 */}
        {book.author && (
          <div className="flex items-center gap-2 text-sm text-cyber-muted">
            <User className="w-4 h-4" />
            <span className="line-clamp-1">{book.author}</span>
          </div>
        )}

        {/* 学科、类别、年级 */}
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-1 bg-neon-blue/15 text-neon-blue border border-neon-blue/30 rounded">
            {book.subject}
          </span>
          <span className="px-2 py-1 bg-neon-purple/15 text-neon-purple border border-neon-purple/30 rounded">
            {book.category}
          </span>
          <span className="flex items-center gap-1 px-2 py-1 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded">
            <GraduationCap className="w-3 h-3" />
            {book.grade}
          </span>
        </div>

        {/* 标签 */}
        {book.tags && book.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {book.tags.slice(0, 3).map((tag, index) => (
              <span
                key={index}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/5 text-cyber-muted border border-cyber-border/40 rounded-full text-xs"
              >
                <Tag className="w-3 h-3" />
                {tag}
              </span>
            ))}
            {book.tags.length > 3 && (
              <span className="px-2 py-0.5 text-cyber-muted text-xs">
                +{book.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* 文件信息 */}
        <div className="pt-3 border-t border-cyber-border/40 flex items-center justify-between text-xs text-cyber-muted">
          <span className="flex items-center gap-1">
            <FileText className="w-3 h-3" />
            {formatFileSize(book.fileSize)}
          </span>
          <span>{formatDate(book.uploadedAt)}</span>
        </div>
      </div>
    </div>
  );
};
