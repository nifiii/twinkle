import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Calendar, ChevronRight, ClipboardCheck, FileText, Loader2, RotateCcw, Search, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { DocType, ScannedItem, UserProfile } from '../types';
import { Badge, Card, Input, LoadingSpinner } from './ui';
import { PaperDetailModal } from './KnowledgeHub';
import { fetchUnifiedWrongBook, UnifiedWrongBookItem, UnifiedWrongBookPage, UnifiedWrongBookSource } from '../services/unifiedWrongBookApi';

type TimeFilter = 'all' | 'today' | 'week' | 'month' | 'custom';

interface UnifiedWrongBookProps {
  currentUser: UserProfile;
  scannedItems: ScannedItem[];
  onDeleteScannedItem?: (id: string) => void | Promise<void>;
  onOpenQuizResult: (resultId: string) => void;
}

const SOURCE_OPTIONS: Array<{ id: UnifiedWrongBookSource; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'scanned_item', label: '拍题归档' },
  { id: 'quiz_result', label: '课堂作答' },
];

const initialPage: UnifiedWrongBookPage = {
  items: [],
  nextCursor: null,
  sources: {
    scanned_item: { status: 'ok', count: 0, skippedCount: 0 },
    quiz_result: { status: 'ok', count: 0, skippedCount: 0 },
  },
};

function dateRange(filter: TimeFilter, startDate: string, endDate: string): { from?: string; to?: string } {
  if (filter === 'all') return {};
  const now = new Date();
  if (filter === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { from: start.toISOString(), to: now.toISOString() };
  }
  if (filter === 'week' || filter === 'month') {
    const start = new Date(now);
    start.setDate(start.getDate() - (filter === 'week' ? 7 : 30));
    return { from: start.toISOString(), to: now.toISOString() };
  }
  return {
    from: startDate ? new Date(`${startDate}T00:00:00`).toISOString() : undefined,
    to: endDate ? new Date(`${endDate}T23:59:59.999`).toISOString() : undefined,
  };
}

const SourceBadge: React.FC<{ source: UnifiedWrongBookItem['source'] }> = ({ source }) => (
  <Badge size="sm" className={source === 'scanned_item' ? 'border-neon-blue/40 bg-neon-blue/10 text-neon-blue' : 'border-neon-purple/40 bg-neon-purple/10 text-neon-purple'}>
    {source === 'scanned_item' ? <FileText size={14} /> : <ClipboardCheck size={14} />}
    {source === 'scanned_item' ? '拍题归档' : '课堂作答'}
  </Badge>
);

