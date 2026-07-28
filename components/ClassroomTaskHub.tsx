import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, BookOpen, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { ClassroomTaskDetail, ClassroomTaskSummary, fetchClassroomTask, fetchClassroomTasks, retryClassroomTask } from '../services/classroomTaskApi';

interface ClassroomTaskHubProps {
  currentUser: { id: string; name: string };
  subPath?: string;
  onOpenLegacy: (subPath: string) => void;
  onOpenHub: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  courseware: '课件', classroom_quiz: '随堂测验', wrong_review: '错题讲解与测验',
  english_listening: '英语听力', video: '视频学习', math_thinking: '思维训练', assessment: '模拟考试',
};

const STATUS_LABEL: Record<string, string> = {
  ready: '待学习', running: '生成中', failed: '生成失败', resource_unavailable: '资源不可用',
};

const nativePath = (link: ClassroomTaskSummary['primaryLink']): string | null => {
  if (!link) return null;
  if (link.entityType === 'classroom_courseware') return `courseware/${link.entityId}`;
  if (link.entityType === 'classroom_quiz') return `quiz/${link.entityId}`;
  return null;
};

const ClassroomTaskHub: React.FC<ClassroomTaskHubProps> = ({ currentUser, subPath = '', onOpenLegacy, onOpenHub }) => {
  const taskId = subPath.startsWith('task/') ? decodeURIComponent(subPath.slice(5)) : '';
  const [items, setItems] = useState<ClassroomTaskSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [subject, setSubject] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState<ClassroomTaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const load = async (cursor?: string, append = false) => {
    if (append) setLoadingMore(true); else { setLoading(true); setError(''); }
    try {
      const page = await fetchClassroomTasks({ ownerId: currentUser.id, subject: subject || undefined, type: type || undefined, status: status || undefined, cursor, limit: 20 });
      setItems(previous => append ? [...previous, ...page.items] : page.items);
      setNextCursor(page.nextCursor);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '智慧课堂读取失败'); }
    finally { if (append) setLoadingMore(false); else setLoading(false); }
  };

  useEffect(() => { if (!taskId) void load(); }, [currentUser.id, subject, type, status, taskId]);
  useEffect(() => {
    if (!taskId) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true); setError('');
    fetchClassroomTask(taskId, currentUser.id)
      .then(value => { if (!cancelled) setDetail(value); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '任务详情读取失败'); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [currentUser.id, taskId]);

  const subjects = useMemo(() => [...new Set(items.map(item => item.subject).filter(Boolean))], [items]);
  const types = useMemo(() => [...new Set(items.map(item => item.taskType))], [items]);
  const retry = async (item: ClassroomTaskSummary) => {
    if (item.source !== 'task' || retrying) return;
    setRetrying(true); setError('');
    try { await retryClassroomTask(item.id, currentUser.id); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '重试失败，请稍后再试'); }
    finally { setRetrying(false); }
  };
  const primaryAction = (item: ClassroomTaskSummary) => {
    if (item.generationStatus === 'running') return <span className="inline-flex min-h-10 items-center gap-2 text-sm text-cyber-muted"><Loader2 size={16} className="animate-spin" />正在生成</span>;
    if (item.generationStatus !== 'ready') return item.source === 'task' ? <button type="button" onClick={() => retry(item)} disabled={retrying} className="min-h-10 border border-neon-blue px-3 text-sm font-medium text-neon-blue disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-neon-blue">{retrying ? '正在重试' : '重新生成'}</button> : <span className="text-sm text-cyber-muted">{STATUS_LABEL[item.generationStatus] || '暂不可用'}</span>;
    return <button type="button" onClick={() => onOpenLegacy(`task/${encodeURIComponent(item.id)}`)} className="inline-flex min-h-10 items-center gap-1 border border-neon-blue px-3 text-sm font-medium text-neon-blue focus:outline-none focus:ring-2 focus:ring-neon-blue">继续学习 <ChevronRight size={16} /></button>;
  };

  if (taskId) return <section className="mx-auto max-w-4xl space-y-5" aria-labelledby="task-detail-title"><button type="button" onClick={onOpenHub} className="inline-flex min-h-10 items-center gap-2 text-sm text-neon-blue focus:outline-none focus:ring-2 focus:ring-neon-blue"><ArrowLeft size={18} />返回智慧课堂</button>{error && <div role="alert" className="flex gap-2 border border-red-300 bg-red-50 p-3 text-sm text-red-800"><AlertCircle size={18} />{error}</div>}{detailLoading ? <div role="status" className="flex items-center gap-2 py-12 text-cyber-muted"><Loader2 className="animate-spin" />正在读取学习任务</div> : detail && <article className="border border-cyber-border bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-neon-blue">{TYPE_LABEL[detail.taskType] || detail.taskType}</p><h1 id="task-detail-title" className="mt-1 text-xl font-semibold text-cyber-text">{detail.title}</h1><p className="mt-2 text-sm text-cyber-muted">{detail.book?.title || '独立学习内容'}{detail.chapterTitles.length ? ` · ${detail.chapterTitles.join('、')}` : ''}</p></div><span className="border border-cyber-border px-3 py-1 text-sm text-cyber-muted">{STATUS_LABEL[detail.generationStatus] || detail.generationStatus}</span></div>{detail.generationStatus !== 'ready' ? <div className="mt-6 flex items-start gap-2 border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertCircle size={18} />{detail.errorMessage || '该学习任务暂不可继续，请返回智慧课堂后重试。'}</div> : nativePath(detail.primaryLink) ? <button type="button" onClick={() => onOpenLegacy(nativePath(detail.primaryLink)!)} className="mt-6 min-h-11 bg-neon-blue px-4 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-neon-blue">开始学习</button> : <div className="mt-6 flex items-start gap-2 border border-cyber-border p-4 text-sm text-cyber-muted"><BookOpen size={18} />该学习内容将在后续详情适配中提供站内作答或播放。</div>}</article>}</section>;

  return <section className="mx-auto max-w-6xl space-y-5" aria-labelledby="classroom-title"><header className="flex flex-wrap items-end justify-between gap-3 border-b border-cyber-border pb-5"><div><h1 id="classroom-title" className="text-2xl font-semibold text-cyber-text">智慧课堂</h1><p className="mt-1 text-sm text-cyber-muted">{currentUser.name} 的学习任务与历史内容</p></div><button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 border border-cyber-border px-3 text-sm text-cyber-text focus:outline-none focus:ring-2 focus:ring-neon-blue"><RefreshCw size={16} />刷新</button></header>{error && <div role="alert" className="flex gap-2 border border-red-300 bg-red-50 p-3 text-sm text-red-800"><AlertCircle size={18} />{error}</div>}<div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1 text-sm text-cyber-text">学科<select value={subject} onChange={event => setSubject(event.target.value)} className="min-h-10 border border-cyber-border bg-white px-3 text-slate-800"><option value="">全部学科</option>{subjects.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label className="grid gap-1 text-sm text-cyber-text">内容类型<select value={type} onChange={event => setType(event.target.value)} className="min-h-10 border border-cyber-border bg-white px-3 text-slate-800"><option value="">全部类型</option>{types.map(value => <option key={value} value={value}>{TYPE_LABEL[value] || value}</option>)}</select></label><label className="grid gap-1 text-sm text-cyber-text">任务状态<select value={status} onChange={event => setStatus(event.target.value)} className="min-h-10 border border-cyber-border bg-white px-3 text-slate-800"><option value="">全部状态</option><option value="ready">待学习</option><option value="running">生成中</option><option value="failed">生成失败</option><option value="resource_unavailable">资源不可用</option></select></label></div>{loading ? <div role="status" className="flex items-center gap-2 py-16 text-cyber-muted"><Loader2 className="animate-spin" />正在读取智慧课堂</div> : !items.length ? <div role="status" className="border border-cyber-border p-10 text-center text-sm text-cyber-muted">暂无符合条件的学习任务。可前往学习小助手创建新内容。</div> : <div className="space-y-3">{items.map(item => <article key={item.id} className="grid gap-3 border border-cyber-border bg-white p-4 md:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-neon-blue">{TYPE_LABEL[item.taskType] || item.taskType}</span><span className="text-xs text-cyber-muted">{item.subject || '综合'}</span><span className="text-xs text-cyber-muted">{STATUS_LABEL[item.generationStatus] || item.generationStatus}</span>{item.source === 'legacy' && <span className="text-xs text-cyber-muted">历史内容</span>}</div><h2 className="mt-2 break-words text-base font-semibold text-cyber-text">{item.title}</h2><p className="mt-1 break-words text-sm text-cyber-muted">{item.book?.title || '独立学习内容'}{item.chapterTitles.length ? ` · ${item.chapterTitles.join('、')}` : ''}</p></div><div className="flex items-center md:justify-end">{primaryAction(item)}</div></article>)}</div>}{nextCursor && <button type="button" disabled={loadingMore} onClick={() => void load(nextCursor, true)} className="min-h-11 w-full border border-cyber-border text-sm text-cyber-text disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-neon-blue">{loadingMore ? '正在加载' : '加载更多'}</button>}</section>;
};

export default ClassroomTaskHub;
