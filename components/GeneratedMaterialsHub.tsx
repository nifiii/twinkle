import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BookMarked, ChevronRight, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { GeneratedLearningMaterial, fetchGeneratedLearningMaterials, retireGeneratedLearningMaterial } from '../services/classroomTaskApi';

const SUBJECTS = ['全部', '语文', '数学', '英语', '科学'];
const PROGRESS = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '待学习' },
  { id: 'completed', label: '已完成' },
] as const;
const TYPE_LABEL: Record<string, string> = {
  courseware: '学生自学课件', classroom_quiz: '随堂测验', wrong_review: '错题讲解与测验',
  english_listening: '英语听力', math_thinking: '思维训练', assessment: '模拟考试',
};
const STATUS_LABEL: Record<GeneratedLearningMaterial['learningStatus'], string> = {
  not_started: '待学习', in_progress: '学习中', completed: '已完成',
};

interface GeneratedMaterialsHubProps {
  currentUser: { id: string; name: string };
  onOpenTask: (taskId: string) => void;
}

const GeneratedMaterialsHub: React.FC<GeneratedMaterialsHubProps> = ({ currentUser, onOpenTask }) => {
  const [items, setItems] = useState<GeneratedLearningMaterial[]>([]);
  const [subject, setSubject] = useState('全部');
  const [progress, setProgress] = useState<'all' | 'pending' | 'completed'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<GeneratedLearningMaterial | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const page = await fetchGeneratedLearningMaterials({ ownerId: currentUser.id, subject: subject === '全部' ? undefined : subject, progress, limit: 100 });
      setItems(page.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '已生成学习资料读取失败，请稍后重试');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [currentUser.id, subject, progress]);

  const emptyMessage = useMemo(() => {
    if (subject === '全部' && progress === 'all') return '还没有已生成的学习资料。';
    return '当前筛选条件下没有学习资料。';
  }, [subject, progress]);

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true); setError('');
    try {
      await retireGeneratedLearningMaterial(pendingDelete.taskId, currentUser.id);
      setItems(current => current.filter(item => item.taskId !== pendingDelete.taskId));
      setPendingDelete(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '学习资料删除失败，请稍后重试');
    } finally { setDeleting(false); }
  };

  return <section className="space-y-5" aria-labelledby="generated-materials-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 id="generated-materials-title" className="text-lg font-semibold text-cyber-text">已生成学习资料</h2><p className="mt-1 text-sm text-cyber-muted">{currentUser.name} 的课件、测验、听力与模拟考试</p></div>
      <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyber-border/60 px-3 text-sm text-cyber-text hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-neon-blue"><RefreshCw size={16} />刷新</button>
    </div>

    <div className="space-y-3 rounded-2xl border border-cyber-border/60 bg-cyber-surface/40 p-3">
      <div role="tablist" aria-label="按学科筛选已生成学习资料" className="flex max-w-full gap-1 overflow-x-auto">
        {SUBJECTS.map(value => <button key={value} type="button" role="tab" aria-selected={subject === value} onClick={() => setSubject(value)} className={`min-h-10 shrink-0 rounded-lg border px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-neon-blue ${subject === value ? 'border-neon-blue/40 bg-neon-blue/15 text-neon-blue' : 'border-transparent text-cyber-muted hover:bg-white/5 hover:text-cyber-text'}`}>{value}</button>)}
      </div>
      <div role="tablist" aria-label="按进度筛选已生成学习资料" className="flex max-w-full gap-1 overflow-x-auto">
        {PROGRESS.map(option => <button key={option.id} type="button" role="tab" aria-selected={progress === option.id} onClick={() => setProgress(option.id)} className={`min-h-9 shrink-0 rounded-lg border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-neon-blue ${progress === option.id ? 'border-neon-purple/40 bg-neon-purple/15 text-neon-blue' : 'border-transparent text-cyber-muted hover:bg-white/5 hover:text-cyber-text'}`}>{option.label}</button>)}
      </div>
    </div>

    {error && <div role="alert" className="flex gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800"><AlertCircle size={18} />{error}</div>}
    {loading ? <div role="status" className="flex min-h-48 items-center justify-center gap-2 rounded-2xl border border-cyber-border/60 bg-cyber-surface/50 text-cyber-muted"><Loader2 className="animate-spin" />正在读取已生成学习资料</div>
      : !items.length ? <div role="status" className="rounded-2xl border border-cyber-border/60 bg-cyber-surface/50 p-10 text-center text-sm text-cyber-muted">{emptyMessage}</div>
        : <div className="divide-y divide-cyber-border/50 overflow-hidden rounded-2xl border border-cyber-border/60 bg-cyber-surface/50">
          {items.map(item => <article key={item.taskId} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-neon-blue/15 px-2 py-1 text-xs font-medium text-neon-blue">{item.subject}</span><span className="text-xs text-cyber-muted">{TYPE_LABEL[item.taskType] || item.taskType}</span><span className={`text-xs ${item.learningStatus === 'completed' ? 'text-emerald-300' : 'text-amber-300'}`}>{STATUS_LABEL[item.learningStatus]}</span></div><h3 className="mt-2 truncate text-base font-medium text-cyber-text">{item.title}</h3><p className="mt-1 truncate text-sm text-cyber-muted">{item.book?.title || '独立学习内容'}{item.chapterTitles.length ? ` · ${item.chapterTitles.join('、')}` : ''}</p></div>
            <div className="flex shrink-0 items-center gap-2"><button type="button" onClick={() => onOpenTask(item.taskId)} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-neon-blue px-3 text-sm font-medium text-neon-blue hover:bg-neon-blue/10 focus:outline-none focus:ring-2 focus:ring-neon-blue">继续学习 <ChevronRight size={16} /></button><button type="button" aria-label={`删除${item.title}`} title="删除学习资料" onClick={() => setPendingDelete(item)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-cyber-border text-cyber-muted hover:border-red-400 hover:bg-red-500/10 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-neon-blue"><Trash2 size={17} /></button></div>
          </article>)}
        </div>}

    {pendingDelete && <div role="dialog" aria-modal="true" aria-labelledby="delete-generated-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-md rounded-2xl border border-cyber-border bg-cyber-surface p-5 shadow-2xl"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/15 text-red-300"><BookMarked size={20} /></div><div><h3 id="delete-generated-title" className="font-semibold text-cyber-text">删除学习资料？</h3><p className="mt-1 text-sm text-cyber-muted">{pendingDelete.title}</p></div></div><p className="mt-4 text-sm leading-6 text-cyber-text">学习资料将下线，作答回顾和“需巩固”标记会保留。教材、上传试卷和错题原件不会删除。</p><div className="mt-5 flex justify-end gap-3"><button type="button" disabled={deleting} onClick={() => setPendingDelete(null)} className="min-h-10 rounded-lg border border-cyber-border px-4 text-sm text-cyber-text hover:bg-white/5 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-neon-blue">取消</button><button type="button" disabled={deleting} onClick={() => void confirmDelete()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-red-500 px-4 text-sm font-medium text-white hover:bg-red-400 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-neon-blue">{deleting && <Loader2 size={16} className="animate-spin" />}确认删除</button></div></div></div>}
  </section>;
};

export default GeneratedMaterialsHub;