const UnifiedWrongBook: React.FC<UnifiedWrongBookProps> = ({ currentUser, scannedItems, onDeleteScannedItem, onOpenQuizResult }) => {
  const [source, setSource] = useState<UnifiedWrongBookSource>('all');
  const [subject, setSubject] = useState('');
  const [time, setTime] = useState<TimeFilter>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(initialPage);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [retryToken, setRetryToken] = useState(0);
  const [selectedItem, setSelectedItem] = useState<ScannedItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const subjects = useMemo(() => Array.from(new Set(['语文', '数学', '英语', '科学', ...page.items.map(item => item.subject)])).filter(Boolean), [page.items]);
  const localScannedItems = useMemo(() => new Map(scannedItems.filter(item => item.ownerId === currentUser.id).map(item => [item.id, item])), [currentUser.id, scannedItems]);
  const range = dateRange(time, startDate, endDate);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const result = await fetchUnifiedWrongBook({ ownerId: currentUser.id, source, subject: subject || undefined, query: query.trim() || undefined, ...range, signal: controller.signal });
        setPage(result);
      } catch (reason) {
        if ((reason as DOMException).name !== 'AbortError') setError(reason instanceof Error ? reason.message : '错题本读取失败，请稍后重试');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query ? 220 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [currentUser.id, source, subject, time, startDate, endDate, query, retryToken]);

  const loadMore = async () => {
    if (!page.nextCursor) return;
    setLoadingMore(true);
    try {
      const result = await fetchUnifiedWrongBook({ ownerId: currentUser.id, source, subject: subject || undefined, query: query.trim() || undefined, cursor: page.nextCursor, ...range });
      setPage(previous => ({ ...result, items: [...previous.items, ...result.items] }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '错题本读取失败，请稍后重试');
    } finally { setLoadingMore(false); }
  };

  const openItem = (item: UnifiedWrongBookItem) => {
    if (item.source === 'quiz_result') return onOpenQuizResult(item.detailTarget.id);
    const scannedItem = localScannedItems.get(item.detailTarget.id);
    if (scannedItem) setSelectedItem(scannedItem);
  };

  const deleteScannedItem = async (item: UnifiedWrongBookItem) => {
    if (item.source !== 'scanned_item' || !onDeleteScannedItem || !window.confirm('确定要永久删除这道归档错题吗？删除后不可恢复。')) return;
    setDeletingId(item.detailTarget.id);
    try {
      await onDeleteScannedItem(item.detailTarget.id);
      setRetryToken(value => value + 1);
    } finally { setDeletingId(null); }
  };

  const unavailableSources = (Object.entries(page.sources) as Array<[string, { status: string }]>).filter(([, status]) => status.status === 'unavailable');
  const hasActiveFilter = Boolean(source !== 'all' || subject || time !== 'all' || query || startDate || endDate);

  return <section className="mx-auto max-w-6xl space-y-5" aria-labelledby="unified-wrong-book-title">
    <div className="flex flex-col gap-4 border border-cyber-border/60 bg-cyber-surface/50 p-4 sm:p-5">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h2 id="unified-wrong-book-title" className="text-lg font-semibold text-cyber-text">统一错题本</h2>
          <p className="mt-1 text-sm text-cyber-muted">拍题归档与课堂作答分别保留原始详情和学习记录。</p>
        </div>
        <div role="tablist" aria-label="错题来源" className="grid grid-cols-3 border border-cyber-border/70 p-1 sm:flex sm:w-fit">
          {SOURCE_OPTIONS.map(option => <button key={option.id} type="button" role="tab" aria-selected={source === option.id} onClick={() => setSource(option.id)} className={`min-h-11 px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-neon-blue ${source === option.id ? 'bg-neon-blue/15 text-neon-blue' : 'text-cyber-muted hover:bg-white/5 hover:text-cyber-text'}`}>{option.label}</button>)}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_132px_132px]">
        <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cyber-muted" size={18} /><Input aria-label="搜索错题内容或知识点" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索题目或知识点" className="min-h-11 pl-10" /></div>
        <select aria-label="按学科筛选" value={subject} onChange={event => setSubject(event.target.value)} className="min-h-11 border border-cyber-border/60 bg-cyber-bg2/60 px-3 text-sm text-cyber-text focus:outline-none focus:ring-2 focus:ring-neon-blue"><option value="">全部学科</option>{subjects.map(value => <option key={value} value={value}>{value}</option>)}</select>
        <select aria-label="按时间筛选" value={time} onChange={event => setTime(event.target.value as TimeFilter)} className="min-h-11 border border-cyber-border/60 bg-cyber-bg2/60 px-3 text-sm text-cyber-text focus:outline-none focus:ring-2 focus:ring-neon-blue"><option value="all">全部时间</option><option value="today">今天</option><option value="week">最近 7 天</option><option value="month">最近 30 天</option><option value="custom">指定日期</option></select>
      </div>
      {time === 'custom' && <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><input aria-label="开始日期" type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className="min-h-11 border border-cyber-border/60 bg-cyber-bg2/60 px-3 text-sm text-cyber-text focus:outline-none focus:ring-2 focus:ring-neon-blue" /><span className="hidden text-cyber-muted sm:inline">至</span><input aria-label="结束日期" type="date" value={endDate} onChange={event => setEndDate(event.target.value)} className="min-h-11 border border-cyber-border/60 bg-cyber-bg2/60 px-3 text-sm text-cyber-text focus:outline-none focus:ring-2 focus:ring-neon-blue" /></div>}
    </div>

    {unavailableSources.length > 0 && <div role="status" className="flex flex-wrap items-center gap-3 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertCircle size={18} /><span>{unavailableSources.map(([key]) => key === 'scanned_item' ? '拍题归档' : '课堂作答').join('、')}暂时无法读取，其他错题仍可查看。</span><button type="button" onClick={() => setRetryToken(value => value + 1)} className="ml-auto inline-flex min-h-10 items-center gap-1 border border-amber-500 px-3 font-medium focus:outline-none focus:ring-2 focus:ring-neon-blue"><RotateCcw size={16} />重试</button></div>}
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 border border-red-300 bg-red-50 p-4 text-sm text-red-800"><AlertCircle size={18} /><span>{error}</span><button type="button" onClick={() => setRetryToken(value => value + 1)} className="ml-auto inline-flex min-h-10 items-center gap-1 border border-red-500 px-3 font-medium focus:outline-none focus:ring-2 focus:ring-neon-blue"><RotateCcw size={16} />重试</button></div>}
    {loading && page.items.length === 0 ? <div role="status" className="flex min-h-48 items-center justify-center"><LoadingSpinner size={32} text="正在读取错题本" /></div> : page.items.length === 0 ? <div className="border border-cyber-border/60 bg-cyber-surface/40 p-10 text-center"><ClipboardCheck className="mx-auto text-cyber-muted" size={36} /><h3 className="mt-4 text-base font-semibold text-cyber-text">{hasActiveFilter ? '当前筛选没有错题' : '还没有可复习的错题'}</h3><p className="mt-2 text-sm text-cyber-muted">{hasActiveFilter ? '可以清除筛选，或换一个来源查看。' : '拍题归档和完成课堂测验后的错题会显示在这里。'}</p>{hasActiveFilter && <button type="button" onClick={() => { setSource('all'); setSubject(''); setTime('all'); setStartDate(''); setEndDate(''); setQuery(''); }} className="mt-5 min-h-10 border border-neon-blue px-3 text-sm font-medium text-neon-blue focus:outline-none focus:ring-2 focus:ring-neon-blue">清除筛选</button>}</div> : <div className="space-y-3">
      <AnimatePresence initial={false}>{page.items.map(item => <motion.article key={item.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}><Card className="p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0 space-y-3"><div className="flex flex-wrap items-center gap-2"><SourceBadge source={item.source} /><Badge size="sm" variant="outline">{item.subject}</Badge><span className="inline-flex items-center gap-1 text-xs text-cyber-muted"><Calendar size={14} />{new Date(item.createdAt).toLocaleDateString('zh-CN')}</span></div><p className="text-base leading-7 text-cyber-text">{item.contentExcerpt}</p>{item.knowledgePoints.length > 0 && <div className="flex flex-wrap gap-2">{item.knowledgePoints.map(point => <Badge key={point} size="sm" variant="outline">{point}</Badge>)}</div>}</div><div className="flex shrink-0 flex-wrap gap-2"><button type="button" onClick={() => openItem(item)} disabled={item.source === 'scanned_item' && !localScannedItems.has(item.detailTarget.id)} className="inline-flex min-h-11 items-center gap-1 border border-neon-blue/60 px-3 text-sm font-medium text-neon-blue focus:outline-none focus:ring-2 focus:ring-neon-blue disabled:cursor-not-allowed disabled:opacity-50">{item.source === 'scanned_item' ? <FileText size={16} /> : <ClipboardCheck size={16} />}{item.source === 'scanned_item' ? '查看错题' : '查看测验详情'}<ChevronRight size={16} /></button>{item.source === 'scanned_item' && onDeleteScannedItem && <button type="button" aria-label="删除归档错题" title="删除归档错题" onClick={() => void deleteScannedItem(item)} disabled={deletingId === item.detailTarget.id} className="inline-flex min-h-11 items-center justify-center border border-red-300 px-3 text-red-700 focus:outline-none focus:ring-2 focus:ring-neon-blue disabled:opacity-50"><Trash2 size={17} /></button>}</div></div></Card></motion.article>)}</AnimatePresence>
      {page.nextCursor && <div className="flex justify-center"><button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="inline-flex min-h-11 items-center gap-2 border border-cyber-border px-4 text-sm font-medium text-cyber-text focus:outline-none focus:ring-2 focus:ring-neon-blue disabled:opacity-50">{loadingMore && <Loader2 className="animate-spin" size={16} />}加载更多</button></div>}
    </div>}
    {selectedItem && <PaperDetailModal item={{ ...selectedItem, meta: { ...selectedItem.meta, type: DocType.WRONG_PROBLEM } }} onClose={() => setSelectedItem(null)} />}
  </section>;
};

export default UnifiedWrongBook;
