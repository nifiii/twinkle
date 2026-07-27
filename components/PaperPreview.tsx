import React, { useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { ArrowLeft, Download, FileText, Loader2, RotateCcw } from 'lucide-react';
import { AssessmentPaper, AssessmentQuestion, createPaperExport, getAssessmentPaper, getPaperExport, PaperExportJob, PaperExportVariant } from '../services/assessmentPaperApi';
import { UserProfile } from '../types';

type FlatQuestion = AssessmentQuestion & { number: number; sectionTitle: string };

function flattenQuestions(paper: AssessmentPaper | null): FlatQuestion[] {
  if (!paper) return [];
  let number = 0;
  return paper.content.sections.flatMap(section => section.questions.map(question => ({ ...question, number: ++number, sectionTitle: section.title })));
}

function MathStem({ stem }: { stem: string }) {
  return <>{stem.split(/(\$[^$]+\$)/g).filter(Boolean).map((part, index) => {
    if (!part.startsWith('$')) return <React.Fragment key={index}>{part}</React.Fragment>;
    return <span key={index} className="mx-1 inline-block align-middle" dangerouslySetInnerHTML={{ __html: katex.renderToString(part.slice(1, -1), { throwOnError: false }) }} />;
  })}</>;
}

function PreviewQuestion({ question, variant }: { question: FlatQuestion; variant: PaperExportVariant }) {
  return <article className="break-inside-avoid border-b border-slate-200 py-5 last:border-b-0">
    <p className="text-xs text-slate-500">{question.sectionTitle}</p>
    <h2 className="mt-2 text-base font-medium leading-7">{question.number}. <MathStem stem={question.stem} /> <span className="whitespace-nowrap text-sm font-normal text-slate-500">（{question.score} 分）</span></h2>
    {question.options?.length ? <ol className="mt-3 grid gap-1 text-sm leading-6">{question.options.map(option => <li key={option}>{option}</li>)}</ol> : null}
    {variant === 'answer' ? <div className="mt-3 border-l-2 border-green-700 pl-3 text-sm leading-6"><p className="font-medium text-green-800">答案：{question.answer}</p>{question.explanation ? <p className="mt-1 text-slate-600">解析：{question.explanation}</p> : null}</div> : question.type === 'essay' ? <div className="mt-4 space-y-5" aria-label={`第${question.number}题答题区`}>{Array.from({ length: 5 }, (_, index) => <div key={index} className="border-b border-slate-300" />)}</div> : question.type === 'fill' ? <div className="mt-4 border-b border-slate-400" aria-label={`第${question.number}题答题区`} /> : null}
  </article>;
}

function variantLabel(variant: PaperExportVariant) { return variant === 'paper' ? '试卷卷' : '答案卷'; }

export default function PaperPreview({ paperId, currentUser, onBack }: { paperId: string; currentUser: UserProfile; onBack: () => void }) {
  const [paper, setPaper] = useState<AssessmentPaper | null>(null);
  const [variant, setVariant] = useState<PaperExportVariant>('paper');
  const [jobs, setJobs] = useState<Partial<Record<PaperExportVariant, PaperExportJob>>>({});
  const [status, setStatus] = useState('正在读取只读试卷预览...');
  const [error, setError] = useState('');
  const retries = useRef<Record<string, number>>({});
  const questions = useMemo(() => flattenQuestions(paper), [paper]);

  const load = async () => {
    setError(''); setStatus('正在读取只读试卷预览...');
    try { setPaper(await getAssessmentPaper(paperId, currentUser.id)); setStatus('预览仅用于阅读与下载，不会修改网页作答。'); }
    catch (cause: any) { setError(cause.message || '读取试卷预览失败'); setStatus(''); }
  };
  useEffect(() => { void load(); }, [paperId, currentUser.id]);

  useEffect(() => {
    const active = Object.values(jobs).filter((job): job is PaperExportJob => Boolean(job && (job.status === 'queued' || job.status === 'running')));
    if (!active.length) return;
    const timer = window.setTimeout(() => {
      void Promise.all(active.map(async job => {
        try {
          const next = await getPaperExport(job.id, currentUser.id);
          retries.current[job.id] = 0;
          setJobs(current => ({ ...current, [next.variant]: next }));
          setStatus(next.status === 'completed' ? `${variantLabel(next.variant)}已可下载。` : `${variantLabel(next.variant)}正在生成...`);
        } catch (cause: any) {
          const count = (retries.current[job.id] || 0) + 1; retries.current[job.id] = count;
          if (count >= 3) {
            setJobs(current => ({ ...current, [job.variant]: { ...job, status: 'failed', error: cause.message || '读取导出状态失败' } }));
            setStatus(`${variantLabel(job.variant)}状态读取失败，可重新生成。`);
          }
        }
      }));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [jobs, currentUser.id]);

  const requestExport = async (requested: PaperExportVariant) => {
    setError(''); setStatus(`正在创建${variantLabel(requested)}导出任务...`);
    try {
      const job = await createPaperExport(paperId, { ownerId: currentUser.id, variant: requested });
      retries.current[job.id] = 0;
      setJobs(current => ({ ...current, [requested]: job }));
    } catch (cause: any) { setError(cause.message || '创建 PDF 导出失败'); setStatus(''); }
  };

  if (error) return <section className="mx-auto max-w-3xl"><button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2"><ArrowLeft size={18} />返回试卷</button><p role="alert" className="mt-6 text-red-700">{error}</p><button type="button" onClick={() => void load()} className="mt-4 min-h-11 border border-slate-400 px-4">重试</button></section>;
  if (!paper) return <p role="status" className="p-6 text-slate-600">{status}</p>;
  const selectedJob = jobs[variant];
  const busy = selectedJob?.status === 'queued' || selectedJob?.status === 'running';
  return <section className="mx-auto max-w-6xl text-slate-800"><header className="mb-5 flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 text-sm"><ArrowLeft size={18} />返回试卷</button><p role="status" aria-live="polite" className="text-sm text-slate-600">{status}</p></header>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-y border-slate-300 py-3"><div className="inline-flex" aria-label="预览类型"><button type="button" onClick={() => setVariant('paper')} className={`min-h-11 border px-4 text-sm ${variant === 'paper' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white'}`}>试卷卷</button><button type="button" onClick={() => setVariant('answer')} className={`min-h-11 border border-l-0 px-4 text-sm ${variant === 'answer' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white'}`}>答案卷</button></div><div className="flex items-center gap-2">{selectedJob?.status === 'completed' && selectedJob.downloadUrl ? <a href={selectedJob.downloadUrl} download className="inline-flex min-h-11 items-center gap-2 border border-green-700 px-4 text-sm font-medium text-green-800"><Download size={18} />下载{variantLabel(variant)} PDF</a> : <button type="button" disabled={busy} onClick={() => void requestExport(variant)} className="inline-flex min-h-11 items-center gap-2 bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? <Loader2 size={18} className="animate-spin" /> : selectedJob?.status === 'failed' ? <RotateCcw size={18} /> : <FileText size={18} />}{selectedJob?.status === 'failed' ? '重新生成' : busy ? '正在生成' : '生成 PDF'}</button>}</div></div>
    {selectedJob?.status === 'failed' && <p role="alert" className="mb-4 text-sm text-red-700">{selectedJob.error || '导出失败，请重新生成。'}</p>}
    <div className="overflow-x-auto pb-3"><main className="min-w-[720px] bg-white px-14 py-12 text-slate-900 shadow-sm print:min-w-0"><header className="border-b-2 border-slate-900 pb-4 text-sm text-slate-600"><div className="flex justify-between gap-4"><span>原创{variantLabel(variant)} · 第 {paper.generationVersion} 版</span><span>{paper.content.totalScore} 分</span></div></header><h1 className="mt-8 text-center text-2xl font-semibold">{paper.content.title}</h1><div className="mt-8">{questions.map(question => <PreviewQuestion key={question.id} question={question} variant={variant} />)}</div></main></div>
  </section>;
}
