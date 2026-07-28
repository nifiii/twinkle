import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BookOpen, BrainCircuit, CheckCircle2, ClipboardCheck, FileText, Headphones, Loader2, PlayCircle, Sparkles, Video } from 'lucide-react';
import { EBook, IndexStatus, UserProfile } from '../types';
import { fetchBooks } from '../services/apiService';
import { ChapterAction, createTextbookTask, createWrongReviewTask, fetchChapterActions, fetchWrongProblemCandidates, TextbookTaskAction, WrongProblemCandidate } from '../services/learningAssistantApi';

const refKey = (item: WrongProblemCandidate) => `${item.source}:${item.source === 'scanned_item' ? item.scannedItemId : item.quizResultId}:${item.problemIndex}`;

interface LearningAssistantProps {
  currentUser: UserProfile;
  view: 'wrong' | 'textbook';
  onViewChange: (view: 'wrong' | 'textbook') => void;
  onOpenClassroom: () => void;
}

type ChapterOption = { id: string; title: string; breadcrumb: string };

const ACTION_COPY: Record<TextbookTaskAction, { label: string; description: string; icon: typeof BookOpen }> = {
  courseware: { label: '生成课件', description: '把本章重点整理成可学习的课件', icon: BookOpen },
  classroom_quiz: { label: '随堂测验', description: '围绕本章知识点练一练', icon: ClipboardCheck },
  english_listening: { label: '英语听力', description: '用本章内容生成原创听力练习', icon: Headphones },
  video: { label: '视频学习', description: '播放已审核的公开视频', icon: Video },
  math_thinking: { label: '思维训练', description: '围绕本章进行数学思维练习', icon: BrainCircuit },
  assessment: { label: '模拟考试', description: '生成可网页作答及下载的试卷', icon: FileText },
};

const ACTION_REASON: Record<string, string> = {
  resource_unavailable: '暂无可核验资源',
  olympiad_material_unavailable: '暂无年级匹配的奥数资料',
  capability_unavailable: '当前教材暂不支持此学习内容',
};

const flattenChapters = (nodes: EBook['tableOfContents'], ancestors: string[] = []): ChapterOption[] => nodes.flatMap(node => {
  const breadcrumb = [...ancestors, node.title].filter(Boolean);
  return [{ id: node.id, title: node.title, breadcrumb: breadcrumb.join(' / ') }, ...flattenChapters(node.children || [], breadcrumb)];
});

