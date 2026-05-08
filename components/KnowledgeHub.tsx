
import React, { useState, useMemo, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { ScannedItem, UserProfile, DocType, KnowledgeStatus, ProblemStatus, ProcessingStatus } from '../types';
import { Card, Badge, Button, LoadingSpinner } from './ui';
import { Calendar, BookOpen, LayoutGrid, Archive, ChevronRight, User, Image as ImageIcon, FileText, CheckCircle, XCircle, ArrowLeft, Trash2, ChevronLeft, ZoomIn, ZoomOut } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchScannedItemById } from '../services/apiService';

// 图片路径转换辅助函数
const getFullImageUrl = (path: string) => {
  if (!path) return '';
  if (path.startsWith('data:') || path.startsWith('http')) return path;
  
  // 如果是开发环境 (Vite 5173 端口)，则强制补全后端 3000 端口
  // 否则在生产环境 (Nginx 代理)，直接使用相对路径即可
  if (window.location.port === '5173') {
    const { protocol, hostname } = window.location;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${protocol}//${hostname}:3000${cleanPath}`;
  }
  
  // 生产环境直接返回路径
  return path.startsWith('/') ? path : `/${path}`;
};

// 详情弹窗组件
const PaperDetailModal: React.FC<{ 
  item: ScannedItem; 
  onClose: () => void;
}> = ({ item, onClose }) => {
  const [activeTab, setActiveTab] = useState<'image' | 'content'>(
    item.meta.type === DocType.WRONG_PROBLEM ? 'image' : 'content'
  );
  const [fullItem, setFullItem] = useState<ScannedItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const dragConstraintsRef = useRef<HTMLDivElement>(null);

  const handleZoomIn = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoomLevel(prev => {
      if (prev === 1) return 1.5;
      if (prev === 1.5) return 2.0;
      return prev;
    });
  };

  const handleZoomOut = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoomLevel(1.0);
  };

  const handlePrevImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentImageIndex(prev => (prev - 1 + previewImages.length) % previewImages.length);
  };

  const handleNextImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentImageIndex(prev => (prev + 1) % previewImages.length);
  };

  useEffect(() => {
    const loadDetail = async () => {
      // 如果没有 Markdown 内容，说明是列表简略数据，需要获取详情
      if (!item.rawMarkdown || !item.meta.problems || item.meta.problems.length === 0) {
        setIsLoading(true);
        try {
          const detail = await fetchScannedItemById(item.id);
          if (detail) {
            setFullItem({
              ...item,
              rawMarkdown: detail.markdown || '',
              allImagesJson: detail.allImagesJson,
              meta: {
                ...item.meta,
                problems: detail.problemsJson ? JSON.parse(detail.problemsJson) : [],
              }
            });
          }
        } catch (error) {
          console.error('加载详情失败:', error);
        } finally {
          setIsLoading(false);
        }
      } else {
        setFullItem(item);
      }
    };
    loadDetail();
  }, [item]);

  const displayItem = fullItem || item;

  // 解析多页图片列表
  const previewImages = useMemo(() => {
    if (!displayItem) return [];
    let images: string[] = [];
    if (displayItem.allImagesJson) {
      try {
        images = JSON.parse(displayItem.allImagesJson);
      } catch (e) {
        console.error('解析图片列表失败', e);
        images = [displayItem.imageUrl];
      }
    } else {
      images = [displayItem.imageUrl];
    }
    return images.map(getFullImageUrl);
  }, [displayItem]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 md:p-8"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-white">
          <div className="flex items-center gap-4">
            <button 
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <ArrowLeft size={24} className="text-gray-600" />
            </button>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="default">{displayItem.meta.subject}</Badge>
                <span className="text-sm text-gray-500">{new Date(displayItem.timestamp).toLocaleDateString()}</span>
              </div>
              <h2 className="text-xl font-bold text-gray-900">
                {displayItem.meta.chapter_hint || `${displayItem.meta.subject}测试卷`}
              </h2>
            </div>
          </div>
          
          <div className="flex bg-gray-100 p-1 rounded-xl">
            {displayItem.meta.type === DocType.WRONG_PROBLEM && (
              <button 
                onClick={() => setActiveTab('image')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'image' ? 'bg-white shadow-sm text-sky-600' : 'text-gray-500'}`}
              >
                <ImageIcon size={16} className="inline mr-2" />
                原始试卷
              </button>
            )}
            <button 
              onClick={() => setActiveTab('content')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'content' ? 'bg-white shadow-sm text-sky-600' : 'text-gray-500'}`}
            >
              <FileText size={16} className="inline mr-2" />
              {displayItem.meta.type === DocType.WRONG_PROBLEM ? '结构化内容' : 'Markdown 归集文档'}
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto bg-gray-50 p-6 flex flex-col min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <LoadingSpinner size={40} text="正在加载深度分析内容..." />
            </div>
          ) : activeTab === 'image' ? (
            <div className="flex-1 flex flex-col min-h-0">
              {/* 图片展示框 - 拖拽模式 */}
              <div 
                ref={dragConstraintsRef}
                className="flex-1 relative overflow-hidden bg-gray-200/50 rounded-2xl cursor-move group flex items-center justify-center"
              >
                <div className="w-full h-full flex items-center justify-center relative">
                  <motion.img 
                    key={currentImageIndex}
                    drag={zoomLevel > 1}
                    dragConstraints={dragConstraintsRef}
                    dragElastic={0}
                    src={previewImages[currentImageIndex]} 
                    alt="Original Paper" 
                    initial={{ opacity: 0, scale: zoomLevel }}
                    animate={{ 
                      opacity: 1,
                      scale: zoomLevel,
                      transition: { type: 'spring', stiffness: 300, damping: 30 }
                    }}
                    style={{ 
                      maxWidth: zoomLevel > 1 ? 'none' : '95%',
                      maxHeight: zoomLevel > 1 ? 'none' : '95%',
                      objectFit: 'contain'
                    }}
                    className="rounded-lg shadow-xl select-none"
                  />

                  {/* 左右切换箭头 */}
                  {previewImages.length > 1 && (
                    <>
                      <button
                        onClick={handlePrevImage}
                        className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/80 backdrop-blur-md rounded-full flex items-center justify-center text-gray-700 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white z-20"
                      >
                        <ChevronLeft size={24} />
                      </button>
                      <button
                        onClick={handleNextImage}
                        className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/80 backdrop-blur-md rounded-full flex items-center justify-center text-gray-700 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white z-20"
                      >
                        <ChevronRight size={24} />
                      </button>
                    </>
                  )}

                  {/* 缩放工具栏 */}
                  <div className="absolute bottom-4 right-4 flex gap-2 z-30">
                    <button
                      onClick={handleZoomIn}
                      disabled={zoomLevel >= 2.5}
                      className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all ${
                        zoomLevel >= 2.5 ? 'bg-gray-200 text-gray-400' : 'bg-white text-sky-600 hover:bg-sky-50 active:scale-95'
                      }`}
                    >
                      <ZoomIn size={20} />
                    </button>
                    <button
                      onClick={handleZoomOut}
                      disabled={zoomLevel <= 1}
                      className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all ${
                        zoomLevel <= 1 ? 'bg-gray-200 text-gray-400' : 'bg-white text-sky-600 hover:bg-sky-50 active:scale-95'
                      }`}
                    >
                      <ZoomOut size={20} />
                    </button>
                  </div>
                </div>

                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-md text-white px-4 py-2 rounded-full text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                  {zoomLevel === 1 ? '使用右下角按钮放大' : '可自由拖拽查看边缘'} ({zoomLevel}x)
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-6">
              {displayItem.meta.type === DocType.WRONG_PROBLEM && displayItem.meta.problems && displayItem.meta.problems.length > 0 ? (
                displayItem.meta.problems.map((prob, idx) => (
                  <Card key={idx} className="overflow-hidden border-none shadow-sm">
                    <div className="flex items-start gap-4">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 font-bold ${
                        prob.status === ProblemStatus.WRONG ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'
                      }`}>
                        {prob.questionNumber || idx + 1}
                      </div>
                      <div className="flex-1 space-y-4">
                        <div className="text-gray-800 leading-relaxed font-medium">
                          <div className="markdown-content prose prose-sm max-w-none">
                            <ReactMarkdown 
                              components={{
                                p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />,
                                blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-gray-200 pl-3 italic bg-gray-50 py-1 my-2 rounded" {...props} />,
                              }}
                            >
                              {prob.content}
                            </ReactMarkdown>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-100">
                          <div className="space-y-1">
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">学生作答</span>
                            <div className={`p-3 rounded-xl text-sm ${prob.status === ProblemStatus.WRONG ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                              {prob.studentAnswer || '(未填写)'}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">标准答案</span>
                            <div className="p-3 bg-blue-50 text-blue-700 rounded-xl text-sm">
                              {prob.standardAnswer || '(暂无)'}
                            </div>
                          </div>
                        </div>

                        {/* 老师批注与订正 */}
                        {(prob.teacherComment || prob.correction) && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {prob.teacherComment && (
                              <div className="space-y-1">
                                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">老师批注</span>
                                <div className="p-3 bg-amber-50 text-amber-700 rounded-xl text-sm border border-amber-100">
                                  {prob.teacherComment}
                                </div>
                              </div>
                            )}
                            {prob.correction && (
                              <div className="space-y-1">
                                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">订正内容</span>
                                <div className="p-3 bg-indigo-50 text-indigo-700 rounded-xl text-sm border border-indigo-100">
                                  {prob.correction}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {prob.knowledgePoints && prob.knowledgePoints.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-2">
                            {prob.knowledgePoints.map(kp => (
                              <Badge key={kp} variant="outline" size="sm">#{kp}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0">
                        {prob.status === ProblemStatus.WRONG ? (
                          <XCircle className="text-red-500" size={24} />
                        ) : (
                          <CheckCircle className="text-green-500" size={24} />
                        )}
                      </div>
                    </div>
                  </Card>
                ))
              ) : (
                <div className="max-w-4xl mx-auto bg-white p-12 md:p-16 rounded-3xl shadow-xl border border-gray-100">
                  <div className="prose prose-slate prose-lg max-w-none">
                    <div className="markdown-content-reader leading-relaxed tracking-wide text-gray-800">
                      <ReactMarkdown 
                        components={{
                          h1: ({node, ...props}) => <h1 className="text-4xl font-black text-gray-900 mb-8 border-b-4 border-brand-100 pb-4 mt-0" {...props} />,
                          h2: ({node, ...props}) => <h2 className="text-2xl font-bold text-gray-800 mt-12 mb-6 flex items-center gap-2 before:content-[''] before:w-1.5 before:h-6 before:bg-brand-500 before:rounded-full" {...props} />,
                          h3: ({node, ...props}) => <h3 className="text-xl font-bold text-gray-800 mt-8 mb-4" {...props} />,
                          p: ({node, ...props}) => <p className="text-gray-700 leading-[1.8] mb-6 text-lg" {...props} />,
                          ul: ({node, ...props}) => <ul className="list-disc list-outside space-y-3 mb-6 ml-6 text-gray-700" {...props} />,
                          ol: ({node, ...props}) => <ol className="list-decimal list-outside space-y-3 mb-6 ml-6 text-gray-700" {...props} />,
                          li: ({node, ...props}) => <li className="pl-2" {...props} />,
                          blockquote: ({node, ...props}) => (
                            <blockquote className="border-l-8 border-brand-200 pl-8 py-4 italic bg-brand-50/30 my-8 rounded-r-2xl text-gray-600 font-serif" {...props} />
                          ),
                          code: ({node, inline, ...props}: any) => 
                            inline ? 
                            <code className="bg-gray-100 text-brand-600 px-2 py-0.5 rounded text-sm font-mono font-bold" {...props} /> : 
                            <code className="block bg-slate-900 text-slate-100 p-6 rounded-2xl text-sm font-mono overflow-x-auto my-8 shadow-inner" {...props} />,
                          table: ({node, ...props}) => (
                            <div className="overflow-x-auto my-10 rounded-xl border border-gray-200 shadow-sm">
                              <table className="min-w-full divide-y divide-gray-200" {...props} />
                            </div>
                          ),
                          th: ({node, ...props}) => <th className="px-6 py-4 bg-gray-50 text-left text-sm font-bold text-gray-600 uppercase tracking-wider" {...props} />,
                          td: ({node, ...props}) => <td className="px-6 py-4 text-sm text-gray-700 border-t border-gray-100" {...props} />,
                          hr: () => <hr className="my-12 border-t-2 border-dashed border-gray-100" />
                        }}
                      >
                        {displayItem.rawMarkdown || '暂无结构化分析内容'}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

interface KnowledgeHubProps {
  items: ScannedItem[];
  currentUser: UserProfile;
  searchQuery: string;
  filterSubject: string;
  filterTime?: string;
  startDate?: string;
  endDate?: string;
  filterType: string;
  onDelete?: (id: string) => void;
}

const KnowledgeHub: React.FC<KnowledgeHubProps> = ({ 
  items, 
  currentUser, 
  searchQuery,
  filterSubject,
  filterTime = 'all',
  startDate = '',
  endDate = '',
  filterType,
  onDelete
}) => {
  const [viewMode, setViewMode] = useState<'grid' | 'archive'>('grid');
  const [selectedItem, setSelectedItem] = useState<ScannedItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // 当外部传入的 items 发生变化时，重置删除状态
  useEffect(() => {
    setDeletingId(null);
  }, [items]);

  const handleDelete = (e: React.MouseEvent, item: ScannedItem) => {
    e.stopPropagation();
    if (!onDelete) return;
    
    if (window.confirm(`确定要永久删除 ${item.meta.subject} - ${item.meta.chapter_hint || '未命名资料'} 吗？\n删除后不可恢复，且关联的物理文件也将被彻底清除。`)) {
      setDeletingId(item.id);
      onDelete(item.id);
    }
  };

  const displayItems = useMemo(() => {
    return items.filter(item => {
      // 0. 基础排除：排除教材类型内容 (这些内容在图书馆模块显示)
      if (item.meta.type === DocType.TEXTBOOK) return false;

      // 1. 搜索过滤
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const contentMatch = item.rawMarkdown?.toLowerCase().includes(query);
        const problemMatch = item.meta.problems?.some(p => 
          p.content.toLowerCase().includes(query) || 
          p.knowledgePoints?.some(kp => kp.toLowerCase().includes(query))
        );
        if (!contentMatch && !problemMatch) return false;
      }

      // 2. 学科过滤
      if (filterSubject !== 'all' && item.meta.subject !== filterSubject) return false;

      // 3. 类别过滤
      if (filterType !== 'all') {
        if (filterType === 'wrong') {
          // 仅展示剥离出的错题单元
          if (item.meta.type !== DocType.WRONG_PROBLEM) return false;
        } else if (filterType === 'archived') {
          // 展示整卷归集文档（排除错题单元）
          if (item.meta.type === DocType.WRONG_PROBLEM) return false;
        }
      }

      // 4. 时间过滤
      if (filterTime !== 'all') {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        
        if (filterTime === 'today') {
          if (item.timestamp < startOfToday) return false;
        } else if (filterTime === 'week') {
          const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
          if (item.timestamp < sevenDaysAgo) return false;
        } else if (filterTime === 'month') {
          const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
          if (item.timestamp < thirtyDaysAgo) return false;
        } else if (filterTime === 'custom') {
          if (startDate) {
            const startTs = new Date(startDate).getTime();
            if (item.timestamp < startTs) return false;
          }
          if (endDate) {
            // 结束日期包含当天
            const endTs = new Date(endDate).getTime() + 24 * 60 * 60 * 1000 - 1;
            if (item.timestamp > endTs) return false;
          }
        }
      }

      return true;
    });
  }, [items, searchQuery, filterSubject, filterType, filterTime, startDate, endDate]);

  // 卷宗模式的分组逻辑
  const archiveGroups = useMemo(() => {
    const groups: Record<string, Record<string, Record<string, ScannedItem[]>>> = {};
    
    displayItems.forEach(item => {
      const date = new Date(item.timestamp).toLocaleDateString('zh-CN').replace(/\//g, '-');
      const subject = item.meta.subject || '未知学科';
      const student = currentUser.name; 

      if (!groups[date]) groups[date] = {};
      if (!groups[date][subject]) groups[date][subject] = {};
      if (!groups[date][subject][student]) groups[date][subject][student] = [];
      
      groups[date][subject][student].push(item);
    });

    return groups;
  }, [displayItems, currentUser]);

  return (
    <div className="space-y-6">
      {/* 顶部工具栏 - 仅保留视图切换，筛选移到父组件 */}
      <div className="flex justify-end">
        <div className="flex bg-white rounded-xl p-1 border border-gray-200 shadow-sm">
          <button 
            onClick={() => setViewMode('grid')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'grid' ? 'bg-sky-50 text-sky-600' : 'text-gray-500'}`}
          >
            <LayoutGrid size={16} />
            平铺视图
          </button>
          <button 
            onClick={() => setViewMode('archive')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'archive' ? 'bg-sky-50 text-sky-600' : 'text-gray-500'}`}
          >
            <Archive size={16} />
            卷宗模式
          </button>
        </div>
      </div>

      {/* 知识卡片网格 / 卷宗模式 */}
      {displayItems.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center min-h-[60vh]"
        >
          <div className="relative w-80 h-80 mb-8">
            <div className="absolute inset-0 bg-gradient-to-br from-gray-100 to-gray-200 rounded-3xl opacity-50" />
            <div className="absolute inset-8 flex items-center justify-center">
              <BookOpen size={120} className="text-gray-300" />
            </div>
          </div>
          <h2 className="text-2xl font-semibold mb-2">知识库空空如也</h2>
          <p className="text-gray-600 mb-8">去拍题录入内容吧</p>
        </motion.div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {displayItems.map((item, index) => {
            const subjectColors: Record<string, string> = {
              '数学': '#3B82F6',
              '语文': '#FB7185',
              '英语': '#A78BFA',
              '科学': '#10B981',
            };
            const color = subjectColors[item.meta.subject || '数学'] || '#4A90E2';

            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card hover onClick={() => setSelectedItem(item)}>
                  {/* 顶部彩色条 */}
                  <div className="h-2 -mx-6 -mt-6 mb-4 rounded-t-2xl" style={{ backgroundColor: color }} />

                  {/* 头部：学科标签 + 状态 */}
                  <div className="flex items-center justify-between mb-4">
                    <span
                      className="px-3 py-1 text-sm rounded-full font-medium"
                      style={{
                        backgroundColor: color + '20',
                        color: color,
                      }}
                    >
                      {item.meta.subject}
                    </span>
                    <Badge
                      variant={item.meta.knowledge_status === KnowledgeStatus.MASTERED ? 'success' : 'warning'}
                    >
                      {item.meta.knowledge_status === KnowledgeStatus.MASTERED ? '已掌握' : '待复习'}
                    </Badge>
                    {onDelete && (
                      <button
                        onClick={(e) => handleDelete(e, item)}
                        className="ml-2 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                        disabled={deletingId === item.id}
                      >
                        <Trash2 size={16} className={deletingId === item.id ? 'animate-pulse' : ''} />
                      </button>
                    )}
                  </div>

                  {/* 内容预览 */}
                  <div className="text-gray-700 mb-4 line-clamp-3 leading-relaxed min-h-[4.5rem]">
                    {item.meta.type === DocType.WRONG_PROBLEM 
                      ? (item.meta.problems?.[0]?.content || '暂无题目内容')
                      : (item.rawMarkdown?.replace(/[#*`]/g, '').slice(0, 150) || '暂无归集内容')}
                  </div>

                  {/* 底部：日期 + 章节提示 */}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 flex items-center gap-1">
                      <Calendar size={14} />
                      {new Date(item.timestamp).toLocaleDateString('zh-CN')}
                    </span>
                    <Badge size="sm" variant="outline">
                      {item.meta.type === DocType.WRONG_PROBLEM ? '错题单元' : '归集文档'}
                    </Badge>
                    {item.meta.type !== DocType.WRONG_PROBLEM && item.meta.problems && item.meta.problems.length > 0 && (
                      <Badge size="sm" variant="outline">
                        {item.meta.problems.filter(p => p.status === ProblemStatus.WRONG).length} 错题
                      </Badge>
                    )}
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(archiveGroups).sort(([a], [b]) => b.localeCompare(a)).map(([date, subjects]) => (
            <div key={date} className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center text-sky-600">
                  <Calendar size={20} />
                </div>
                <h3 className="text-xl font-bold text-gray-800">{date}</h3>
                <div className="h-[1px] flex-1 bg-gray-100" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pl-12">
                {Object.entries(subjects).map(([subject, students]) => (
                  <div key={subject} className="space-y-3">
                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                      <BookOpen size={14} />
                      {subject}
                    </h4>
                    {Object.entries(students).map(([student, groupItems]) => (
                      <div key={student} className="space-y-2">
                        {groupItems.map((item, idx) => (
                          <Card 
                            key={item.id} 
                            hover 
                            className="group border-gray-100"
                            onClick={() => setSelectedItem(item)}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
                                  {idx === 0 ? <User size={16} /> : <FileText size={16} />}
                                </div>
                                <div>
                                  <div className="font-semibold text-gray-700">
                                    {idx === 0 ? student : `续页 / 附件 ${idx}`}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {item.meta.chapter_hint || '未命名卷宗'}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {item.meta.problems && (
                                  <Badge size="sm" variant="outline" className="opacity-60 group-hover:opacity-100 transition-opacity">
                                    {item.meta.problems.filter(p => p.status === ProblemStatus.WRONG).length} 错
                                  </Badge>
                                )}
                                {onDelete && (
                                  <button
                                    onClick={(e) => handleDelete(e, item)}
                                    className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                    disabled={deletingId === item.id}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                )}
                                <ChevronRight size={18} className="text-gray-300 group-hover:text-sky-500 transition-colors" />
                              </div>
                            </div>
                            {/* 简易进度条：展示对错比例 */}
                            {item.meta.problems && item.meta.problems.length > 0 && (
                              <div className="mt-4 flex gap-1 h-1 rounded-full overflow-hidden bg-gray-100">
                                <div 
                                  className="bg-green-400" 
                                  style={{ width: `${((item.meta.problems.length - item.meta.problems.filter(p => p.status === ProblemStatus.WRONG).length) / item.meta.problems.length) * 100}%` }} 
                                />
                                <div 
                                  className="bg-red-400" 
                                  style={{ width: `${(item.meta.problems.filter(p => p.status === ProblemStatus.WRONG).length / item.meta.problems.length) * 100}%` }} 
                                />
                              </div>
                            )}
                          </Card>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 详情弹窗 */}
      <AnimatePresence>
        {selectedItem && (
          <PaperDetailModal 
            item={selectedItem} 
            onClose={() => setSelectedItem(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default KnowledgeHub;
