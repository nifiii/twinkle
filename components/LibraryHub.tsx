import React, { useState, useEffect, useMemo } from 'react';
import { Library, Search, Filter, Plus } from 'lucide-react';
import { motion } from 'framer-motion';
import { EBook, IndexStatus } from '../types';
import { BookUploader } from './BookUploader';
import { BookMetadataEditor } from './BookMetadataEditor';
import { BookCard } from './BookCard';
import { BookReader } from './BookReader';
import { fetchBooks, deleteBook, updateBook } from '../services/apiService';
import { Button, Card, LoadingSpinner, Input, Skeleton } from './ui';
import { deleteBook as deleteLocalBook } from '../services/bookStorage';

interface LibraryHubProps {
  currentUserId: string;
  /** 嵌入到 ResourcesShell 时，隐藏顶部"📚 图书馆"标题区 */
  hideHeader?: boolean;
  /** 嵌入时回传 viewMode，便于父级在全屏子页（read/upload/edit）下隐藏自己的 TabBar */
  onViewModeChange?: (mode: 'grid' | 'upload' | 'edit' | 'read') => void;
}

type ViewMode = 'grid' | 'upload' | 'edit' | 'read';

const LibraryHub: React.FC<LibraryHubProps> = ({ currentUserId, hideHeader = false, onViewModeChange }) => {
  const [books, setBooks] = useState<EBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedBook, setSelectedBook] = useState<EBook | null>(null);
  const [editingBook, setEditingBook] = useState<Partial<EBook> | null>(null);
  const [pendingUpload, setPendingUpload] = useState<any>(null);

  // 筛选状态
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSubject, setFilterSubject] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterGrade, setFilterGrade] = useState<string>('all');

  // 加载图书列表
  useEffect(() => {
    loadBooks();
  }, [currentUserId]);

  // 嵌入模式：viewMode 变化时通知父级（用于在全屏子页隐藏外层 TabBar）
  useEffect(() => {
    onViewModeChange?.(viewMode);
  }, [viewMode, onViewModeChange]);

  const loadBooks = async () => {
    try {
      setLoading(true);
      // 从服务器加载图书（API 会自动过滤当前用户和共享的）
      const fetchedBooks = await fetchBooks({ ownerId: currentUserId });
      setBooks(fetchedBooks);
    } catch (error) {
      console.error('加载图书失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 处理上传成功
  const handleUploadSuccess = (uploadResult: any) => {
    // 保存上传结果，等待用户编辑元数据
    setPendingUpload(uploadResult);
    const bookDraft: Partial<EBook> = {
      id: `book-${Date.now()}`,
      title: uploadResult.metadata.title,
      author: uploadResult.metadata.author,
      subject: uploadResult.metadata.subject,
      category: uploadResult.metadata.category,
      grade: uploadResult.metadata.grade,
      tags: uploadResult.metadata.tags,
      tableOfContents: uploadResult.metadata.tableOfContents,
      fileFormat: uploadResult.fileFormat,
      fileSize: uploadResult.fileSize,
      uploadedAt: Date.now(),
      ownerId: currentUserId,
      indexStatus: IndexStatus.PENDING,
    };
    setEditingBook(bookDraft);
    setViewMode('edit');
  };

  // 处理元数据确认完成（BookMetadataModal 保存后）
  const handleMetadataConfirmed = async () => {
    // 刷新图书列表
    await loadBooks();
    // 跳转到浏览页面
    setViewMode('grid');
    // 清理编辑状态
    setEditingBook(null);
    setPendingUpload(null);
  };

  // 保存图书元数据
  // - 编辑现有图书(无 pendingUpload):调 PATCH /api/books/:id 落库
  // - 上传后第一次确认元数据(有 pendingUpload):BookUploader 在 /api/save-book 已写库,这里只刷新
  const handleSaveMetadata = async (metadata: Partial<EBook>) => {
    try {
      if (!pendingUpload && metadata.id) {
        await updateBook(metadata.id, {
          title: metadata.title,
          author: metadata.author,
          subject: metadata.subject,
          category: metadata.category,
          grade: metadata.grade,
          publisher: (metadata as any).publisher,
          publishDate: (metadata as any).publishDate,
          tags: metadata.tags,
          tableOfContents: metadata.tableOfContents,
        });
      }
      await loadBooks();

      setPendingUpload(null);
      setEditingBook(null);
      setViewMode('grid');
    } catch (error) {
      console.error('保存图书元数据失败:', error);
      alert('保存失败，请重试');
    }
  };

  // 删除图书
  const handleDeleteBook = async (bookId: string) => {
    if (!confirm('确定要删除这本书吗？\n删除后，该图书的所有索引数据和本地文件都将被永久清除。')) return;

    try {
      // 1. 调用服务端删除 API
      await deleteBook(bookId);
      
      // 2. 如果存在本地存储，也同步清理
      try {
        await deleteLocalBook(bookId);
      } catch (localError) {
        console.warn('清理本地缓存失败:', localError);
      }
      
      // 3. 刷新列表并返回网格视图
      await loadBooks();
      setEditingBook(null);
      setViewMode('grid');
    } catch (error) {
      console.error('删除图书失败:', error);
      alert('删除失败，请重试');
    }
  };

  // 编辑图书
  const handleEditBook = (book: EBook) => {
    setEditingBook(book);
    setViewMode('edit');
  };

  // 选择图书（进入阅读模式）
  const handleSelectBook = (book: EBook) => {
    setSelectedBook(book);
    setViewMode('read');
  };

  // 筛选图书
  const filteredBooks = useMemo(() => {
    return books.filter((book) => {
      // 搜索关键词
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchTitle = book.title.toLowerCase().includes(query);
        const matchAuthor = book.author?.toLowerCase().includes(query);
        const matchTags = book.tags?.some((tag) => tag.toLowerCase().includes(query));
        if (!matchTitle && !matchAuthor && !matchTags) return false;
      }

      // 学科筛选
      if (filterSubject !== 'all' && book.subject !== filterSubject) return false;

      // 类别筛选
      if (filterCategory !== 'all' && book.category !== filterCategory) return false;

      // 年级筛选
      if (filterGrade !== 'all' && book.grade !== filterGrade) return false;

      return true;
    });
  }, [books, searchQuery, filterSubject, filterCategory, filterGrade]);

  // 获取学科列表
  const subjects = useMemo(() => {
    const uniqueSubjects = Array.from(new Set(books.map((b) => b.subject)));
    return uniqueSubjects;
  }, [books]);

  // 获取类别列表
  const categories = useMemo(() => {
    const uniqueCategories = Array.from(new Set(books.map((b) => b.category)));
    return uniqueCategories;
  }, [books]);

  // 渲染网格视图
  const renderGridView = () => (
    <>
      {/* 顶部操作栏 */}
      <Card className="p-4 mb-6">
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4">
          {/* 搜索框 */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-cyber-muted" />
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索书名、作者、标签..."
              className="pl-10"
            />
          </div>

          {/* 筛选器 */}
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-5 h-5 text-cyber-muted" />
            <select
              value={filterSubject}
              onChange={(e) => setFilterSubject(e.target.value)}
              className="px-3 py-2 bg-cyber-bg2/60 border border-cyber-border/60 text-cyber-text rounded-lg text-sm hover:border-neon-blue/60 focus:border-neon-blue focus:outline-none transition-colors"
            >
              <option value="all">全部学科</option>
              {subjects.map((subject) => (
                <option key={subject} value={subject}>
                  {subject}
                </option>
              ))}
            </select>

            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-2 bg-cyber-bg2/60 border border-cyber-border/60 text-cyber-text rounded-lg text-sm hover:border-neon-blue/60 focus:border-neon-blue focus:outline-none transition-colors"
            >
              <option value="all">全部类别</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>

            <select
              value={filterGrade}
              onChange={(e) => setFilterGrade(e.target.value)}
              className="px-3 py-2 bg-cyber-bg2/60 border border-cyber-border/60 text-cyber-text rounded-lg text-sm hover:border-neon-blue/60 focus:border-neon-blue focus:outline-none transition-colors"
            >
              <option value="all">全部年级</option>
              <option value="小学">小学</option>
              <option value="初中">初中</option>
              <option value="高中">高中</option>
            </select>
          </div>

          {/* 上传按钮 */}
          <Button
            variant="primary"
            size="md"
            icon={Plus}
            onClick={() => setViewMode('upload')}
          >
            上传图书
          </Button>
        </div>
      </Card>

      {/* 图书网格 */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {[...Array(8)].map((_, index) => (
            <Card key={index} className="p-0 overflow-hidden">
              <Skeleton variant="rectangular" height={200} className="rounded-t-lg" />
              <div className="p-4 space-y-3">
                <Skeleton variant="text" width="80%" height={24} />
                <Skeleton variant="text" width="60%" />
                <div className="flex gap-2">
                  <Skeleton variant="text" width={60} height={24} />
                  <Skeleton variant="text" width={80} height={24} />
                </div>
                <Skeleton variant="text" width="100%" />
              </div>
            </Card>
          ))}
        </div>
      ) : filteredBooks.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center min-h-[60vh]"
        >
          <div className="relative w-80 h-80 mb-8">
            <div className="absolute inset-0 bg-gradient-to-br from-neon-purple/20 to-neon-blue/20 rounded-3xl blur-2xl" />
            <div className="absolute inset-8 flex items-center justify-center">
              <Library size={120} className="text-neon-purple/60 drop-shadow-[0_0_20px_rgba(109,40,217,0.30)]" />
            </div>
          </div>
          <h2 className="text-2xl font-semibold mb-2 text-cyber-text">图书馆空空如也</h2>
          <p className="text-cyber-muted mb-8">上传第一本书开始学习之旅</p>
          <Button
            variant="primary"
            size="lg"
            icon={Plus}
            onClick={() => setViewMode('upload')}
          >
            上传图书
          </Button>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {filteredBooks.map((book, index) => (
            <motion.div
              key={book.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <BookCard
                book={book}
                onSelect={handleSelectBook}
                onEdit={handleEditBook}
                onDelete={handleDeleteBook}
              />
            </motion.div>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* 标题栏 (仅在非阅读模式 + 非嵌入模式显示) */}
      {!hideHeader && viewMode !== 'read' && (
        <div className="flex items-center gap-3 mb-6">
          <Library className="w-8 h-8 text-neon-blue" />
          <div>
            <h2 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-neon-blue via-cyber-text to-neon-purple bg-clip-text text-transparent">图书馆</h2>
            <p className="text-sm text-cyber-muted">管理您的电子教材和学习资料</p>
          </div>
        </div>
      )}

      {/* 视图切换 */}
      {viewMode === 'grid' && renderGridView()}
      {viewMode === 'read' && selectedBook && (
        <BookReader 
          book={selectedBook} 
          onClose={() => {
            setViewMode('grid');
            setSelectedBook(null);
          }} 
        />
      )}
      {viewMode === 'upload' && (
        <div className="max-w-2xl mx-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setViewMode('grid')}
            className="mb-4"
          >
            {hideHeader ? '← 返回书架' : '← 返回图书馆'}
          </Button>
          <BookUploader
            onUploadSuccess={handleUploadSuccess}
            onMetadataConfirmed={handleMetadataConfirmed}
            ownerId={currentUserId}
          />
        </div>
      )}
      {viewMode === 'edit' && editingBook && (
        <div className="max-w-4xl mx-auto">
          <BookMetadataEditor
            initialMetadata={editingBook}
            onSave={handleSaveMetadata}
            onDelete={handleDeleteBook}
            onCancel={() => {
              setEditingBook(null);
              setPendingUpload(null);
              setViewMode('grid');
            }}
          />
        </div>
      )}
    </div>
  );
};

export default LibraryHub;
