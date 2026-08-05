import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Lightbulb, Loader2 } from 'lucide-react';
import { ClassroomTaskApiError, fetchLegacyClassroomContent } from '../services/classroomTaskApi';

type StudentCoursewareStep = {
  id: string;
  kind: 'objective' | 'explanation' | 'example' | 'self_check' | 'misconception' | 'summary';
  knowledgePoint: string;
  title: string;
  content: string;
  example?: { prompt: string; walkthrough: string[]; answer: string };
  selfCheck?: { id: string; prompt: string; options?: string[]; answer: string; explanation: string };
};

type StudentCourseware = {
  schemaVersion: 1;
  audience: 'student';
  objectives: string[];
  steps: StudentCoursewareStep[];
  summary: string[];
  studyTip: string;
};

interface StudentCoursewareReaderProps {
  coursewareId: string;
  ownerId: string;
  title: string;
  chapterTitles: string[];
  onBack: () => void;
  onOpenQuiz: () => void;
}

function isStudentCourseware(value: unknown): value is StudentCourseware {
  if (!value || typeof value !== 'object') return false;
  const courseware = value as Partial<StudentCourseware>;
  return courseware.schemaVersion === 1
    && courseware.audience === 'student'
    && Array.isArray(courseware.objectives)
    && Array.isArray(courseware.steps)
    && Array.isArray(courseware.summary)
    && typeof courseware.studyTip === 'string';
}

function hasExample(value: StudentCoursewareStep['example']): value is NonNullable<StudentCoursewareStep['example']> {
  return Boolean(value && typeof value.prompt === 'string' && Array.isArray(value.walkthrough) && typeof value.answer === 'string');
}

function hasSelfCheck(value: StudentCoursewareStep['selfCheck']): value is NonNullable<StudentCoursewareStep['selfCheck']> {
  return Boolean(value && typeof value.id === 'string' && typeof value.prompt === 'string' && typeof value.answer === 'string' && typeof value.explanation === 'string');
}

const STEP_KIND_LABEL: Record<StudentCoursewareStep['kind'], string> = {
  objective: '学习目标', explanation: '分步讲解', example: '跟着示例做', self_check: '即时自检', misconception: '易错提醒', summary: '本节小结',
};

