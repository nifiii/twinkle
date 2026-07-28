import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, BookOpen, ChevronRight, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { ClassroomTaskDetail, ClassroomTaskSummary, fetchClassroomTask, fetchClassroomTasks, retryClassroomTask } from '../services/classroomTaskApi';
import ClassroomLegacyDetail from './ClassroomLegacyDetail';

interface ClassroomTaskHubProps {
  currentUser: { id: string; name: string };
  books: Array<{ id: string; title: string; subject?: string }>;
  subPath?: string;
  onOpenLegacy: (subPath: string) => void;
  onOpenHub: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  courseware: '课件',
  classroom_quiz: '随堂测验',
  wrong_review: '错题讲解与测验',
  english_listening: '英语听力',
  video: '视频学习',
  math_thinking: '思维训练',
  assessment: '模拟考试',
  quiz_result: '测验记录',
};

const STATUS_LABEL: Record<string, string> = {
  ready: '待学习',
  running: '生成中',
  failed: '生成失败',
  resource_unavailable: '资源不可用',
};

const SUBJECT_ORDER = ['语文', '数学', '英语', '科学'];
const TASK_GROUPS = [
  { title: '课件与随堂测验', types: ['courseware', 'classroom_quiz'] },
  { title: '错题讲解与测验', types: ['wrong_review'] },
  { title: '已下线的视频记录', types: ['video'] },
  { title: '试卷', types: ['assessment'] },
  { title: '其他训练', types: ['english_listening', 'math_thinking', 'quiz_result'] },
];

const nativePath = (link: ClassroomTaskSummary['primaryLink']): string | null => {
  if (!link) return null;
  if (link.entityType === 'learning_package') return `package/${link.entityId}`;
  if (link.entityType === 'assessment_paper') return `paper/${link.entityId}`;
  return null;
};

