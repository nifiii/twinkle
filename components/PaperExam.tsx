import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, ChevronRight, FileText, Loader2, Save } from 'lucide-react';
import { AssessmentPaper, AssessmentQuestion, createPaperAttempt, getAssessmentPaper, PaperAttempt, savePaperAttempt } from '../services/assessmentPaperApi';
import { UserProfile } from '../types';

type FlatQuestion = AssessmentQuestion & { number: number; sectionTitle: string };

function flattenQuestions(paper: AssessmentPaper | null): FlatQuestion[] {
  if (!paper) return [];
  let number = 0;
  return paper.content.sections.flatMap(section => section.questions.map(question => ({ ...question, number: ++number, sectionTitle: section.title })));
}

export default function PaperExam({ paperId, currentUser, onBack, onPreview, onSubmitted }: { paperId: string; currentUser: UserProfile; onBack: () => void; onPreview: () => void; onSubmitted: (attemptId: string) => void }) {
  const [paper, setPaper] = useState<AssessmentPaper | null>(null);
  const [attempt, setAttempt] = useState<PaperAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('正在恢复试卷与草稿...');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const dirty = useRef(false);
  const questions = useMemo(() => flattenQuestions(paper), [paper]);

  const load = async () => {
    setError(''); setStatus('正在恢复试卷与草稿...');
    try {
      const nextPaper = await getAssessmentPaper(paperId, currentUser.id);
      const nextAttempt = await createPaperAttempt({ ownerId: currentUser.id, paperId });
      setPaper(nextPaper); setAttempt(nextAttempt); setAnswers(nextAttempt.answers); dirty.current = false;
      setStatus(nextAttempt.status === 'submitted' ? '试卷已交卷，答案不可再修改。' : '草稿已恢复');
    } catch (cause: any) { setError(cause.message || '读取试卷失败'); setStatus(''); }
  };

  useEffect(() => { load(); }, [paperId, currentUser.id]);
  const persist = async (action: 'save' | 'submit') => {
    if (!attempt || attempt.status !== 'draft') return;
    setSaving(true); setError('');
    try {
      const next = await savePaperAttempt(attempt.id, { ownerId: currentUser.id, action, answers });
      setAttempt(next); dirty.current = false;
      setStatus(action === 'submit' ? '已交卷，正在准备学习诊断。' : '草稿已保存');
      if (action === 'submit') onSubmitted(next.id);
    } catch (cause: any) { setError(cause.message || '保存失败，请重试'); setStatus('本地作答仍保留，可重试保存。'); }
    finally { setSaving(false); }
  };

  useEffect(() => {
    const timer = window.setInterval(() => { if (dirty.current && !saving) void persist('save'); }, 5000);
    return () => { window.clearInterval(timer); if (dirty.current) void persist('save'); };
  }, [attempt?.id, answers, saving]);

  const changeAnswer = (id: string, value: string) => { if (attempt?.status !== 'draft') return; dirty.current = true; setAnswers(current => ({ ...current, [id]: value })); setStatus('草稿尚未保存'); };
  if (error) return <section className="mx-auto max-w-3xl"><button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2"><ArrowLeft size={18} />返回</button><p role="alert" className="mt-6 text-red-700">{error}</p><button type="button" onClick={load} className="mt-4 min-h-11 border px-4">重试</button></section>;
  if (!paper || !attempt) return <p role="status" className="p-6 text-slate-600">{status}</p>;
  const submitted = attempt.status === 'submitted';
  return <section className="mx-auto max-w-6xl text-slate-800">
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 text-sm"><ArrowLeft size={18} />退出考试</button><p className="text-sm" role="status" aria-live="polite">{status}</p><button type="button" onClick={onPreview} className="inline-flex min-h-11 items-center gap-2 border border-slate-400 px-3 text-sm"><FileText size={18} />预览和下载</button></header>
    <div className="grid gap-5 lg:grid-cols-[4.5rem_minmax(0,50rem)_12rem]">
      <nav aria-label="题号导航" className="flex gap-2 overflow-x-auto border-b border-slate-300 pb-3 lg:flex-col lg:border-b-0 lg:border-r lg:pb-0 lg:pr-3">{questions.map(question => <button key={question.id} type="button" onClick={() => document.getElementById(`question-${question.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className={`grid h-11 min-w-11 place-items-center border text-sm ${answers[question.id]?.trim() ? 'border-indigo-700 bg-indigo-700 text-white' : 'border-slate-300 bg-white'}`} aria-label={`第${question.number}题`}>{question.number}</button>)}</nav>
      <main className="border border-slate-400 bg-white p-5 shadow-sm sm:p-8"><p className="text-sm text-indigo-700">AI 原创试卷 · 第 {paper.generationVersion} 版</p><h1 className="mt-2 text-xl font-semibold">{paper.content.title}</h1><div className="mt-2 flex justify-between text-sm text-slate-600"><span>{paper.content.totalScore} 分</span><span>{submitted ? '已交卷' : '自由作答'}</span></div><div className="mt-8 space-y-10">{questions.map(question => <article key={question.id} id={`question-${question.id}`} className="scroll-mt-6"><p className="text-sm text-slate-500">{question.sectionTitle}</p><h2 className="mt-2 text-lg font-medium">{question.number}. {question.stem} <span className="text-sm font-normal text-slate-500">（{question.score} 分）</span></h2>{question.type === 'choice' ? <div className="mt-4 grid gap-2">{(question.options || []).map(option => <label key={option} className="flex min-h-11 items-center gap-3 border border-slate-300 px-3"><input type="radio" name={question.id} disabled={submitted} checked={answers[question.id] === option} onChange={() => changeAnswer(question.id, option)} />{option}</label>)}</div> : question.type === 'fill' ? <input value={answers[question.id] || ''} disabled={submitted} onChange={event => changeAnswer(question.id, event.target.value)} className="mt-4 min-h-11 w-full border border-slate-400 px-3 text-base" aria-label={`第${question.number}题作答`} /> : <textarea value={answers[question.id] || ''} disabled={submitted} onChange={event => changeAnswer(question.id, event.target.value)} className="mt-4 min-h-40 w-full resize-y border border-slate-400 p-3 text-base leading-7" aria-label={`第${question.number}题作答`} />}</article>)}</div></main>
      <aside className="flex gap-3 lg:block"><button type="button" disabled={submitted || saving} onClick={() => void persist('save')} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 border border-slate-400 px-4 text-sm disabled:opacity-50 lg:w-full"><Save size={18} />保存草稿</button><button type="button" disabled={submitted || saving} onClick={() => setConfirming(true)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-50 lg:mt-3 lg:w-full"><CheckCircle2 size={18} />交卷</button>{submitted && <button type="button" onClick={() => onSubmitted(attempt.id)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 border border-indigo-700 px-4 text-sm text-indigo-700">查看诊断<ChevronRight size={18} /></button>}</aside>
    </div>
    {confirming && <div role="dialog" aria-modal="true" aria-labelledby="submit-title" className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/40 p-4"><div className="w-full max-w-md bg-white p-6 shadow-xl"><h2 id="submit-title" className="text-lg font-semibold">确认交卷？</h2><p className="mt-3 text-sm text-slate-600">交卷后不能修改答案，系统会生成学习诊断。</p><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setConfirming(false)} className="min-h-11 border px-4">继续作答</button><button type="button" onClick={() => { setConfirming(false); void persist('submit'); }} className="min-h-11 bg-slate-900 px-4 text-white">确认交卷</button></div></div></div>}
  </section>;
}