const StudentCoursewareReader: React.FC<StudentCoursewareReaderProps> = ({ coursewareId, ownerId, title, chapterTitles, onBack, onOpenQuiz }) => {
  const [courseware, setCourseware] = useState<StudentCourseware | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [retired, setRetired] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setRetired(false); setCourseware(null); setIndex(0); setAnswers({}); setChecked({});
    fetchLegacyClassroomContent(coursewareId, ownerId)
      .then(value => {
        if (cancelled) return;
        if (!isStudentCourseware(value.content)) throw new Error('该学习内容不是可阅读的学生自学课件');
        setCourseware(value.content);
      })
      .catch(reason => {
        if (cancelled) return;
        if (reason instanceof ClassroomTaskApiError && reason.errorCode === 'learning_content_retired') setRetired(true);
        else setError(reason instanceof Error ? reason.message : '学习内容读取失败');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [coursewareId, ownerId]);

  const step = courseware?.steps[index];
  const completedChecks = useMemo(() => Object.values(checked).filter(Boolean).length, [checked]);

  if (loading) return <div role="status" className="mx-auto flex min-h-64 max-w-4xl items-center justify-center gap-2 rounded-xl border border-cyber-border/60 bg-cyber-surface/60 text-sm text-cyber-muted"><Loader2 className="animate-spin" size={18} />正在准备自学内容</div>;
  if (retired) return <section className="mx-auto max-w-3xl py-16 text-center" aria-labelledby="retired-content-title"><h1 id="retired-content-title" className="text-xl font-semibold text-cyber-text">该学习内容已下线</h1><button type="button" onClick={onBack} className="mt-8 min-h-11 rounded-lg border border-neon-blue px-4 text-sm font-medium text-neon-blue focus:outline-none focus:ring-2 focus:ring-neon-blue">返回智慧课堂</button></section>;
  if (error || !courseware || !step) return <section className="mx-auto max-w-3xl space-y-5 py-12"><button type="button" onClick={onBack} className="inline-flex min-h-10 items-center gap-2 text-sm text-neon-blue focus:outline-none focus:ring-2 focus:ring-neon-blue"><ArrowLeft size={18} />返回智慧课堂</button><div role="alert" className="flex gap-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800"><AlertCircle size={18} />{error || '学习内容无法读取'}</div></section>;

  const check = hasSelfCheck(step.selfCheck) ? step.selfCheck : undefined;
  const answer = check ? answers[check.id] || '' : '';
  const checkSubmitted = check ? Boolean(checked[check.id]) : false;
  const isLast = index === courseware.steps.length - 1;

  return <section className="mx-auto max-w-4xl space-y-5" aria-labelledby="student-courseware-title">
    <button type="button" onClick={onBack} className="inline-flex min-h-10 items-center gap-2 text-sm text-neon-blue focus:outline-none focus:ring-2 focus:ring-neon-blue"><ArrowLeft size={18} />返回智慧课堂</button>
    <header className="rounded-xl border border-cyber-border/60 bg-cyber-surface/60 p-5">
      <p className="text-sm text-neon-blue">学生自学课件</p><h1 id="student-courseware-title" className="mt-1 text-xl font-semibold text-cyber-text">{title}</h1>
      {chapterTitles.length > 0 && <p className="mt-2 text-sm text-cyber-muted">{chapterTitles.join('、')}</p>}
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10" aria-label={`学习进度 ${index + 1}/${courseware.steps.length}`}><div className="h-full bg-neon-blue transition-all" style={{ width: `${((index + 1) / courseware.steps.length) * 100}%` }} /></div>
      <p className="mt-2 text-xs text-cyber-muted">第 {index + 1} / {courseware.steps.length} 步 · 已完成 {completedChecks} 个即时自检</p>
    </header>
    <article className="rounded-xl border border-cyber-border/60 bg-cyber-surface/60 p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-neon-blue/10 px-2 py-1 text-xs font-medium text-neon-blue">{STEP_KIND_LABEL[step.kind]}</span><span className="text-xs text-cyber-muted">{step.knowledgePoint}</span></div>
      <h2 className="mt-4 text-lg font-semibold text-cyber-text">{step.title}</h2><p className="mt-3 whitespace-pre-wrap text-base leading-7 text-cyber-text">{step.content}</p>
      {hasExample(step.example) && <section className="mt-5 rounded-lg border border-cyber-border/60 bg-white/5 p-4"><h3 className="font-medium text-cyber-text">{step.example.prompt}</h3><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-cyber-muted">{step.example.walkthrough.map((item, stepIndex) => <li key={stepIndex}>{item}</li>)}</ol><p className="mt-3 border-l-2 border-neon-blue pl-3 text-sm text-cyber-text">答案：{step.example.answer}</p></section>}
      {check && <section className="mt-5 rounded-lg border border-neon-blue/30 bg-neon-blue/5 p-4" aria-labelledby={`check-title-${check.id}`}><div className="flex items-center gap-2"><ClipboardCheck size={18} className="text-neon-blue" /><h3 id={`check-title-${check.id}`} className="font-medium text-cyber-text">{check.prompt}</h3></div>{check.options?.length ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{check.options.map(option => <label key={option} className="flex min-h-10 items-center gap-2 rounded-lg border border-cyber-border/60 px-3 text-sm text-cyber-text"><input type="radio" name={check.id} value={option} checked={answer === option} onChange={() => setAnswers(previous => ({ ...previous, [check.id]: option }))} disabled={checkSubmitted} />{option}</label>)}</div> : <input value={answer} onChange={event => setAnswers(previous => ({ ...previous, [check.id]: event.target.value }))} disabled={checkSubmitted} className="mt-4 min-h-11 w-full rounded-lg border border-cyber-border/60 bg-white/5 px-3 text-sm text-cyber-text focus:outline-none focus:ring-2 focus:ring-neon-blue" aria-label="填写自检答案" />}{!checkSubmitted ? <button type="button" disabled={!answer.trim()} onClick={() => setChecked(previous => ({ ...previous, [check.id]: true }))} className="mt-4 min-h-10 rounded-lg border border-neon-blue px-3 text-sm font-medium text-neon-blue disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-neon-blue">查看反馈</button> : <div role="status" className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900"><CheckCircle2 className="mr-2 inline" size={16} />{answer.trim() === check.answer.trim() ? '回答正确。' : `参考答案：${check.answer}。`}{check.explanation}</div>}</section>}
      {step.kind === 'misconception' && <div className="mt-5 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><Lightbulb size={18} className="shrink-0" />先自己判断，再回到题目逐项核对。</div>}
      {isLast && <section className="mt-5 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900"><h3 className="font-medium">完成小结</h3><ul className="mt-2 list-disc space-y-1 pl-5">{courseware.summary.map(item => <li key={item}>{item}</li>)}</ul><p className="mt-3">学习建议：{courseware.studyTip}</p></section>}
    </article>
    <footer className="flex flex-wrap items-center justify-between gap-3"><button type="button" disabled={index === 0} onClick={() => setIndex(previous => previous - 1)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-cyber-border/60 px-3 text-sm text-cyber-text disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-neon-blue"><ChevronLeft size={18} />上一步</button>{isLast ? <button type="button" onClick={onOpenQuiz} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-neon-blue px-4 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-neon-blue">进入随堂测验<ChevronRight size={18} /></button> : <button type="button" onClick={() => setIndex(previous => previous + 1)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-neon-blue px-4 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-neon-blue">下一步<ChevronRight size={18} /></button>}</footer>
  </section>;
};

export default StudentCoursewareReader;
