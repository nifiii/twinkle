import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, FileText, Loader2, Sparkles } from 'lucide-react';
import { EBook, UserProfile } from '../types';
import { AssessmentBlueprint, AssessmentDifficulty, AssessmentExamType, createAssessmentBlueprint, createAssessmentPaper } from '../services/assessmentPaperApi';

interface AssessmentComposerProps {
  books: EBook[];
  currentUser: UserProfile;
  onBack: () => void;
  onPaperCreated: (paperId: string) => void;
}

const difficultyOptions: Array<{ id: AssessmentDifficulty; label: string; description: string }> = [
  { id: 'basic', label: '基础', description: '巩固课本核心知识' },
  { id: 'standard', label: '标准', description: '基础与提高结合' },
  { id: 'challenge', label: '挑战', description: '加入综合应用题' },
];

const examLabels: Record<AssessmentExamType, string> = { unit: '单元测试', midterm: '期中测试', final: '期末测试' };
const sectionLabels: Record<AssessmentBlueprint['sections'][number]['type'], string> = { choice: '选择题', fill: '填空题', essay: '解答题' };

function chaptersFor(book: EBook | undefined) {
  const chapters: Array<{ id: string; title: string }> = [];
  const visit = (nodes: EBook['tableOfContents']) => (nodes || []).forEach(node => {
    if (node.title?.trim()) chapters.push({ id: node.id, title: node.title.trim() });
    if (node.children?.length) visit(node.children);
  });
  if (book) visit(book.tableOfContents);
  return chapters;
}

