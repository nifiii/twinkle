import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BookOpen, BrainCircuit, CheckCircle2, ClipboardCheck, FileText, Headphones, Loader2, Sparkles, Trophy } from 'lucide-react';
import { EBook, IndexStatus, UserProfile } from '../types';
import { fetchBooks } from '../services/apiService';
import { ChapterAction, createOlympiadAssessmentTask, createTextbookTask, createWrongReviewTask, fetchChapterActions, fetchOlympiadMaterials, fetchWrongProblemCandidates, OlympiadMaterialOption, TextbookTaskAction, WrongProblemCandidate } from '../services/learningAssistantApi';

const refKey = (item: WrongProblemCandidate) => `${item.source}:${item.source === 'scanned_item' ? item.scannedItemId : item.quizResultId}:${item.problemIndex}`;

interface LearningAssistantProps {
  currentUser: UserProfile;
  view: 'wrong' | 'textbook';
  onViewChange: (view: 'wrong' | 'textbook') => void;
  onOpenClassroom: () => void;
}

type ChapterOption = { id: string; title: string; breadcrumb: string };
type TextbookMode = 'chapter' | 'olympiad';
type AssistantSource = 'textbook' | 'wrong' | 'olympiad';

const ACTION_COPY: Record<TextbookTaskAction, { label: string; description: string; icon: typeof BookOpen }> = {
  courseware: { label: '生成课件', description: '把本章重点整理成可学习的课件', icon: BookOpen },
  classroom_quiz: { label: '随堂测验', description: '围绕本章知识点练一练', icon: ClipboardCheck },
  english_listening: { label: '英语听力', description: '用本章内容生成原创听力练习', icon: Headphones },
  math_thinking: { label: '思维训练', description: '围绕本章进行数学思维练习', icon: BrainCircuit },
  assessment: { label: '模拟考试', description: '生成可网页作答及下载的试卷', icon: FileText },
};

const SOURCE_TABS: Array<{ id: AssistantSource; label: string; icon: typeof BookOpen }> = [
  { id: 'textbook', label: '教材章节学习', icon: BookOpen },
  { id: 'wrong', label: '错题讲解与测验', icon: ClipboardCheck },
  { id: 'olympiad', label: '奥数模拟考试', icon: Trophy },
];

const isOlympiadMaterial = (book: Pick<EBook, 'category' | 'tags'>): boolean => /奥数|数学竞赛/.test([book.category, ...book.tags].join(''));

const flattenChapters = (nodes: EBook['tableOfContents'], ancestors: string[] = []): ChapterOption[] => nodes.flatMap(node => {
  const breadcrumb = [...ancestors, node.title].filter(Boolean);
  const id = typeof node.id === 'string' || typeof node.id === 'number' ? String(node.id).trim() : '';
  // Catalog headings without stable IDs are display-only; submitting one would create an invalid task source.
  return [...(id ? [{ id, title: node.title, breadcrumb: breadcrumb.join(' / ') }] : []), ...flattenChapters(node.children || [], breadcrumb)];
});

const controlClass = 'min-h-11 rounded-xl border border-cyber-border/60 bg-cyber-surface/60 px-3 text-base text-cyber-text focus:outline-none focus:ring-2 focus:ring-neon-blue disabled:cursor-not-allowed disabled:opacity-60';