const ClassroomTaskHub: React.FC<ClassroomTaskHubProps> = ({ currentUser, books, subPath = '', onOpenLegacy, onOpenHub }) => {
  const taskId = subPath.startsWith('task/') ? decodeURIComponent(subPath.slice(5)) : '';
  const [items, setItems] = useState<ClassroomTaskSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [subject, setSubject] = useState('语文');
  const [detail, setDetail] = useState<ClassroomTaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const subjects = useMemo(() => {
    const available = new Set([...SUBJECT_ORDER, ...books.map(book => book.subject || '').filter(Boolean)]);
    return [...available].sort((left, right) => {
      const leftIndex = SUBJECT_ORDER.indexOf(left);
      const rightIndex = SUBJECT_ORDER.indexOf(right);
      return (leftIndex === -1 ? SUBJECT_ORDER.length : leftIndex) - (rightIndex === -1 ? SUBJECT_ORDER.length : rightIndex) || left.localeCompare(right, 'zh-CN');
    });
  }, [books]);

  const load = async (cursor?: string, append = false) => {
    if (append) setLoadingMore(true);
    else { setLoading(true); setError(''); }
    try {
      const page = await fetchClassroomTasks({ ownerId: currentUser.id, subject, status: 'ready', cursor, limit: 20 });
      setItems(previous => append ? [...previous, ...page.items] : page.items);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '智慧课堂读取失败');
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    if (!taskId) void load();
  }, [currentUser.id, subject, taskId]);

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

  const retry = async (item: ClassroomTaskSummary) => {
    if (item.source !== 'task' || retrying) return;
    setRetrying(true); setError('');
    try { await retryClassroomTask(item.id, currentUser.id); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '重试失败，请稍后再试'); }
    finally { setRetrying(false); }
  };

  const primaryAction = (item: ClassroomTaskSummary) => {
    if (item.taskType === 'video') {
      return <button type="button" onClick={() => onOpenLegacy(`task/${encodeURIComponent(item.id)}`)} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-cyber-border px-3 text-sm font-medium text-cyber-muted transition-colors hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-neon-blue">查看说明 <ChevronRight size={16} /></button>;
    }
    if (item.generationStatus === 'running') return <span className="inline-flex min-h-10 items-center gap-2 text-sm text-cyber-muted"><Loader2 size={16} className="animate-spin" />正在生成</span>;
    if (item.generationStatus !== 'ready') {
      return item.source === 'task'
        ? <button type="button" onClick={() => void retry(item)} disabled={retrying} className="min-h-10 rounded-lg border border-neon-blue px-3 text-sm font-medium text-neon-blue transition-colors hover:bg-neon-blue/10 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-neon-blue">{retrying ? '正在重试' : '重新生成'}</button>
        : <span className="text-sm text-cyber-muted">{STATUS_LABEL[item.generationStatus] || '暂不可用'}</span>;
    }
    return <button type="button" onClick={() => onOpenLegacy(`task/${encodeURIComponent(item.id)}`)} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-neon-blue px-3 text-sm font-medium text-neon-blue transition-colors hover:bg-neon-blue/10 focus:outline-none focus:ring-2 focus:ring-neon-blue">继续学习 <ChevronRight size={16} /></button>;
  };

  if (taskId && detail?.primaryLink && ['classroom_courseware', 'classroom_quiz', 'quiz_result'].includes(detail.primaryLink.entityType)) {
    return <ClassroomLegacyDetail task={detail} currentUser={currentUser} onBack={onOpenHub} onOpenTask={(id) => onOpenLegacy(`task/${encodeURIComponent(id)}`)} />;
  }

  if (taskId) {
    return <section className="mx-auto max-w-4xl space-y-5" aria-labelledby="task-detail-title">
      <button type="button" onClick={onOpenHub} className="inline-flex min-h-10 items-center gap-2 text-sm text-neon-blue focus:outline-none focus:ring-2 focus:ring-neon-blue"><ArrowLeft size={18} />返回智慧课堂</button>
      {error && <div role="alert" className="flex gap-2 border border-red-300 bg-red-50 p-3 text-sm text-red-800"><AlertCircle size={18} />{error}</div>}
      {detailLoading ? <div role="status" className="flex items-center gap-2 py-12 text-cyber-muted"><Loader2 className="animate-spin" />正在读取学习任务</div> : detail ? <article className="border border-cyber-border bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-neon-blue">{TYPE_LABEL[detail.taskType] || detail.taskType}</p><h1 id="task-detail-title" className="mt-1 text-xl font-semibold text-cyber-text">{detail.title}</h1><p className="mt-2 text-sm text-cyber-muted">{detail.book?.title || '独立学习内容'}{detail.chapterTitles.length ? ` · ${detail.chapterTitles.join('、')}` : ''}</p></div><span className="border border-cyber-border px-3 py-1 text-sm text-cyber-muted">{STATUS_LABEL[detail.generationStatus] || detail.generationStatus}</span></div>{detail.taskType === 'video' ? <div className="mt-6 flex items-start gap-2 border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertCircle size={18} />视频学习已取消，历史任务仅保留记录，不再提供搜索或播放。</div> : detail.generationStatus !== 'ready' ? <div className="mt-6 flex items-start gap-2 border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertCircle size={18} />{detail.errorMessage || '该学习任务暂不可继续，请返回智慧课堂后重试。'}</div> : nativePath(detail.primaryLink) ? <button type="button" onClick={() => onOpenLegacy(nativePath(detail.primaryLink)!)} className="mt-6 min-h-11 bg-neon-blue px-4 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-neon-blue">开始学习</button> : <div className="mt-6 flex items-start gap-2 border border-cyber-border p-4 text-sm text-cyber-muted"><BookOpen size={18} />该学习内容暂不支持继续学习。</div>}</article> : <div role="status" className="border border-cyber-border p-5 text-sm text-cyber-muted">未找到该学习任务。</div>}
    </section>;
  }

  const groupedItems = TASK_GROUPS.map(group => ({ ...group, items: items.filter(item => group.types.includes(item.taskType)) })).filter(group => group.items.length > 0);
  return <section className="mx-auto max-w-6xl space-y-6 animate-fade-in" aria-labelledby="classroom-title">
    <header className="bg-cyber-surface/60 backdrop-blur-md rounded-2xl border border-cyber-border/60 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-neon-blue/15 shadow-glow-sm"><Sparkles className="text-neon-blue" size={24} aria-hidden="true" /></div>
          <div><h1 id="classroom-title" className="text-xl font-bold tracking-tight bg-gradient-to-r from-neon-blue via-cyber-text to-neon-purple bg-clip-text text-transparent">{currentUser.name} 的智慧课堂</h1><p className="mt-1 text-sm text-cyber-muted">按学科查看待完成的学习任务</p></div>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyber-border/60 px-3 text-sm text-cyber-text transition-colors hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-neon-blue"><RefreshCw size={16} />刷新</button>
      </div>
    </header>
    <div role="tablist" aria-label="按学科查看待学习任务" className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-cyber-border/60 bg-cyber-surface/50 p-1 backdrop-blur-md">{subjects.map(value => <button key={value} type="button" role="tab" aria-selected={subject === value} onClick={() => setSubject(value)} className={`min-h-10 shrink-0 rounded-xl border px-4 py-2 text-sm font-medium transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-neon-blue ${subject === value ? 'border-neon-blue/40 bg-gradient-to-r from-neon-blue/25 to-neon-purple/20 text-neon-blue shadow-glow-sm' : 'border-transparent text-cyber-muted hover:bg-white/5 hover:text-cyber-text'}`}>{value}</button>)}</div>
    {error && <div role="alert" className="flex gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800"><AlertCircle size={18} />{error}</div>}
    {loading ? <div role="status" className="flex min-h-48 items-center justify-center gap-2 rounded-2xl border border-cyber-border/60 bg-cyber-surface/50 text-cyber-muted"><Loader2 className="animate-spin" />正在读取{subject}待学习任务</div> : !groupedItems.length ? <div role="status" className="rounded-2xl border border-cyber-border/60 bg-cyber-surface/50 p-10 text-center text-sm text-cyber-muted">{subject}暂时没有待学习任务。可前往学习小助手创建内容。</div> : <div className="space-y-6">{groupedItems.map(group => <section key={group.title} aria-labelledby={`group-${group.title}`} className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 id={`group-${group.title}`} className="text-base font-semibold text-cyber-text">{group.title}</h2><span className="rounded-lg bg-white/5 px-2 py-1 text-sm text-cyber-muted">{group.items.length} 项待学习</span></div><div className="space-y-3">{group.items.map(item => <article key={item.id} className="grid gap-3 rounded-xl border border-cyber-border/60 bg-cyber-surface/60 p-4 shadow-glow-sm md:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-neon-blue/10 px-2 py-1 text-xs font-medium text-neon-blue">{TYPE_LABEL[item.taskType] || item.taskType}</span>{item.source === 'legacy' && <span className="text-xs text-cyber-muted">历史内容</span>}</div><h3 className="mt-2 break-words text-base font-semibold text-cyber-text">{item.title}</h3><p className="mt-1 break-words text-sm text-cyber-muted">{item.book?.title || '独立学习内容'}{item.chapterTitles.length ? ` · ${item.chapterTitles.join('、')}` : ''}</p></div><div className="flex items-center md:justify-end">{primaryAction(item)}</div></article>)}</div></section>)}</div>}
    {nextCursor && <button type="button" disabled={loadingMore} onClick={() => void load(nextCursor, true)} className="min-h-11 w-full rounded-xl border border-cyber-border/60 bg-cyber-surface/50 text-sm text-cyber-text transition-colors hover:bg-white/5 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-neon-blue">{loadingMore ? '正在加载' : '加载更多'}</button>}
  </section>;
};

export default ClassroomTaskHub;