export default function AssessmentComposer({ books, currentUser, onBack, onPaperCreated }: AssessmentComposerProps) {
  const eligibleBooks = useMemo(() => books.filter(book => Boolean(book.subject?.trim() && book.grade?.trim() && book.tableOfContents?.length)), [books]);
  const [bookId, setBookId] = useState('');
  const selectedBook = eligibleBooks.find(book => book.id === bookId);
  const chapters = useMemo(() => chaptersFor(selectedBook), [selectedBook]);
  const [chapterIds, setChapterIds] = useState<string[]>([]);
  const [examType, setExamType] = useState<AssessmentExamType>('unit');
  const [difficulty, setDifficulty] = useState<AssessmentDifficulty>('standard');
  const [blueprint, setBlueprint] = useState<AssessmentBlueprint | null>(null);
  const [fieldError, setFieldError] = useState('');
  const [error, setError] = useState('');
  const [creatingBlueprint, setCreatingBlueprint] = useState(false);
  const [creatingPaper, setCreatingPaper] = useState(false);

  useEffect(() => {
    setBookId(current => eligibleBooks.some(book => book.id === current) ? current : eligibleBooks[0]?.id || '');
  }, [eligibleBooks]);

  useEffect(() => {
    setChapterIds(current => current.filter(id => chapters.some(chapter => chapter.id === id)).length ? current.filter(id => chapters.some(chapter => chapter.id === id)) : chapters.slice(0, 1).map(chapter => chapter.id));
    setBlueprint(null);
  }, [chapters]);

  const resetBlueprint = () => { setBlueprint(null); setError(''); };
  const toggleChapter = (id: string) => {
    setChapterIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    resetBlueprint();
  };

  const preview = async () => {
    if (!selectedBook) { setFieldError('请选择教材。'); return; }
    if (chapterIds.length === 0) { setFieldError('至少选择一个章节。'); return; }
    setFieldError(''); setError(''); setCreatingBlueprint(true);
    try {
      setBlueprint(await createAssessmentBlueprint({ ownerId: currentUser.id, bookId: selectedBook.id, chapterIds, examType, difficulty }));
    } catch (cause: any) { setError(cause.message || '生成命题蓝图失败'); }
    finally { setCreatingBlueprint(false); }
  };

  const generate = async () => {
    if (!blueprint) return;
    setError(''); setCreatingPaper(true);
    try { onPaperCreated((await createAssessmentPaper({ ownerId: currentUser.id, blueprintId: blueprint.id })).id); }
    catch (cause: any) { setError(cause.message || '生成原创试卷失败'); }
    finally { setCreatingPaper(false); }
  };

  if (eligibleBooks.length === 0) return <section className="mx-auto max-w-3xl"><button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 text-sm"><ArrowLeft size={18} />返回学习中心</button><p className="mt-6 border border-amber-300 bg-amber-50 p-5 text-amber-950" role="status">没有可用于命题的教材。请先补全年级、学科和章节目录。</p></section>;

  return <section className="mx-auto max-w-6xl text-slate-800">
    <button type="button" onClick={onBack} className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-700"><ArrowLeft size={18} />返回学习中心</button>
    <header className="mb-6"><p className="text-sm text-indigo-700">原创试卷</p><h1 className="mt-1 text-2xl font-semibold">配置测试范围</h1><p className="mt-2 text-sm text-slate-600">试卷只依据当前选择教材的章节生成，答案用于学习诊断。</p></header>
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-7">
        <fieldset className="border-y border-slate-200 py-5"><legend className="px-0 text-base font-semibold">1. 选择教材与范围</legend><label className="mt-4 grid gap-2 text-sm font-medium">教材<select value={bookId} onChange={event => { setBookId(event.target.value); resetBlueprint(); }} className="min-h-11 border border-slate-300 bg-white px-3 text-base focus:outline-none focus:ring-2 focus:ring-indigo-700">{eligibleBooks.map(book => <option key={book.id} value={book.id}>{book.title}</option>)}</select></label><div className="mt-4"><p className="text-sm font-medium">章节</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{chapters.map(chapter => <label key={chapter.id} className="flex min-h-11 items-center gap-3 border border-slate-300 bg-white px-3 text-sm"><input type="checkbox" checked={chapterIds.includes(chapter.id)} onChange={() => toggleChapter(chapter.id)} />{chapter.title}</label>)}</div></div></fieldset>
        <fieldset><legend className="text-base font-semibold">2. 选择试卷类型</legend><div className="mt-3 flex flex-wrap gap-2">{(Object.keys(examLabels) as AssessmentExamType[]).map(type => <button key={type} type="button" onClick={() => { setExamType(type); resetBlueprint(); }} aria-pressed={examType === type} className={`min-h-11 border px-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-700 ${examType === type ? 'border-indigo-700 bg-indigo-700 text-white' : 'border-slate-300 bg-white'}`}>{examLabels[type]}</button>)}</div></fieldset>
        <fieldset><legend className="text-base font-semibold">3. 选择难度</legend><div className="mt-3 grid gap-2 sm:grid-cols-3">{difficultyOptions.map(option => <button key={option.id} type="button" onClick={() => { setDifficulty(option.id); resetBlueprint(); }} aria-pressed={difficulty === option.id} className={`min-h-20 border p-3 text-left focus:outline-none focus:ring-2 focus:ring-indigo-700 ${difficulty === option.id ? 'border-indigo-700 bg-indigo-50' : 'border-slate-300 bg-white'}`}><span className="block font-semibold">{option.label}</span><span className="mt-1 block text-sm text-slate-600">{option.description}</span></button>)}</div></fieldset>
        {fieldError && <p className="text-sm text-red-700" role="alert">{fieldError}</p>}
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        <button type="button" disabled={creatingBlueprint || creatingPaper || chapterIds.length === 0} onClick={preview} className="inline-flex min-h-11 items-center gap-2 bg-indigo-700 px-5 text-sm font-semibold text-white disabled:opacity-50">{creatingBlueprint && <Loader2 className="animate-spin" size={18} />}{blueprint ? '更新命题蓝图' : '查看命题蓝图'}</button>
      </div>
      <aside className="border border-slate-300 bg-white p-5" aria-live="polite"><div className="flex items-center gap-2 text-sm font-semibold"><FileText size={18} />命题蓝图</div>{!blueprint ? <p className="mt-4 text-sm text-slate-600">确认范围和难度后，先查看题型、题数与分值。</p> : <><p className="mt-4 text-sm text-slate-600">{blueprint.grade} · {blueprint.subject} · {examLabels[blueprint.examType]}</p><p className="mt-2 text-sm font-medium">{blueprint.chapterTitles.join('、')}</p><dl className="mt-5 space-y-3 text-sm">{blueprint.sections.map(section => <div key={section.id} className="flex justify-between gap-3 border-b border-slate-100 pb-3"><dt>{sectionLabels[section.type]} {section.questionCount} 题</dt><dd>{section.score} 分</dd></div>)}<div className="flex justify-between font-semibold"><dt>总分</dt><dd>{blueprint.totalScore} 分</dd></div></dl><p className="mt-5 flex items-start gap-2 text-sm text-slate-600"><Sparkles className="mt-0.5 shrink-0 text-indigo-700" size={16} />{blueprint.style ? `${blueprint.style.sourceType} 风格摘要已审核` : '教材原创试卷，不使用外部题源风格'}</p><button type="button" disabled={creatingPaper} onClick={generate} className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{creatingPaper ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}{creatingPaper ? '正在生成试卷...' : '确认并生成试卷'}</button></>}</aside>
    </div>
  </section>;
}