const LearningAssistant: React.FC<LearningAssistantProps> = ({ currentUser, view, onViewChange, onOpenClassroom }) => {
  const [items, setItems] = useState<WrongProblemCandidate[]>([]);
  const [subject, setSubject] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [createdTitle, setCreatedTitle] = useState('');
  const [books, setBooks] = useState<EBook[]>([]);
  const [booksLoading, setBooksLoading] = useState(false);
  const [bookId, setBookId] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [chapterActions, setChapterActions] = useState<ChapterAction[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [textbookError, setTextbookError] = useState('');
  const [selectedAction, setSelectedAction] = useState<TextbookTaskAction | null>(null);
  const [resourceId, setResourceId] = useState('');
  const [examMode, setExamMode] = useState<'textbook' | 'olympiad'>('textbook');
  const [olympiadBookId, setOlympiadBookId] = useState('');
  const [examType, setExamType] = useState('unit');
  const [difficulty, setDifficulty] = useState('standard');
  const [textbookCreating, setTextbookCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    fetchWrongProblemCandidates(currentUser.id)
      .then(data => { if (!cancelled) { setItems(data); setSubject(current => data.some(item => item.subject === current) ? current : (data[0]?.subject || '')); } })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '错题读取失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentUser.id]);

  useEffect(() => {
    if (view !== 'textbook') return;
    let cancelled = false;
    setBooksLoading(true); setTextbookError('');
    fetchBooks({ ownerId: currentUser.id })
      .then(data => { if (!cancelled) { setBooks(data); setBookId(current => data.some(book => book.id === current) ? current : (data.find(book => book.indexStatus === IndexStatus.INDEXED)?.id || '')); } })
      .catch(reason => { if (!cancelled) setTextbookError(reason instanceof Error ? reason.message : '教材读取失败'); })
      .finally(() => { if (!cancelled) setBooksLoading(false); });
    return () => { cancelled = true; };
  }, [currentUser.id, view]);

  const selectedBook = useMemo(() => books.find(book => book.id === bookId), [books, bookId]);
  const chapters = useMemo(() => selectedBook ? flattenChapters(selectedBook.tableOfContents) : [], [selectedBook]);

  useEffect(() => {
    setChapterId(current => chapters.some(chapter => chapter.id === current) ? current : (chapters[0]?.id || ''));
  }, [bookId, chapters]);

  useEffect(() => {
    if (view !== 'textbook' || !bookId || !chapterId) { setChapterActions([]); return; }
    let cancelled = false;
    setActionsLoading(true); setTextbookError(''); setSelectedAction(null);
    fetchChapterActions({ ownerId: currentUser.id, bookId, chapterId })
      .then(data => { if (!cancelled) setChapterActions(data); })
      .catch(reason => { if (!cancelled) setTextbookError(reason instanceof Error ? reason.message : '章节能力读取失败'); })
      .finally(() => { if (!cancelled) setActionsLoading(false); });
    return () => { cancelled = true; };
  }, [bookId, chapterId, currentUser.id, view]);

  const subjects = useMemo(() => [...new Set(items.map(item => item.subject))], [items]);
  const visibleItems = useMemo(() => items.filter(item => item.subject === subject), [items, subject]);
  const selectedItems = useMemo(() => visibleItems.filter(item => selected.has(refKey(item))), [visibleItems, selected]);
  const knowledgePoints = useMemo(() => [...new Set(selectedItems.flatMap(item => item.knowledgePoints))], [selectedItems]);

  const toggle = (item: WrongProblemCandidate) => {
    const key = refKey(item);
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else if (next.size < 10) next.add(key);
      return next;
    });
  };

  const create = async () => {
    if (!selectedItems.length || creating) return;
    setCreating(true); setError(''); setCreatedTitle('');
    try {
      const task = await createWrongReviewTask({ ownerId: currentUser.id, userName: currentUser.name, grade: currentUser.grade, subject, problems: selectedItems.map(item => item.source === 'scanned_item' ? { source: item.source, scannedItemId: item.scannedItemId, problemIndex: item.problemIndex } : { source: item.source, quizResultId: item.quizResultId, problemIndex: item.problemIndex }) });
      setCreatedTitle(task.title);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '生成失败，请稍后重试'); }
    finally { setCreating(false); }
  };

  const actionDetail = chapterActions.find(action => action.action === selectedAction);
  const selectedChapter = chapters.find(chapter => chapter.id === chapterId);
  const canCreateTextbookTask = Boolean(selectedAction && actionDetail?.available && !textbookCreating &&
    (selectedAction !== 'video' || resourceId) &&
    (selectedAction !== 'assessment' || examMode !== 'olympiad' || olympiadBookId));

  const selectAction = (action: ChapterAction) => {
    if (!action.available) return;
    setSelectedAction(action.action);
    setTextbookError('');
    setResourceId(action.resourceOptions?.[0]?.id || '');
    setExamMode(action.examModes?.includes('textbook') ? 'textbook' : (action.examModes?.[0] || 'textbook'));
    setOlympiadBookId(action.olympiadMaterials?.[0]?.id || '');
  };

  const createTextbook = async () => {
    if (!selectedAction || !selectedBook || !selectedChapter || !canCreateTextbookTask) return;
    setTextbookCreating(true); setTextbookError(''); setCreatedTitle('');
    const options: Record<string, string> = {};
    if (selectedAction === 'video') options.resourceId = resourceId;
    if (selectedAction === 'assessment') {
      options.examMode = examMode; options.examType = examType; options.difficulty = difficulty;
      if (examMode === 'olympiad') options.olympiadBookId = olympiadBookId;
    }
    try {
      const task = await createTextbookTask({ ownerId: currentUser.id, userName: currentUser.name, taskType: selectedAction, bookId: selectedBook.id, chapterId: selectedChapter.id, options });
      setCreatedTitle(task.title);
    } catch (reason) { setTextbookError(reason instanceof Error ? reason.message : '生成失败，请稍后重试'); }
    finally { setTextbookCreating(false); }
  };

  return <section className="mx-auto max-w-6xl space-y-6" aria-labelledby="assistant-title">
    <header className="flex items-center gap-3 border-b border-cyber-border pb-5"><Sparkles className="text-neon-blue" aria-hidden="true" /><div><h1 id="assistant-title" className="text-2xl font-semibold text-cyber-text">学习小助手</h1><p className="mt-1 text-sm text-cyber-muted">{currentUser.name} 的教材学习、错题讲解与测验</p></div></header>
    <div role="tablist" aria-label="学习来源" className="flex gap-2 overflow-x-auto"><button type="button" role="tab" aria-selected={view === 'textbook'} onClick={() => onViewChange('textbook')} className={`min-h-11 border-b-2 px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-neon-blue ${view === 'textbook' ? 'border-neon-blue text-neon-blue' : 'border-transparent text-cyber-muted'}`}>教材章节学习</button><button type="button" role="tab" aria-selected={view === 'wrong'} onClick={() => onViewChange('wrong')} className={`min-h-11 border-b-2 px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-neon-blue ${view === 'wrong' ? 'border-neon-blue text-neon-blue' : 'border-transparent text-cyber-muted'}`}>错题讲解与测验</button></div>
    {view === 'wrong' && error && <div role="alert" className="flex items-center gap-2 border border-red-300 bg-red-50 p-3 text-sm text-red-800"><AlertCircle size={18} />{error}</div>}
    {createdTitle && <div role="status" className="flex flex-wrap items-center justify-between gap-3 border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900"><span className="flex items-center gap-2"><CheckCircle2 size={18} />已生成“{createdTitle}”</span><button type="button" onClick={onOpenClassroom} className="min-h-11 border border-emerald-700 px-3 font-medium text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-700">进入智慧课堂</button></div>}
    {view === 'wrong' && (loading ? <div role="status" className="flex items-center gap-2 py-12 text-cyber-muted"><Loader2 className="animate-spin" />正在读取错题</div> : !items.length ? <div role="status" className="border border-cyber-border p-8 text-sm text-cyber-muted">暂无可用于讲解的错题。</div> : <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]"><div className="space-y-3"><label className="grid gap-2 text-sm font-medium text-cyber-text">学科<select value={subject} onChange={event => { setSubject(event.target.value); setSelected(new Set()); }} className="min-h-11 border border-cyber-border bg-white px-3 text-base text-slate-800 focus:outline-none focus:ring-2 focus:ring-neon-blue">{subjects.map(value => <option key={value}>{value}</option>)}</select></label>{visibleItems.map(item => { const checked = selected.has(refKey(item)); return <label key={refKey(item)} className="flex gap-3 border border-cyber-border p-4 text-left"><input type="checkbox" checked={checked} onChange={() => toggle(item)} className="mt-1 h-4 w-4" /><span className="min-w-0"><span className="text-sm font-medium text-cyber-text">{item.title}</span><span className="mt-1 block break-words text-sm text-cyber-muted">{item.contentExcerpt}</span>{item.knowledgePoints.length > 0 && <span className="mt-2 block text-xs text-neon-blue">{item.knowledgePoints.join(' · ')}</span>}</span></label>; })}</div><aside className="border border-cyber-border p-4"><div className="flex items-center gap-2 text-sm font-semibold text-cyber-text"><ClipboardCheck size={18} />本次选择</div><p className="mt-3 text-sm text-cyber-muted">已选 {selectedItems.length}/10 题</p>{knowledgePoints.length > 0 && <p className="mt-3 text-sm text-cyber-muted">{knowledgePoints.join(' · ')}</p>}<button type="button" disabled={!selectedItems.length || creating} onClick={create} className="mt-6 min-h-11 w-full bg-neon-blue px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-neon-blue">{creating ? '正在生成讲解与测验' : '生成讲解与测验'}</button></aside></div>)}
    {view === 'textbook' && <section aria-label="教材章节学习" className="space-y-5">
      {textbookError && <div role="alert" className="flex items-center gap-2 border border-red-300 bg-red-50 p-3 text-sm text-red-800"><AlertCircle size={18} />{textbookError}</div>}
      {booksLoading ? <div role="status" className="flex items-center gap-2 py-12 text-cyber-muted"><Loader2 className="animate-spin" />正在读取教材</div> : !books.length ? <div role="status" className="border border-cyber-border p-8 text-sm text-cyber-muted">暂无已上传教材。上传并完成解析后可按章节创建学习内容。</div> : <>
        <div className="grid gap-4 md:grid-cols-2"><label className="grid gap-2 text-sm font-medium text-cyber-text">教材<select value={bookId} onChange={event => setBookId(event.target.value)} className="min-h-11 border border-cyber-border bg-white px-3 text-base text-slate-800 focus:outline-none focus:ring-2 focus:ring-neon-blue">{books.map(book => <option key={book.id} value={book.id} disabled={book.indexStatus !== IndexStatus.INDEXED}>{book.title}{book.indexStatus !== IndexStatus.INDEXED ? '（解析中）' : ''}</option>)}</select></label><label className="grid gap-2 text-sm font-medium text-cyber-text">具体章节<select value={chapterId} onChange={event => setChapterId(event.target.value)} disabled={!chapters.length} className="min-h-11 border border-cyber-border bg-white px-3 text-base text-slate-800 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-neon-blue">{chapters.length ? chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.breadcrumb}</option>) : <option>暂无可用章节</option>}</select></label></div>
        {!selectedBook || selectedBook.indexStatus !== IndexStatus.INDEXED ? <div role="status" className="border border-cyber-border p-5 text-sm text-cyber-muted">请先选择已完成解析且包含目录的教材。</div> : !chapters.length ? <div role="status" className="border border-cyber-border p-5 text-sm text-cyber-muted">该教材暂无可用章节目录。</div> : actionsLoading ? <div role="status" className="flex items-center gap-2 py-8 text-cyber-muted"><Loader2 className="animate-spin" />正在检查本章可用学习内容</div> : <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{chapterActions.map(action => { const detail = ACTION_COPY[action.action]; const Icon = detail.icon; return <button type="button" key={action.action} disabled={!action.available} onClick={() => selectAction(action)} className={`min-h-32 border p-4 text-left focus:outline-none focus:ring-2 focus:ring-neon-blue disabled:cursor-not-allowed ${selectedAction === action.action ? 'border-neon-blue bg-neon-blue/10' : 'border-cyber-border bg-white'} ${!action.available ? 'opacity-55' : ''}`}><Icon size={20} className="text-neon-blue" /><span className="mt-3 block text-sm font-semibold text-cyber-text">{detail.label}</span><span className="mt-1 block text-xs leading-5 text-cyber-muted">{action.available ? detail.description : ACTION_REASON[action.reasonCode || ''] || '当前不可用'}</span></button>; })}</div>
          {selectedAction && actionDetail && <aside className="border border-cyber-border bg-white p-4"><div className="flex items-center gap-2 text-sm font-semibold text-cyber-text"><PlayCircle size={18} className="text-neon-blue" />{ACTION_COPY[selectedAction].label}</div><p className="mt-2 text-sm text-cyber-muted">《{selectedBook.title}》· {selectedChapter?.breadcrumb}</p>{selectedAction === 'video' && <label className="mt-4 grid gap-2 text-sm font-medium text-cyber-text">视频资源<select value={resourceId} onChange={event => setResourceId(event.target.value)} className="min-h-11 border border-cyber-border bg-white px-3 text-base text-slate-800 focus:outline-none focus:ring-2 focus:ring-neon-blue">{actionDetail.resourceOptions?.map(resource => <option key={resource.id} value={resource.id}>{resource.title} · {Math.ceil(resource.durationSeconds / 60)} 分钟 · {resource.ageLabel}</option>)}</select></label>}{selectedAction === 'assessment' && <div className="mt-4 grid gap-4 md:grid-cols-3"><label className="grid gap-2 text-sm font-medium text-cyber-text">范围<span className="min-h-11 border border-cyber-border bg-slate-50 px-3 py-3 text-slate-600">当前章节</span></label><label className="grid gap-2 text-sm font-medium text-cyber-text">类型<select value={examType} onChange={event => setExamType(event.target.value)} className="min-h-11 border border-cyber-border bg-white px-3 text-base text-slate-800"><option value="unit">单元测试</option><option value="midterm">期中测试</option><option value="final">期末测试</option></select></label><label className="grid gap-2 text-sm font-medium text-cyber-text">难度<select value={difficulty} onChange={event => setDifficulty(event.target.value)} className="min-h-11 border border-cyber-border bg-white px-3 text-base text-slate-800"><option value="basic">基础</option><option value="standard">标准</option><option value="challenge">挑战</option></select></label>{actionDetail.examModes?.includes('olympiad') && <><label className="grid gap-2 text-sm font-medium text-cyber-text">模式<select value={examMode} onChange={event => setExamMode(event.target.value as 'textbook' | 'olympiad')} className="min-h-11 border border-cyber-border bg-white px-3 text-base text-slate-800"><option value="textbook">教材模拟</option><option value="olympiad">奥数模拟</option></select></label>{examMode === 'olympiad' && <label className="grid gap-2 text-sm font-medium text-cyber-text md:col-span-2">奥数资料<select value={olympiadBookId} onChange={event => setOlympiadBookId(event.target.value)} className="min-h-11 border border-cyber-border bg-white px-3 text-base text-slate-800">{actionDetail.olympiadMaterials?.map(material => <option key={material.id} value={material.id}>{material.title}</option>)}</select></label>}</>}</div>}<button type="button" disabled={!canCreateTextbookTask} onClick={createTextbook} className="mt-5 min-h-11 w-full bg-neon-blue px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-neon-blue">{textbookCreating ? '正在创建学习任务' : `创建${ACTION_COPY[selectedAction].label}`}</button></aside>}
        </>}
      </>}
    </section>}
  </section>;
};

export default LearningAssistant;
