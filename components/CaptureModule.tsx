
import React, { useState, useRef, useEffect, useMemo } from 'react';
import confetti from 'canvas-confetti';
import { analyzeImage } from '../services/aiService';
import { saveScannedItemToServer } from '../services/apiService';
import { ProcessingStatus, ScannedItem, UserProfile, DocType, ProblemStatus } from '../types';
import { Button, LoadingSpinner, Card, Badge, Input } from './ui';
import { Camera, Upload, CheckCircle, Search, Filter, Plus, FileText, ArrowLeft, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import KnowledgeHub from './KnowledgeHub';
import UnifiedWrongBook from './UnifiedWrongBook';
import { calculateFileHash } from '../utils/hashUtils';
import { checkFileHash } from '../services/apiService';

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

interface CaptureModuleProps {
  onScanComplete: (item: ScannedItem) => void;
  onDeleteItem?: (id: string) => void | Promise<void>;
  currentUser: UserProfile;
  scannedItems: ScannedItem[];
  /** 嵌入到 ResourcesShell 时：隐藏顶部"拍题"标题 */
  hideHeader?: boolean;
  /** 嵌入时锁定主 sub-tab（隐藏"立即拍题"按钮，仅显示错题/归档二选一） */
  lockedSubTab?: 'wrong_problems' | 'archived_docs';
  /** 嵌入时锁定 sub-tab 切换：父级二选一切换由此回调 */
  onLockedSubTabChange?: (tab: 'wrong_problems' | 'archived_docs') => void;
  onOpenQuizResult: (resultId: string) => void;
  onOpenPaperAttempt: (attemptId: string) => void;
}

const CaptureModule: React.FC<CaptureModuleProps> = ({
  onScanComplete,
  onDeleteItem,
  currentUser,
  scannedItems,
  hideHeader = false,
  lockedSubTab,
  onLockedSubTabChange,
  onOpenQuizResult,
  onOpenPaperAttempt,
}) => {
  const embedded = !!lockedSubTab;
  const [activeSubTab, setActiveSubTab] = useState<'capture' | 'wrong_problems' | 'archived_docs'>(
    embedded ? lockedSubTab! : 'capture'
  );
  const [searchQuery, setSearchQuery] = useState('');
  // 学科默认「语文」,用户高频场景就是语文错题/卷子归档,默认「全部」会把英语/数学也带进来。
  // 其他过滤条件保持「全部」默认。
  const [filterSubject, setFilterSubject] = useState('语文');
  const [filterTime, setFilterTime] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filterType, setFilterType] = useState('wrong');

  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [processingStage, setProcessingStage] = useState<string>('');
  const [preview, setPreview] = useState<string | null>(null);
  const [reviewItem, setReviewItem] = useState<ScannedItem | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragConstraintsRef = useRef<HTMLDivElement>(null);

  // 嵌入模式：锁定主 sub-tab 变化时，且当前不在拍题流程中，同步内部 sub-tab
  useEffect(() => {
    if (embedded && lockedSubTab && activeSubTab !== 'capture') {
      setActiveSubTab(lockedSubTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedSubTab]);

  // 获取所有出现的学科，用于下拉筛选 (仅针对当前用户上传的内容)
  const userScannedItems = useMemo(() => {
    return scannedItems.filter(item => item.ownerId === currentUser.id);
  }, [scannedItems, currentUser.id]);

  const subjects = useMemo(() => {
    const s = new Set<string>();
    userScannedItems.forEach(item => {
      if (item.meta.subject) s.add(item.meta.subject);
    });
    return Array.from(s);
  }, [userScannedItems]);

  // 多页预览图列表
  const previewImages = useMemo(() => {
    if (!reviewItem) return [];
    return (reviewItem as any).originalImages || [reviewItem.imageUrl];
  }, [reviewItem]);

  // 多页试卷管理
  const [pendingImages, setPendingImages] = useState<string[]>([]); // 待处理图片队列
  const [batchResults, setBatchResults] = useState<{text: string, meta: any}[]>([]); // 批量识别结果暂存
  const [currentProcessingIndex, setCurrentProcessingIndex] = useState<number>(0); // 当前处理的图片索引
  const [isProcessingBatch, setIsProcessingBatch] = useState(false); // 是否正在批量处理
  const parentExamIdRef = useRef<string | null>(null); // 批量处理时的统一父试卷ID
  const [currentFileHash, setCurrentFileHash] = useState<string | undefined>(undefined);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // 限制最大图片数量为 4 张
    if (files.length > 4) {
      alert('单次上传图片不能超过 4 张，请重新选择。');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // 查重校验 (对第一张图进行查重)
    try {
      const hash = await calculateFileHash(files[0]);
      const duplicate = await checkFileHash(hash);
      if (duplicate) {
        if (!confirm(`检测到该文件已存在：\n[${duplicate.title}] (${new Date(duplicate.timestamp).toLocaleDateString()})\n\n是否仍要重复上传？`)) {
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }
      }
      setCurrentFileHash(hash);
    } catch (err) {
      console.error('哈希校验失败:', err);
    }

    // 支持多选
    if (files.length > 1) {
      // 多图模式：添加到待处理队列
      // 生成统一的 parentExamId（所有页共享同一个ID）
      parentExamIdRef.current = Date.now().toString();
      setBatchResults([]); // 清空之前的批量结果

      const loadImagePromises = Array.from(files).map((file) => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            resolve(e.target?.result as string);
          };
          reader.readAsDataURL(file);
        });
      });

      // 使用 Promise.all 确保图片按顺序加载
      Promise.all(loadImagePromises).then((imageUrls) => {
        setPendingImages(imageUrls);
        setIsProcessingBatch(true);
        setCurrentProcessingIndex(0);
      });
    } else {
      // 单图模式：原有逻辑
      const file = files[0];
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
        setReviewItem(null);
      };
      reader.readAsDataURL(file);
    }
  };

  // 并发处理多张图片：信号量限制 = 3
  // Why: OCR 改为异步任务后,单图 ~200s。串行 N 张 = N×200s,而后端最多并发 N 张时,
  //      总耗时趋近 ceil(N/3)×200s。CONCURRENCY=3 足以覆盖单次最多 4 张的限制场景。
  // currentProcessingIndex 在新模式下复用为"已完成数"(0..N),不再表示当前游标。
  useEffect(() => {
    if (pendingImages.length === 0 || !isProcessingBatch) return;

    let mounted = true;
    let aborted = false;
    const CONCURRENCY = 3;
    const images = pendingImages;
    const results: Array<{ text: string; meta: any } | null> = new Array(images.length).fill(null);
    let nextIndex = 0;
    let completed = 0;

    setIsProcessing(true);
    setCurrentProcessingIndex(0);

    const runWorker = async () => {
      while (!aborted && mounted) {
        const i = nextIndex++;
        if (i >= images.length) return;
        try {
          const r = await analyzeImage(images[i], setProcessingStage, currentUser.id);
          if (!mounted || aborted) return;
          results[i] = r;
          completed++;
          setCurrentProcessingIndex(completed);
        } catch (err: any) {
          if (!mounted) return;
          aborted = true;
          const errorMsg = `第 ${i + 1} 张图片识别失败: ${err.message || '未知错误'}`;
          console.error(errorMsg, err);
          setIsProcessingBatch(false);
          setPendingImages([]);
          setCurrentProcessingIndex(0);
          parentExamIdRef.current = null;
          setIsProcessing(false);
          return;
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, images.length) },
      () => runWorker()
    );

    Promise.all(workers).then(() => {
      if (!mounted || aborted) return;
      const finalResults = results.filter((x): x is { text: string; meta: any } => x !== null);
      if (finalResults.length !== images.length) return;

      const mergedMarkdown = finalResults
        .map((res, idx) => `\n\n---\n\n**[第 ${idx + 1} 页识别内容]**\n\n${res.text}`)
        .join('\n');
      const mergedProblems = finalResults.flatMap((res) => res.meta.problems || []);

      const mergedItem: ScannedItem = {
        id: parentExamIdRef.current || Date.now().toString(),
        ownerId: currentUser.id,
        timestamp: Date.now(),
        imageUrl: images[0],
        rawMarkdown: mergedMarkdown,
        fileHash: currentFileHash,
        meta: {
          ...finalResults[0].meta,
          subject: finalResults[0].meta.subject,
          problems: mergedProblems,
        },
        status: ProcessingStatus.PROCESSED,
        multiPageSource: true,
        totalPages: images.length,
        originalImages: images,
      } as any;

      setReviewItem(mergedItem);
      setPreview(images[0]);
      setPendingImages([]);
      setIsProcessingBatch(false);
      setCurrentProcessingIndex(0);
      parentExamIdRef.current = null;
      setBatchResults([]);
      setIsProcessing(false);

      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#4A90E2', '#5FD4A0', '#FFB84D'],
      });
    });

    return () => {
      mounted = false;
    };
    // 仅在批次启动时初始化一次,内部循环自驱;不依赖 currentProcessingIndex,避免重入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingImages, isProcessingBatch]);

  const handleProcess = async () => {
    if (!preview) return;
    setIsProcessing(true);
    setProcessingError(null);
    setProcessingStage('正在提交识别任务...');
    try {
      const result = await analyzeImage(preview, setProcessingStage, currentUser.id);
      const newItem: ScannedItem = {
        id: Date.now().toString(),
        ownerId: currentUser.id,
        timestamp: Date.now(),
        imageUrl: preview,
        rawMarkdown: result.text,
        fileHash: currentFileHash, // 添加哈希值
        meta: result.meta,
        status: ProcessingStatus.PROCESSED
      };
      setReviewItem(newItem);
    } catch (error: any) {
      setProcessingError(error.message || "AI 语义解构失败，请重试。");
    } finally {
      setIsProcessing(false);
      setProcessingStage('');
    }
  };

  const handleSaveAndArchive = async () => {
    if (reviewItem && preview) {
      try {
        setIsSaving(true);
        setSaveError(null);

        // 1. 准备要上传的图片 (如果是多图合并，使用 originalImages 数组，否则使用单张 preview)
        const imagesToUpload = (reviewItem as any).originalImages || preview;

        // 2. 保存到服务器（文件系统 + 数据库）
        const result = await saveScannedItemToServer(reviewItem, imagesToUpload);

        // 3. 将所有保存的条目（包含主试卷和剥离的错题）同步到前端状态
        if (result.items && result.items.length > 0) {
          result.items.forEach((itemData: any) => {
            const savedItem: ScannedItem = {
              id: itemData.id,
              ownerId: itemData.ownerId,
              userName: itemData.userName,
              timestamp: itemData.timestamp,
              imageUrl: itemData.imagePath,
              rawMarkdown: '', // 详情点击时再加载
              meta: {
                type: itemData.type as any,
                subject: itemData.subject,
                chapter_hint: itemData.chapter,
                problems: itemData.problemsJson ? JSON.parse(itemData.problemsJson) : [],
              },
              status: ProcessingStatus.PROCESSED,
            };
            onScanComplete(savedItem);
          });
        }

        // 4. 触发成功动画
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#4A90E2', '#5FD4A0', '#FFB84D']
        });

        // 5. 重置界面
        setPreview(null);
        setReviewItem(null);
        if (fileInputRef.current) fileInputRef.current.value = '';

        // 嵌入模式：拍题完成后退回锁定的 sub-tab（错题或归档）
        if (embedded && lockedSubTab) {
          setActiveSubTab(lockedSubTab);
        }

      } catch (error: any) {
        console.error('保存失败:', error);
        setSaveError(error.message || '保存到服务器失败，请重试');
      } finally {
        setIsSaving(false);
      }
    }
  };

  const updateProblemStatus = (index: number, status: ProblemStatus) => {
    if (!reviewItem || !reviewItem.meta.problems) return;
    const newProblems = [...reviewItem.meta.problems];
    newProblems[index] = { ...newProblems[index], status };
    setReviewItem({
      ...reviewItem,
      meta: { ...reviewItem.meta, problems: newProblems }
    });
  };

  const updateProblemField = (index: number, field: string, value: any) => {
    if (!reviewItem || !reviewItem.meta.problems) return;
    const newProblems = [...reviewItem.meta.problems];
    newProblems[index] = { ...newProblems[index], [field]: value };
    setReviewItem({
      ...reviewItem,
      meta: { ...reviewItem.meta, problems: newProblems }
    });
  };

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

  if (reviewItem) {
    const subjectColors: Record<string, string> = {
      '数学': '#3B82F6',
      '语文': '#FB7185',
      '英语': '#A78BFA',
      '科学': '#10B981',
    };

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl mx-auto space-y-6 pb-20"
      >
        {/* 返回按钮 */}
        <Button 
          variant="outline" 
          size="sm" 
          icon={ArrowLeft}
          onClick={() => {
            setPreview(null);
            setReviewItem(null);
          }}
          className="mb-2"
        >
          取消并返回
        </Button>

        <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-lg mb-6">
          <div className="flex items-center gap-2 text-blue-700 font-medium">
            <CheckCircle className="w-5 h-5" />
            <span>AI 识别完成！请校对并修改识别内容，确保准确无误后再保存。</span>
          </div>
        </div>

        {/* 原图预览 - 拖拽模式 */}
        <Card 
          className="sticky top-4 z-10 overflow-hidden bg-gray-100 h-[45vh] flex flex-col shadow-2xl border-brand-100 group" 
        >
          <div 
            ref={dragConstraintsRef}
            className="flex-1 relative overflow-hidden cursor-move flex items-center justify-center"
          >
            <div className="w-full h-full flex items-center justify-center relative">
              <motion.img 
                key={currentImageIndex}
                drag={zoomLevel > 1}
                dragConstraints={dragConstraintsRef}
                dragElastic={0}
                src={getFullImageUrl(previewImages[currentImageIndex])} 
                className="rounded-lg shadow-lg select-none pointer-events-auto" 
                alt="上传的图片" 
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
                    zoomLevel >= 2.5 ? 'bg-gray-200 text-gray-400' : 'bg-white text-brand-600 hover:bg-brand-50 active:scale-95'
                  }`}
                >
                  <ZoomIn size={20} />
                </button>
                <button
                  onClick={handleZoomOut}
                  disabled={zoomLevel <= 1}
                  className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all ${
                    zoomLevel <= 1 ? 'bg-gray-200 text-gray-400' : 'bg-white text-brand-600 hover:bg-brand-50 active:scale-95'
                  }`}
                >
                  <ZoomOut size={20} />
                </button>
              </div>
            </div>
          </div>
          
          <div className="text-center text-xs font-bold text-brand-700 py-2.5 bg-white/95 backdrop-blur-md border-t border-brand-50 flex items-center justify-center gap-4 z-20">
            <div className="flex items-center gap-1.5">
              <i className="fa-solid fa-magnifying-glass-plus"></i>
              <span>当前倍率: {zoomLevel}x</span>
            </div>
            <div className="h-3 w-[1px] bg-brand-100" />
            <div className="flex items-center gap-1.5">
              <i className="fa-solid fa-hand-pointer"></i>
              <span>{zoomLevel > 1 ? '可自由拖拽查看边缘' : '使用右下角按钮缩放'}</span>
            </div>
            {previewImages.length > 1 && (
              <>
                <div className="h-3 w-[1px] bg-brand-100" />
                <div className="flex items-center gap-1.5">
                  <i className="fa-solid fa-copy"></i>
                  <span>共 {previewImages.length} 页</span>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* 识别结果编辑区域 */}
        <div className="space-y-6">
          {reviewItem.meta.problems?.map((problem: any, index) => {
            const color = subjectColors[problem.subject || reviewItem.meta.subject] || '#4A90E2';

            return (
              <Card key={index} className="p-6 border-2 border-transparent hover:border-brand-200 transition-all">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 bg-brand-600 text-white rounded-full flex items-center justify-center font-bold">
                      {index + 1}
                    </span>
                    <select 
                      value={problem.status}
                      onChange={(e) => updateProblemField(index, 'status', e.target.value)}
                      className={`text-sm font-medium px-3 py-1 rounded-full border-none focus:ring-2 focus:ring-offset-2 ${
                        problem.status === 'correct' ? 'bg-green-100 text-green-700' : 
                        problem.status === 'wrong' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      <option value="correct">正确</option>
                      <option value="wrong">错误</option>
                      <option value="corrected">已订正</option>
                    </select>
                  </div>
                  <span
                    className="px-3 py-1 text-sm rounded-full font-medium"
                    style={{
                      backgroundColor: color + '20',
                      color: color,
                    }}
                  >
                    {problem.subject || reviewItem.meta.subject}
                  </span>
                </div>

                <div className="space-y-4">
                  {/* 题干内容 */}
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">题干内容 (支持 Markdown/LaTeX)</label>
                    <textarea
                      value={problem.content}
                      onChange={(e) => updateProblemField(index, 'content', e.target.value)}
                      rows={6}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-800 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all font-mono"
                      placeholder="包含阅读背景与具体题目内容..."
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 学生答案 */}
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">学生作答</label>
                      <textarea
                        value={problem.studentAnswer || ''}
                        onChange={(e) => updateProblemField(index, 'studentAnswer', e.target.value)}
                        rows={2}
                        className="w-full p-3 bg-red-50/50 border border-red-100 rounded-lg text-gray-800 text-sm focus:ring-2 focus:ring-red-400 focus:border-transparent transition-all"
                        placeholder="识别学生的手写答案..."
                      />
                    </div>

                    {/* 标准答案 */}
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">标准答案</label>
                      <textarea
                        value={problem.standardAnswer || ''}
                        onChange={(e) => updateProblemField(index, 'standardAnswer', e.target.value)}
                        rows={2}
                        className="w-full p-3 bg-green-50/50 border border-green-100 rounded-lg text-gray-800 text-sm focus:ring-2 focus:ring-green-400 focus:border-transparent transition-all"
                        placeholder="AI 生成的标准答案..."
                      />
                    </div>
                  </div>

                  {/* 教师批注/订正内容 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">老师批注 (如有)</label>
                      <input
                        type="text"
                        value={problem.teacherComment || ''}
                        onChange={(e) => updateProblemField(index, 'teacherComment', e.target.value)}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-800 text-sm focus:ring-2 focus:ring-brand-500 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">知识点 (逗号分隔)</label>
                      <input
                        type="text"
                        value={problem.knowledgePoints?.join(', ') || ''}
                        onChange={(e) => updateProblemField(index, 'knowledgePoints', e.target.value.split(',').map(s => s.trim()))}
                        className="w-full p-3 bg-indigo-50/50 border border-indigo-100 rounded-lg text-gray-800 text-sm focus:ring-2 focus:ring-indigo-400 transition-all"
                        placeholder="如：一元二次方程, 函数..."
                      />
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* 底部按钮 */}
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex gap-4 w-full max-w-lg px-4 z-50">
          <Button
            variant="primary"
            size="lg"
            className="flex-1 shadow-xl"
            onClick={handleSaveAndArchive}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <LoadingSpinner size={20} className="mr-2" />
                正在永久存储...
              </>
            ) : (
              '确认无误，保存并归档'
            )}
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="bg-white shadow-lg"
            onClick={() => {
              if (confirm('确定要放弃修改并重新识别吗？')) {
                setPreview(null);
                setReviewItem(null);
              }
            }}
          >
            重新识别
          </Button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* 标题栏 (嵌入模式下隐藏) */}
      {!hideHeader && (
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-rose-400/15 text-rose-400 rounded-2xl flex items-center justify-center shadow-glow-sm">
            <Camera size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-neon-blue via-cyber-text to-neon-purple bg-clip-text text-transparent">拍题</h2>
            <p className="text-sm text-cyber-muted">通过 AI 智能识别试卷与作业，沉淀数字化档案</p>
          </div>
        </div>
      )}

      {/* 顶部操作栏 */}
      <Card className="p-4 mb-6">
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4">
          <div className="flex items-center gap-2">
            {/* 立即拍题切换按钮（独立模式） */}
            {!embedded && (
              <button
                onClick={() => {
                  setPreview(null);
                  setReviewItem(null);
                  setActiveSubTab('capture');
                }}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 border ${
                  activeSubTab === 'capture'
                  ? 'bg-neon-blue/15 border-neon-blue/50 text-neon-blue shadow-glow-sm'
                  : 'bg-cyber-surface/60 border-cyber-border/60 text-cyber-muted hover:text-cyber-text hover:bg-white/5'
                }`}
              >
                <Camera size={16} />
                立即拍题
              </button>
            )}

            {/* 快捷导航按钮（嵌入模式下变为二选一切换）—— 两个独立小框，间距分隔 */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setActiveSubTab('wrong_problems');
                  if (embedded) onLockedSubTabChange?.('wrong_problems');
                }}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 border ${
                  activeSubTab === 'wrong_problems'
                  ? 'bg-rose-400/20 text-rose-300 border-rose-400/40 shadow-[0_0_8px_rgba(251,113,133,0.3)]'
                  : 'bg-cyber-surface/50 backdrop-blur-md text-cyber-muted border-cyber-border/60 hover:text-cyber-text hover:border-cyber-border'
                }`}
              >
                <XCircle size={16} />
                错题本
              </button>
              <button
                onClick={() => {
                  setActiveSubTab('archived_docs');
                  if (embedded) onLockedSubTabChange?.('archived_docs');
                }}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 border ${
                  activeSubTab === 'archived_docs'
                  ? 'bg-neon-purple/15 text-neon-purple border-neon-purple/40 shadow-[0_2px_8px_rgba(109,40,217,0.20)]'
                  : 'bg-cyber-surface/50 backdrop-blur-md text-cyber-muted border-cyber-border/60 hover:text-cyber-text hover:border-cyber-border'
                }`}
              >
                <FileText size={16} />
                试卷&作业原文件
              </button>
            </div>
          </div>


          {/* 搜索框 (仅在列表页显示) */}
          {activeSubTab === 'archived_docs' && (
            <>
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-cyber-muted" />
                <Input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索归档文档..."
                  className="pl-10 h-11"
                />
              </div>

              {/* 筛选器 */}
              <div className="flex items-center gap-2 flex-wrap">
                <Filter className="w-5 h-5 text-cyber-muted" />
                <select
                  value={filterSubject}
                  onChange={(e) => setFilterSubject(e.target.value)}
                  className="px-3 py-2 bg-cyber-bg2/60 border border-cyber-border/60 text-cyber-text rounded-lg text-sm hover:border-neon-blue/60 focus:border-neon-blue focus:outline-none transition-colors h-11 min-w-[120px]"
                >
                  <option value="all">全部学科</option>
                  {subjects.map((subject) => (
                      <option key={subject} value={subject}>
                        {subject}
                      </option>
                    ))}
                  </select>

                  <select
                    value={filterTime}
                    onChange={(e) => setFilterTime(e.target.value)}
                    className="px-3 py-2 bg-cyber-bg2/60 border border-cyber-border/60 text-cyber-text rounded-lg text-sm hover:border-neon-blue/60 focus:border-neon-blue focus:outline-none transition-colors h-11 min-w-[120px]"
                  >
                    <option value="all">全部时间</option>
                    <option value="today">今天</option>
                    <option value="week">最近7天</option>
                    <option value="month">最近30天</option>
                    <option value="custom">指定日期</option>
                  </select>

                  {filterTime === 'custom' && (
                    <div className="flex items-center gap-2 bg-cyber-bg2/60 p-1 rounded-lg border border-cyber-border/60">
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="bg-transparent border-none text-xs text-cyber-text focus:ring-0 px-1"
                      />
                      <span className="text-cyber-muted">-</span>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="bg-transparent border-none text-xs text-cyber-text focus:ring-0 px-1"
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          
          {/* 拍题页面占位/标题 */}
          {activeSubTab === 'capture' && <div className="flex-1" />}

          {/* 拍题入口（行最右）。
              Why: 原先在「学习资料」欢迎条上,会让欢迎条变得拥挤,且需要先理解整页布局
                   才知道点哪里拍题。挪到「错题/归档文件」按钮行最右,操作动线更短;
                   不论 activeSubTab 为何都常驻可见,避免在「拍题」子页里又看不到入口。 */}
          <button
            onClick={() => {
              setPreview(null);
              setReviewItem(null);
              setActiveSubTab('capture');
            }}
            className="md:ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border bg-gradient-to-r from-neon-blue/20 to-neon-purple/20 border-neon-blue/40 text-neon-blue hover:shadow-glow-sm hover:border-neon-blue/70 transition-all whitespace-nowrap"
          >
            <Plus size={16} />
            拍题
          </button>
        </div>
      </Card>

      <AnimatePresence mode="wait">
        {activeSubTab === 'wrong_problems' && (
          <motion.div
            key="wrong_problems"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            <UnifiedWrongBook currentUser={currentUser} scannedItems={userScannedItems} onDeleteScannedItem={onDeleteItem} onOpenQuizResult={onOpenQuizResult} onOpenPaperAttempt={onOpenPaperAttempt} />
          </motion.div>
        )}

        {activeSubTab === 'archived_docs' && (
          <motion.div
            key="archived_docs"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            <KnowledgeHub 
              items={userScannedItems} 
              currentUser={currentUser}
              searchQuery={searchQuery}
              filterSubject={filterSubject}
              filterTime={filterTime}
              startDate={startDate}
              endDate={endDate}
              filterType="archived" // 强制只显示归档文件
              onDelete={onDeleteItem}
            />
          </motion.div>
        )}

        {activeSubTab === 'capture' && (
          <motion.div
            key="capture"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {/* 原有的拍题/识别逻辑内容 */}
            {!preview && !isProcessing ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center min-h-[50vh] bg-cyber-surface/40 backdrop-blur-md rounded-3xl border-2 border-dashed border-cyber-border/60"
              >
                {/* 相机插画 */}
                <div className="relative w-48 h-48 mb-6">
                  <div className="absolute inset-0 bg-gradient-to-br from-neon-blue/30 to-neon-purple/30 rounded-full blur-2xl animate-pulse-slow" />
                  <div className="absolute inset-6 bg-cyber-surface/80 backdrop-blur-md border border-neon-blue/40 rounded-2xl shadow-glow-sm flex items-center justify-center">
                    <Camera size={60} className="text-neon-blue drop-shadow-[0_0_10px_rgba(31,111,178,0.35)]" />
                  </div>
                </div>

                <h3 className="text-xl font-bold mb-2 text-cyber-text">开始数字化采集</h3>
                <p className="text-cyber-muted mb-8">支持多张图片连拍，自动合并为整卷档案</p>

                <div className="flex flex-col sm:flex-row gap-4">
                  <Button
                    variant="primary"
                    size="lg"
                    icon={Upload}
                    onClick={() => fileInputRef.current?.click()}
                    className="px-10"
                  >
                    上传图片
                  </Button>
                </div>

                <input
                  id="file-input"
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                />
              </motion.div>
            ) : preview && !isProcessing ? (
              <Card className="p-8 space-y-6 max-w-2xl mx-auto">
                <div className="relative rounded-2xl overflow-hidden border-2 border-slate-100 shadow-inner bg-gray-50">
                  <img src={preview} className="max-h-[50vh] mx-auto object-contain" />
                  <button
                    onClick={() => setPreview(null)}
                    className="absolute top-4 right-4 bg-black/50 text-white w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
                  >
                    <FileText size={18} />
                  </button>
                </div>

                {processingError && (
                  <div className="bg-rose-400/10 text-rose-300 px-4 py-3 rounded-xl border border-rose-400/40 text-sm">
                    {processingError}
                  </div>
                )}

                <Button
                  variant="primary"
                  size="lg"
                  className="w-full h-14 text-lg font-bold shadow-lg shadow-sky-100"
                  onClick={handleProcess}
                  disabled={isProcessing}
                >
                  <i className="fa-solid fa-bolt mr-2"></i> 启动全维度解构识别
                </Button>
              </Card>
            ) : isProcessing ? (
              <div className="flex flex-col items-center justify-center min-h-[50vh]">
                <LoadingSpinner
                  size={48}
                  text={isProcessingBatch ? `已完成 ${currentProcessingIndex} / ${pendingImages.length} 张：${processingStage || '正在识别中...'}` : (processingStage || 'AI 正在识别中...')}
                />
                <p className="text-sm text-cyber-muted mt-4">正在通过专家模型还原原始版面，请稍候</p>

                {isProcessingBatch && pendingImages.length > 1 && (
                  <div className="mt-6 w-80">
                    <div className="flex justify-between text-xs text-cyber-muted mb-2">
                      <span>批量处理进度</span>
                      <span>{currentProcessingIndex} / {pendingImages.length}</span>
                    </div>
                    <div className="h-2 bg-cyber-bg2/60 rounded-full overflow-hidden border border-cyber-border/40">
                      <motion.div
                        className="h-full bg-gradient-to-r from-neon-blue to-neon-purple shadow-[0_0_8px_rgba(21,128,61,0.35)]"
                        initial={{ width: 0 }}
                        animate={{ width: `${(currentProcessingIndex / pendingImages.length) * 100}%` }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CaptureModule;