const LearningAssistant: React.FC<LearningAssistantProps> = ({ currentUser, view, onViewChange, onOpenClassroom }) => {
  const [items, setItems] = useState<WrongProblemCandidate[]>([]);
  const [subject, setSubject] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [createdTitle, setCreatedTitle] = useState('');
  const [books, setBooks] = useState<EBook[]>([]);
  const [materials, setMaterials] = useState<OlympiadMaterialOption[]>([]);
  const [booksLoading, setBooksLoading] = useState(false);
  const [bookId, setBookId] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [assessmentChapterIds, setAssessmentChapterIds] = useState<string[]>([]);
  const [chapterActions, setChapterActions] = useState<ChapterAction[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [textbookError, setTextbookError] = useState('');
  const [textbookMode, setTextbookMode] = useState<TextbookMode>('chapter');
  const [selectedAction, setSelectedAction] = useState<TextbookTaskAction | null>(null);
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
    Promise.all([fetchBooks({ ownerId: currentUser.id }), fetchOlympiadMaterials(currentUser.id)])
      .then(([bookData, materialData]) => {
        if (cancelled) return;
        const textbookBooks = bookData.filter(book => !isOlympiadMaterial(book));
        setBooks(textbookBooks);
        setMaterials(materialData);
        setBookId(current => textbookBooks.some(book => book.id === current) ? current : (textbookBooks.find(book => book.indexStatus === IndexStatus.INDEXED)?.id || ''));
        setOlympiadBookId(current => materialData.some(material => material.id === current) ? current : (materialData[0]?.id || ''));
      })
      .catch(reason => { if (!cancelled) setTextbookError(reason instanceof Error ? reason.message : '学习资料读取失败'); })
      .finally(() => { if (!cancelled) setBooksLoading(false); });
    return () => { cancelled = true; };
  }, [currentUser.id, view]);

  const selectedBook = useMemo(() => books.find(book => book.id === bookId), [books, bookId]);
  const chapters = useMemo(() => selectedBook ? flattenChapters(selectedBook.tableOfContents) : [], [selectedBook]);
  const selectedChapter = chapters.find(chapter => chapter.id === chapterId);
  const subjects = useMemo(() => [...new Set(items.map(item => item.subject))], [items]);
  const visibleItems = useMemo(() => items.filter(item => item.subject === subject), [items, subject]);
  const selectedItems = useMemo(() => visibleItems.filter(item => selected.has(refKey(item))), [visibleItems, selected]);
  const knowledgePoints = useMemo(() => [...new Set(selectedItems.flatMap(item => item.knowledgePoints))], [selectedItems]);
  const actionDetail = chapterActions.find(action => action.action === selectedAction);

  useEffect(() => {
    setChapterId(current => chapters.some(chapter => chapter.id === current) ? current : (chapters[0]?.id || ''));
  }, [bookId, chapters]);

  useEffect(() => {
    const available = new Set(chapters.map(chapter => chapter.id));
    setAssessmentChapterIds(current => {
      const selected = current.filter(id => available.has(id));
      return selected.length ? selected : (chapterId ? [chapterId] : []);
    });
  }, [chapterId, chapters]);

  useEffect(() => {
    // A book switch retains the previous chapter ID for one render. Wait until
    // that ID is confirmed in the new catalog so an obsolete request cannot
    // overwrite the valid chapter state with a transient error.
    if (view !== 'textbook' || textbookMode !== 'chapter' || !bookId || !chapterId || !selectedChapter) { setChapterActions([]); return; }
    let cancelled = false;
    setActionsLoading(true); setTextbookError(''); setSelectedAction(null);
    fetchChapterActions({ ownerId: currentUser.id, bookId, chapterId })
      .then(data => { if (!cancelled) setChapterActions(data); })
      .catch(reason => { if (!cancelled) setTextbookError(reason instanceof Error ? reason.message : '章节能力读取失败'); })
      .finally(() => { if (!cancelled) setActionsLoading(false); });
    return () => { cancelled = true; };
  }, [bookId, chapterId, currentUser.id, textbookMode, view]);

  const toggle = (item: WrongProblemCandidate) => {
    const key = refKey(item);
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else if (next.size < 10) next.add(key);
      return next;
    });
  };

  const createWrongReview = async () => {
    if (!selectedItems.length || creating) return;
    setCreating(true); setError(''); setCreatedTitle('');
    try {
      const task = await createWrongReviewTask({ ownerId: currentUser.id, userName: currentUser.name, grade: currentUser.grade, subject, problems: selectedItems.map(item => item.source === 'scanned_item' ? { source: item.source, scannedItemId: item.scannedItemId, problemIndex: item.problemIndex } : { source: item.source, quizResultId: item.quizResultId, problemIndex: item.problemIndex }) });
      setCreatedTitle(task.title);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '生成失败，请稍后重试'); }
    finally { setCreating(false); }
  };

  const selectAction = (action: ChapterAction) => {
    if (!action.available) return;
    if (action.action === 'assessment' && selectedChapter) {
      // The control declares a current-chapter scope. Flat catalogs may repeat
      // titles, so title-based grouping could silently include other chapters.
      setAssessmentChapterIds([selectedChapter.id]);
    }
    setSelectedAction(action.action);
    setTextbookError('');
  };

  const createChapterTask = async () => {
    if (!selectedAction || !selectedBook || !selectedChapter || !actionDetail?.available || textbookCreating) return;
    const chapterIds = selectedAction === 'assessment' ? assessmentChapterIds : [selectedChapter.id];
    if (!chapterIds.length) return;
    setTextbookCreating(true); setTextbookError(''); setCreatedTitle('');
    const options: Record<string, string> = selectedAction === 'assessment' ? { examType, difficulty } : {};
    try {
      const task = await createTextbookTask({ ownerId: currentUser.id, userName: currentUser.name, taskType: selectedAction, bookId: selectedBook.id, chapterIds, options });
      setCreatedTitle(task.title);
    } catch (reason) { setTextbookError(reason instanceof Error ? reason.message : '生成失败，请稍后重试'); }
    finally { setTextbookCreating(false); }
  };

  const createOlympiadTask = async () => {
    if (!olympiadBookId || textbookCreating) return;
    setTextbookCreating(true); setTextbookError(''); setCreatedTitle('');
    try {
      const task = await createOlympiadAssessmentTask({ ownerId: currentUser.id, userName: currentUser.name, olympiadBookId, examType, difficulty });
      setCreatedTitle(task.title);
    } catch (reason) { setTextbookError(reason instanceof Error ? reason.message : '生成失败，请稍后重试'); }
    finally { setTextbookCreating(false); }
  };

  const changeTextbookMode = (mode: TextbookMode) => {
    setTextbookMode(mode);
    setSelectedAction(null);
    setTextbookError('');
  };

  const selectSource = (source: AssistantSource) => {
    if (source === 'wrong') {
      onViewChange('wrong');
      return;
    }
    changeTextbookMode(source === 'olympiad' ? 'olympiad' : 'chapter');
    onViewChange('textbook');
  };

  return <section className="mx-auto max-w-6xl space-y-6 animate-fade-in" aria-labelledby="assistant-title">
    <header className="rounded-2xl border border-cyber-border/60 bg-cyber-surface/60 p-6 backdrop-blur-md">
      <div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-neon-blue/15 shadow-glow-sm"><Sparkles className="text-neon-blue" size={24} aria-hidden="true" /></div><div><h1 id="assistant-title" className="bg-gradient-to-r from-neon-blue via-cyber-text to-neon-purple bg-clip-text text-xl font-bold tracking-tight text-transparent">{currentUser.name} 的学习小助手</h1><p className="mt-1 text-sm text-cyber-muted">从教材章节、错题或奥数资料开始，创建下一项学习任务</p></div></div>
    </header>
    <div role="tablist" aria-label="学习方式" className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-cyber-border/60 bg-cyber-surface/50 p-1 backdrop-blur-md">
      {SOURCE_TABS.map(tab => { const active = tab.id === 'wrong' ? view === 'wrong' : view === 'textbook' && textbookMode === (tab.id === 'olympiad' ? 'olympiad' : 'chapter'); const Icon = tab.icon; return <button key={tab.id} type="button" role="tab" aria-selected={active} onClick={() => selectSource(tab.id)} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-neon-blue ${active ? 'border-neon-blue/40 bg-gradient-to-r from-neon-blue/25 to-neon-purple/20 text-neon-blue shadow-glow-sm' : 'border-transparent text-cyber-muted hover:bg-white/5 hover:text-cyber-text'}`}><Icon size={16} />{tab.label}</button>; })}
    </div>
    {createdTitle && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-300/70 bg-emerald-50/90 p-4 text-sm text-emerald-900"><span className="flex items-center gap-2"><CheckCircle2 size={18} />已生成“{createdTitle}”</span><button type="button" onClick={onOpenClassroom} className="min-h-10 rounded-xl border border-emerald-700 px-3 font-medium text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-700">进入智慧课堂</button></div>}

    {view === 'wrong' && <>
      {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800"><AlertCircle size={18} />{error}</div>}
      {loading ? <div role="status" className="flex min-h-48 items-center justify-center gap-2 rounded-2xl border border-cyber-border/60 bg-cyber-surface/50 text-cyber-muted"><Loader2 className="animate-spin" />正在读取错题</div> : !items.length ? <div role="status" className="rounded-2xl border border-cyber-border/60 bg-cyber-surface/50 p-10 text-center text-sm text-cyber-muted">暂无可用于讲解的错题。</div> : <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]"><div className="space-y-3"><label className="grid gap-2 text-sm font-medium text-cyber-text">学科<select value={subject} onChange={event => { setSubject(event.target.value); setSelected(new Set()); }} className={controlClass}>{subjects.map(value => <option key={value}>{value}</option>)}</select></label>{visibleItems.map(item => { const checked = selected.has(refKey(item)); return <label key={refKey(item)} className={`flex gap-3 rounded-xl border p-4 text-left transition-colors ${checked ? 'border-neon-blue/50 bg-neon-blue/10' : 'border-cyber-border/60 bg-cyber-surface/60 hover:bg-white/5'}`}><input type="checkbox" checked={checked} onChange={() => toggle(item)} className="mt-1 h-4 w-4 accent-neon-blue" /><span className="min-w-0"><span className="text-sm font-semibold text-cyber-text">{item.title}</span><span className="mt-1 block break-words text-sm text-cyber-muted">{item.contentExcerpt}</span>{item.knowledgePoints.length > 0 && <span className="mt-2 block text-xs text-neon-blue">{item.knowledgePoints.join(' · ')}</span>}</span></label>; })}</div><aside className="h-fit rounded-2xl border border-cyber-border/60 bg-cyber-surface/60 p-5 shadow-glow-sm lg:sticky lg:top-5"><div className="flex items-center gap-2 text-sm font-semibold text-cyber-text"><ClipboardCheck size={18} className="text-neon-blue" />本次选择</div><p className="mt-3 text-sm text-cyber-muted">已选 {selectedItems.length}/10 题</p>{knowledgePoints.length > 0 && <p className="mt-3 break-words text-sm text-cyber-muted">{knowledgePoints.join(' · ')}</p>}<button type="button" disabled={!selectedItems.length || creating} onClick={() => void createWrongReview()} className="mt-6 min-h-11 w-full rounded-xl bg-gradient-to-r from-neon-blue to-neon-purple px-4 text-sm font-semibold text-white shadow-glow-sm disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-neon-blue">{creating ? '正在生成讲解与测验' : '生成讲解与测验'}</button></aside></div>}
    </>}

    {view === 'textbook' && <section aria-label={textbookMode === 'olympiad' ? '奥数模拟考试' : '教材章节学习'} className="space-y-5">
      {textbookError && <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800"><AlertCircle size={18} />{textbookError}</div>}
      {booksLoading ? <div role="status" className="flex min-h-48 items-center justify-center gap-2 rounded-2xl border border-cyber-border/60 bg-cyber-surface/50 text-cyber-muted"><Loader2 className="animate-spin" />正在读取学习资料</div> : textbookMode === 'olympiad' ? <section className="rounded-2xl border border-cyber-border/60 bg-cyber-surface/60 p-5 shadow-glow-sm"><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neon-purple/15"><Trophy size={20} className="text-neon-purple" /></div><div><h2 className="text-base font-semibold text-cyber-text">奥数模拟考试</h2><p className="mt-1 text-sm text-cyber-muted">仅依据所选奥数资料的年级、类别与标签组织原创题目，不选择教材章节，也不读取资料正文。</p></div></div>{materials.length ? <div className="mt-5 grid gap-4 md:grid-cols-3"><label className="grid gap-2 text-sm font-medium text-cyber-text md:col-span-2">奥数资料<select value={olympiadBookId} onChange={event => setOlympiadBookId(event.target.value)} className={controlClass}>{materials.map(material => <option key={material.id} value={material.id}>{material.title} · {material.grade}</option>)}</select></label><label className="grid gap-2 text-sm font-medium text-cyber-text">试卷类型<select value={examType} onChange={event => setExamType(event.target.value)} className={controlClass}><option value="unit">阶段测验</option><option value="midterm">综合测验</option><option value="final">竞赛模拟</option></select></label><label className="grid gap-2 text-sm font-medium text-cyber-text">难度<select value={difficulty} onChange={event => setDifficulty(event.target.value)} className={controlClass}><option value="basic">基础</option><option value="standard">标准</option><option value="challenge">挑战</option></select></label></div> : <div role="status" className="mt-5 rounded-xl border border-cyber-border/60 bg-white/5 p-4 text-sm text-cyber-muted">暂无标注年级的奥数资料。请先在学习资料中归档奥数材料。</div>}<button type="button" disabled={!olympiadBookId || textbookCreating} onClick={() => void createOlympiadTask()} className="mt-5 min-h-11 w-full rounded-xl bg-gradient-to-r from-neon-blue to-neon-purple px-4 text-sm font-semibold text-white shadow-glow-sm disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-neon-blue">{textbookCreating ? '正在创建奥数试卷' : '创建奥数模拟考试'}</button></section> : !books.length ? <div role="status" className="rounded-2xl border border-cyber-border/60 bg-cyber-surface/50 p-10 text-center text-sm text-cyber-muted">暂无已上传教材。上传并完成解析后可按章节创建学习内容。</div> : <><div className="grid gap-4 md:grid-cols-2"><label className="grid gap-2 text-sm font-medium text-cyber-text">教材<select value={bookId} onChange={event => setBookId(event.target.value)} className={controlClass}>{books.map(book => <option key={book.id} value={book.id} disabled={book.indexStatus !== IndexStatus.INDEXED}>{book.title}{book.indexStatus !== IndexStatus.INDEXED ? '（解析中）' : ''}</option>)}</select></label><label className="grid gap-2 text-sm font-medium text-cyber-text">具体章节<select value={chapterId} onChange={event => setChapterId(event.target.value)} disabled={!chapters.length} className={controlClass}>{chapters.length ? chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.breadcrumb}</option>) : <option>暂无可用章节</option>}</select></label></div>{!selectedBook || selectedBook.indexStatus !== IndexStatus.INDEXED ? <div role="status" className="rounded-xl border border-cyber-border/60 bg-cyber-surface/50 p-5 text-sm text-cyber-muted">请先选择已完成解析且包含目录的教材。</div> : !chapters.length ? <div role="status" className="rounded-xl border border-cyber-border/60 bg-cyber-surface/50 p-5 text-sm text-cyber-muted">该教材暂无可用章节目录。</div> : actionsLoading ? <div role="status" className="flex min-h-32 items-center justify-center gap-2 rounded-2xl border border-cyber-border/60 bg-cyber-surface/50 text-cyber-muted"><Loader2 className="animate-spin" />正在检查本章可用学习内容</div> : <><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{chapterActions.map(action => { const detail = ACTION_COPY[action.action]; const Icon = detail.icon; return <button type="button" key={action.action} disabled={!action.available} onClick={() => selectAction(action)} className={`min-h-32 rounded-2xl border p-4 text-left transition-all focus:outline-none focus:ring-2 focus:ring-neon-blue disabled:cursor-not-allowed disabled:opacity-55 ${selectedAction === action.action ? 'border-neon-blue/50 bg-neon-blue/10 shadow-glow-sm' : 'border-cyber-border/60 bg-cyber-surface/60 hover:bg-white/5'}`}><Icon size={20} className="text-neon-blue" /><span className="mt-3 block text-sm font-semibold text-cyber-text">{detail.label}</span><span className="mt-1 block text-xs leading-5 text-cyber-muted">{action.available ? detail.description : '当前教材暂不支持此学习内容'}</span></button>; })}</div>{selectedAction && actionDetail && <aside className="rounded-2xl border border-cyber-border/60 bg-cyber-surface/60 p-5 shadow-glow-sm"><div className="flex items-center gap-2 text-sm font-semibold text-cyber-text"><Sparkles size={18} className="text-neon-blue" />{ACTION_COPY[selectedAction].label}</div><p className="mt-2 text-sm text-cyber-muted">《{selectedBook.title}》· {selectedChapter?.breadcrumb}</p>{selectedAction === 'assessment' && <div className="mt-4 grid gap-4 md:grid-cols-3"><label className="grid gap-2 text-sm font-medium text-cyber-text">范围<span className={`${controlClass} flex items-center bg-white/5 text-cyber-muted`}>当前章节</span></label><label className="grid gap-2 text-sm font-medium text-cyber-text">类型<select value={examType} onChange={event => setExamType(event.target.value)} className={controlClass}><option value="unit">单元测试</option><option value="midterm">期中测试</option><option value="final">期末测试</option></select></label><label className="grid gap-2 text-sm font-medium text-cyber-text">难度<select value={difficulty} onChange={event => setDifficulty(event.target.value)} className={controlClass}><option value="basic">基础</option><option value="standard">标准</option><option value="challenge">挑战</option></select></label></div>}<button type="button" disabled={textbookCreating} onClick={() => void createChapterTask()} className="mt-5 min-h-11 w-full rounded-xl bg-gradient-to-r from-neon-blue to-neon-purple px-4 text-sm font-semibold text-white shadow-glow-sm disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-neon-blue">{textbookCreating ? '正在创建学习任务' : `创建${ACTION_COPY[selectedAction].label}`}</button></aside>}</>}</>}
    </section>}
  </section>;
};

export default LearningAssistant;
