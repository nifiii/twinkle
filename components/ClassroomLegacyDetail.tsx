import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { CoursewareNarrator, LessonSection, SectionCard } from './AIClassroom';
import { QuizExam } from './QuizExam';
import { Question } from './QuizGenerator';
import { ClassroomTaskDetail, fetchLegacyClassroomContent, fetchLegacyQuizResult, LegacyQuizResult, overrideLegacyQuizResult } from '../services/classroomTaskApi';

interface ClassroomLegacyDetailProps {
  task: ClassroomTaskDetail;
  currentUser: { id: string; name: string };
  onBack: () => void;
  onOpenTask: (taskId: string) => void;
  initialEntityId?: string;
}

const TYPE_LABEL: Record<string, string> = { choice: '选择题', fill: '填空题', essay: '解答题' };

const QuizResultDetail: React.FC<{ result: LegacyQuizResult; onBack: () => void }> = ({ result: initialResult, onBack }) => {
  const [result, setResult] = useState(initialResult);
  const [error, setError] = useState('');
  const override = async (questionId: string, isCorrect: boolean) => {
    setError('');
    try {
      const summary = await overrideLegacyQuizResult(result.id, questionId, isCorrect);
      setResult(previous => ({ ...previous, ...summary, results: previous.results.map(item => item.id === questionId ? { ...item, isCorrect } : item) }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '改判失败，请稍后重试'); }
  };
  const scoreTone = result.percentage >= 80 ? 'text-emerald-700' : result.percentage >= 60 ? 'text-amber-700' : 'text-red-700';
  return <section className="mx-auto max-w-4xl space-y-5" aria-labelledby="legacy-result-title">
    <button type="button" onClick={onBack} className="inline-flex min-h-10 items-center gap-2 text-sm text-neon-blue focus:outline-none focus:ring-2 focus:ring-neon-blue"><ArrowLeft size={18} />返回智慧课堂</button>
    <header className="border border-cyber-border bg-white p-5"><p className="text-sm text-neon-blue">测验记录</p><h1 id="legacy-result-title" className="mt-1 text-xl font-semibold text-cyber-text">《{result.bookTitle}》· {result.chapter}</h1><p className="mt-2 text-sm text-cyber-muted">{result.subject} · {result.userName}</p></header>
    {result.status === 'grading' ? <div role="status" className="flex items-center gap-2 border border-cyber-border bg-white p-5 text-sm text-cyber-muted"><Loader2 className="animate-spin" />正在批改，稍后刷新查看结果。</div> : <>
      {error && <div role="alert" className="flex gap-2 border border-red-300 bg-red-50 p-3 text-sm text-red-800"><AlertCircle size={18} />{error}</div>}
      <section className="border border-cyber-border bg-white p-6 text-center"><p className={`text-3xl font-semibold ${scoreTone}`}>{result.correctCount} / {result.total}</p><p className="mt-1 text-sm text-cyber-muted">得分率 {result.percentage}%</p></section>
      {result.suggestions && <section className="border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"><strong>学习建议：</strong>{result.suggestions}</section>}
      <section className="divide-y border border-cyber-border bg-white">{result.results.map((item, index) => <article key={item.id} className="p-5"><div className="flex gap-3"><span className="mt-0.5">{item.isCorrect === true ? <CheckCircle2 size={18} className="text-emerald-600" /> : item.isCorrect === false ? <XCircle size={18} className="text-red-600" /> : <AlertCircle size={18} className="text-amber-600" />}</span><div className="min-w-0 flex-1"><p className="text-xs text-neon-blue">{TYPE_LABEL[item.type] || item.type} · 第 {index + 1} 题</p><p className="mt-2 text-sm font-medium text-cyber-text">{item.question}</p><div className="mt-3 space-y-1 text-sm text-cyber-muted"><p>你的答案：{item.studentAnswer || '未作答'}</p><p>参考答案：{item.correctAnswer}</p></div>{item.explanation && <p className="mt-3 border-l-2 border-neon-blue pl-3 text-sm text-cyber-muted">{item.explanation}</p>}<div className="mt-4 flex gap-2"><button type="button" disabled={item.isCorrect === true} onClick={() => void override(item.id, true)} className="min-h-9 border border-emerald-600 px-3 text-sm text-emerald-700 disabled:opacity-50">标为正确</button><button type="button" disabled={item.isCorrect === false} onClick={() => void override(item.id, false)} className="min-h-9 border border-red-600 px-3 text-sm text-red-700 disabled:opacity-50">标为错误</button></div></div></div></article>)}</section>
    </>}
  </section>;
};

const ClassroomLegacyDetail: React.FC<ClassroomLegacyDetailProps> = ({ task, currentUser, onBack, onOpenTask, initialEntityId }) => {
  const links = task.links.filter(link => ['classroom_courseware', 'classroom_quiz', 'quiz_result'].includes(link.entityType));
  const initialLinkKey = () => initialEntityId
    ? links.find(item => item.entityId === initialEntityId)
      ? `${links.find(item => item.entityId === initialEntityId)!.entityType}:${initialEntityId}`
      : ''
    : task.primaryLink ? `${task.primaryLink.entityType}:${task.primaryLink.entityId}` : '';
  const [activeLinkKey, setActiveLinkKey] = useState(initialLinkKey);
  const link = links.find(item => `${item.entityType}:${item.entityId}` === activeLinkKey) || task.primaryLink;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [content, setContent] = useState<Awaited<ReturnType<typeof fetchLegacyClassroomContent>> | null>(null);
  const [result, setResult] = useState<LegacyQuizResult | null>(null);

  useEffect(() => {
    setActiveLinkKey(initialLinkKey());
  }, [task.id, task.primaryLink?.entityId, task.primaryLink?.entityType, initialEntityId]);

  useEffect(() => {
    let cancelled = false;
    if (!link || !['classroom_courseware', 'classroom_quiz', 'quiz_result'].includes(link.entityType)) return;
    setLoading(true); setError('');
    const request = link.entityType === 'quiz_result' ? fetchLegacyQuizResult(link.entityId).then(value => ({ result: value })) : fetchLegacyClassroomContent(link.entityId, currentUser.id).then(value => ({ content: value }));
    request.then(value => {
      if (cancelled) return;
      if ('content' in value) { setContent(value.content); setResult(null); }
      else { setResult(value.result); setContent(null); }
    })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '历史内容读取失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentUser.id, link?.entityId, link?.entityType]);

  if (!link) return null;
  if (loading) return <div role="status" className="flex items-center gap-2 py-12 text-cyber-muted"><Loader2 className="animate-spin" />正在读取学习内容</div>;
  if (error) return <section className="mx-auto max-w-4xl space-y-5"><button type="button" onClick={onBack} className="inline-flex min-h-10 items-center gap-2 text-sm text-neon-blue"><ArrowLeft size={18} />返回智慧课堂</button><div role="alert" className="flex gap-2 border border-red-300 bg-red-50 p-4 text-sm text-red-800"><AlertCircle size={18} />{error}</div></section>;
  if (result) return <QuizResultDetail result={result} onBack={onBack} />;
  if (!content) return null;
  const contentSwitch = links.length > 1 ? <div role="tablist" aria-label="本任务学习内容" className="mx-auto flex max-w-4xl gap-2"><span className="self-center text-sm text-cyber-muted">本任务</span>{links.map(item => { const key = `${item.entityType}:${item.entityId}`; const label = item.role === 'explanation' ? '错题讲解' : item.role === 'practice' ? '针对性测验' : item.entityType === 'classroom_quiz' ? '随堂测验' : item.entityType === 'quiz_result' ? '测验记录' : '课件'; return <button key={key} type="button" role="tab" aria-selected={key === activeLinkKey} onClick={() => setActiveLinkKey(key)} className={`min-h-10 border px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-neon-blue ${key === activeLinkKey ? 'border-neon-blue bg-neon-blue/10 text-neon-blue' : 'border-cyber-border text-cyber-muted hover:bg-white/5'}`}>{label}</button>; })}</div> : null;
  if (content.type === 'quiz') return <section className="space-y-4">{contentSwitch}<QuizExam quizId={content.id} questions={content.content as Question[]} bookTitle={content.bookTitle} chapter={content.chapter} subject={content.subject} studentName={content.userName || currentUser.name} ownerId={currentUser.id} onClose={onBack} onSubmitted={(resultId) => onOpenTask(`legacy:quiz_result:${resultId}`)} /></section>;
  const sections = content.content as LessonSection[];
  return <section className="mx-auto max-w-4xl space-y-5" aria-labelledby="legacy-courseware-title"><button type="button" onClick={onBack} className="inline-flex min-h-10 items-center gap-2 text-sm text-neon-blue focus:outline-none focus:ring-2 focus:ring-neon-blue"><ArrowLeft size={18} />返回智慧课堂</button>{contentSwitch}<header className="border border-cyber-border bg-white p-5"><p className="text-sm text-neon-blue">课件学习</p><h1 id="legacy-courseware-title" className="mt-1 text-xl font-semibold text-cyber-text">《{content.bookTitle}》· {content.chapter}</h1><p className="mt-2 text-sm text-cyber-muted">{content.subject} · {content.userName || currentUser.name}</p></header><CoursewareNarrator sections={sections} coursewareId={content.id} /><div className="space-y-4">{sections.map((section, index) => <SectionCard key={section.index || index} section={section} isLast={index === sections.length - 1} />)}</div></section>;
};

export default ClassroomLegacyDetail;
