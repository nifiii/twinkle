import React, { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Book, Search, CheckCircle } from 'lucide-react';
import { EBook, ChapterNode } from '../types';

interface ChapterSelectorProps {
  books: EBook[];
  onConfirm: (book: EBook, chapters: ChapterNode[]) => void;
  preselectedBookId?: string;
  maxChapters?: number;
}

export const ChapterSelector: React.FC<ChapterSelectorProps> = ({
  books,
  onConfirm,
  preselectedBookId,
  maxChapters = 3,
}) => {
  const [selectedBookId, setSelectedBookId] = useState<string>(preselectedBookId || '');
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChapters, setSelectedChapters] = useState<ChapterNode[]>([]);

  const selectedBook = useMemo(() => {
    return books.find((b) => b.id === selectedBookId);
  }, [books, selectedBookId]);

  // 搜索过滤图书
  const filteredBooks = useMemo(() => {
    if (!searchQuery) return books;
    const query = searchQuery.toLowerCase();
    return books.filter(
      (book) =>
        book.title.toLowerCase().includes(query) ||
        book.subject.toLowerCase().includes(query) ||
        book.tags?.some((tag) => tag.toLowerCase().includes(query))
    );
  }, [books, searchQuery]);

  // 切换章节展开状态
  const toggleChapter = (chapterId: string) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) {
        next.delete(chapterId);
      } else {
        next.add(chapterId);
      }
      return next;
    });
  };

  const isSingle = maxChapters === 1;

  // 切换章节勾选（仅叶子节点）
  const toggleChapterSelection = (chapter: ChapterNode) => {
    setSelectedChapters(prev => {
      const exists = prev.find(c => c.id === chapter.id);
      if (exists) return prev.filter(c => c.id !== chapter.id);
      if (isSingle) return [chapter]; // 单选：替换
      if (prev.length >= maxChapters) return prev;
      return [...prev, chapter];
    });
  };

  // 切换图书时清空已选章节
  const handleBookChange = (id: string) => {
    setSelectedBookId(id);
    setSelectedChapters([]);
  };

  // 渲染章节树节点
  const renderChapterNode = (chapter: ChapterNode, depth: number = 0) => {
    const hasChildren = chapter.children && chapter.children.length > 0;
    const isExpanded = expandedChapters.has(chapter.id);
    const indent = depth * 24;
    const isChecked = !!selectedChapters.find(c => c.id === chapter.id);

    return (
      <div key={chapter.id} className="select-none">
        <div
          className={`flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer transition-colors group ${
            isChecked ? 'bg-blue-100' : 'hover:bg-blue-50'
          }`}
          style={{ paddingLeft: `${indent + 12}px` }}
          onClick={() => {
            if (hasChildren) {
              toggleChapter(chapter.id);
            } else {
              toggleChapterSelection(chapter);
            }
          }}
        >
          {/* 展开/折叠图标 */}
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleChapter(chapter.id);
              }}
              className="flex-shrink-0"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-gray-600" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-600" />
              )}
            </button>
          ) : (
            <div className="w-4 h-4 flex-shrink-0" />
          )}

          {/* 章节标题 */}
          <span
            className={`flex-1 text-sm ${
              hasChildren ? 'font-semibold text-gray-800' : 'text-gray-700'
            } group-hover:text-blue-600 transition-colors`}
          >
            {chapter.title}
          </span>

          {/* 页码范围 */}
          {chapter.pageRange && (
            <span className="text-xs text-gray-500 flex-shrink-0">
              p.{chapter.pageRange.start}-{chapter.pageRange.end}
            </span>
          )}

          {/* 选择控件（叶子节点）：单选用 radio，多选用 checkbox */}
          {!hasChildren && (
            <input
              type={isSingle ? 'radio' : 'checkbox'}
              name={isSingle ? 'chapter-radio' : undefined}
              checked={isChecked}
              onChange={() => toggleChapterSelection(chapter)}
              onClick={(e) => e.stopPropagation()}
              className="flex-shrink-0 w-4 h-4 accent-blue-600 cursor-pointer"
            />
          )}
        </div>

        {/* 子章节 */}
        {hasChildren && isExpanded && (
          <div className="ml-4">
            {chapter.children.map((child) => renderChapterNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-2 gap-6 h-[600px]">
      {/* 左侧：图书列表 */}
      <div className="border border-gray-200 rounded-lg overflow-hidden flex flex-col bg-white">
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Book className="w-5 h-5 text-blue-600" />
            选择教材
          </h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索教材..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {filteredBooks.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              {searchQuery ? '未找到匹配的教材' : '暂无教材，请先上传'}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredBooks.map((book) => (
                <button
                  key={book.id}
                  onClick={() => handleBookChange(book.id)}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    selectedBookId === book.id
                      ? 'bg-blue-100 border-2 border-blue-500'
                      : 'bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {selectedBookId === book.id && (
                      <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-gray-800 text-sm line-clamp-2 mb-1">
                        {book.title}
                      </h4>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="px-2 py-0.5 bg-gray-100 rounded">
                          {book.subject}
                        </span>
                        <span className="px-2 py-0.5 bg-gray-100 rounded">
                          {book.grade}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右侧：章节目录 */}
      <div className="border border-gray-200 rounded-lg overflow-hidden flex flex-col bg-white">
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <ChevronRight className="w-5 h-5 text-blue-600" />
              选择章节
            </h3>
            <span className="text-xs text-gray-500">
              {isSingle ? (
                <>已选 <span className="font-bold text-blue-600">{selectedChapters.length > 0 ? '1' : '0'}</span> / 1</>
              ) : (
                <>已选 <span className="font-bold text-blue-600">{selectedChapters.length}</span> / {maxChapters}</>
              )}
            </span>
          </div>
          {selectedBook && (
            <p className="text-sm text-gray-600 mt-1">
              《{selectedBook.title}》- 共 {selectedBook.tableOfContents.length} 章 · {isSingle ? '请选择 1 个章节' : `可勾选 1–${maxChapters} 个章节`}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {!selectedBook ? (
            <div className="text-center py-12 text-gray-500 text-sm">
              <ChevronRight className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p>请先在左侧选择一本教材</p>
            </div>
          ) : selectedBook.tableOfContents.length === 0 ? (
            <div className="text-center py-12 text-gray-500 text-sm">
              <p>该教材暂无章节目录</p>
              <p className="text-xs text-gray-400 mt-2">
                可能是 AI 提取失败，请尝试重新上传
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {selectedBook.tableOfContents.map((chapter) => renderChapterNode(chapter))}
            </div>
          )}
        </div>

        {/* 底部确认栏 */}
        {selectedBook && (
          <div className="p-3 border-t border-gray-200 bg-gray-50 flex items-center gap-3">
            <div className="flex-1 text-xs text-gray-600 truncate">
              {selectedChapters.length > 0
                ? `已选：${selectedChapters.map(c => c.title).join('、')}`
                : isSingle ? '请选择 1 个章节' : `请勾选 1–${maxChapters} 个章节`}
            </div>
            <button
              onClick={() => selectedChapters.length > 0 && onConfirm(selectedBook, selectedChapters)}
              disabled={selectedChapters.length === 0}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              确认选择
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
