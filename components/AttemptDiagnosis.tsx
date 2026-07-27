import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, MessageSquare, X } from 'lucide-react';
import { AttemptDiagnosis as Diagnosis, AttemptItemResult, getAttemptDiagnosis, submitAttemptReview } from '../services/assessmentPaperApi';
import { UserProfile } from '../types';

function evidenceFor(item: AttemptItemResult, pointId: string) {
  const point = item.evidence.find(entry => entry.id === pointId);
  if (point?.evidence) return point.evidence;
  const objective = item.evidence.find(entry => typeof entry.studentAnswer === 'string');
  return objective?.studentAnswer || '未找到可核对的学生证据';
}

function earnedFor(item: AttemptItemResult, pointId: string) {
  const point = item.evidence.find(entry => entry.id === pointId);
  return typeof point?.earnedScore === 'number' ? point.earnedScore : item.score;
}

function reasonFor(item: AttemptItemResult, pointId: string) {
  const point = item.evidence.find(entry => entry.id === pointId);
  return point?.reason || item.rubric.reason;
}

function ReviewDrawer({ attemptId, ownerId, item, onClose, onUpdated }: { attemptId: string; ownerId: string; item: AttemptItemResult; onClose: () => void; onUpdated: (diagnosis: Diagnosis) => void }) {
  const [action, setAction] = useState<'request' | 'override'>('request');
  const [reason, setReason] = useState('');
  const [score, setScore] = useState(String(item.score));
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);

  useEffect(() => {
    reasonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !confirming) { onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled])') || []);
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); returnFocus.current?.focus(); };
  }, [confirming, onClose]);

  const submit = async () => {
    setSubmitting(true); setError('');
    try {
      const diagnosis = await submitAttemptReview(attemptId, { ownerId, questionId: item.questionId, action, reason, ...(action === 'override' ? { score: Number(score) } : {}) });
      onUpdated(diagnosis); onClose();
    } catch (cause: any) { setError(cause.message || '提交失败，请重试'); }
    finally { setSubmitting(false); }
  };

  const requestSubmit = () => {
    if (!reason.trim()) { setError('请说明需要复核或改判的原因'); return; }
    if (action === 'override') { if (!Number.isFinite(Number(score))) { setError('请输入有效分数'); return; } setConfirming(true); return; }
    void submit();
  };

  return <div className="fixed inset-0 z-[90] flex justify-end bg-slate-950/40" role="presentation">
    <section ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="review-title" className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-xl sm:p-7">
      <header className="flex items-center justify-between gap-4"><h2 id="review-title" className="text-xl font-semibold text-slate-900">第 {item.questionId} 题复核</h2><button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center border border-slate-300" aria-label="关闭复核侧栏" title="关闭"><X size={20} /></button></header>
      <p className="mt-3 text-sm leading-6 text-slate-600">此处只提交学习诊断复核，不会改写原始自动评分记录。</p>
      <div className="mt-6 grid grid-cols-2 gap-2" aria-label="复核方式"><button type="button" onClick={() => { setAction('request'); setConfirming(false); }} className={`min-h-11 border px-3 text-sm ${action === 'request' ? 'border-indigo-700 bg-indigo-50 text-indigo-800' : 'border-slate-300'}`}>提交复核</button><button type="button" onClick={() => setAction('override')} className={`min-h-11 border px-3 text-sm ${action === 'override' ? 'border-indigo-700 bg-indigo-50 text-indigo-800' : 'border-slate-300'}`}>家长手动改判</button></div>
      {action === 'override' && <label className="mt-5 block text-sm font-medium text-slate-800">改判分数（最高 {item.maxScore} 分）<input type="number" min="0" max={item.maxScore} step="0.5" value={score} onChange={event => setScore(event.target.value)} className="mt-2 min-h-11 w-full border border-slate-400 px-3 text-base" /></label>}
      <label className="mt-5 block text-sm font-medium text-slate-800">原因<textarea ref={reasonRef} value={reason} onChange={event => setReason(event.target.value)} className="mt-2 min-h-32 w-full resize-y border border-slate-400 p-3 text-base leading-6" aria-describedby="review-help" /></label><p id="review-help" className="mt-2 text-sm text-slate-600">请指出需要复核的步骤、结果或证据。</p>
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      {confirming ? <div className="mt-6 border border-amber-300 bg-amber-50 p-4"><p className="font-medium text-amber-950">确认以 {score} 分覆盖当前 {item.score} 分的诊断结果？</p><p className="mt-2 text-sm text-amber-900">原评分、改判原因和改判后的结果都会保留在审计记录中。</p><div className="mt-4 flex justify-end gap-3"><button type="button" onClick={() => setConfirming(false)} className="min-h-11 border border-slate-400 px-4">返回修改</button><button type="button" disabled={submitting} onClick={() => void submit()} className="inline-flex min-h-11 items-center gap-2 bg-slate-900 px-4 font-medium text-white disabled:opacity-50">{submitting && <Loader2 size={16} className="animate-spin" />}确认改判</button></div></div> : <button type="button" disabled={submitting} onClick={requestSubmit} className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 bg-slate-900 px-4 font-medium text-white disabled:opacity-50">{submitting && <Loader2 size={16} className="animate-spin" />}{action === 'override' ? '继续改判' : '提交复核'}</button>}
    </section>
  </div>;
}

export default function AttemptDiagnosis({ attemptId, currentUser, onBack }: { attemptId: string; currentUser: UserProfile; onBack: () => void }) {
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [selected, setSelected] = useState<AttemptItemResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = async () => { setLoading(true); setError(''); try { setDiagnosis(await getAttemptDiagnosis(attemptId, currentUser.id)); } catch (cause: any) { setError(cause.message || '读取学习诊断失败'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [attemptId, currentUser.id]);
  if (loading) return <p role="status" className="p-6 text-slate-600">正在生成学习诊断...</p>;
  if (error || !diagnosis) return <section className="mx-auto max-w-3xl"><button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2"><ArrowLeft size={18} />返回试卷</button><p role="alert" className="mt-6 text-red-700">{error || '学习诊断不存在'}</p><button type="button" onClick={() => void load()} className="mt-4 min-h-11 border border-slate-400 px-4">重试</button></section>;
  const total = diagnosis.items.reduce((sum, item) => sum + item.maxScore, 0);
  return <section className="mx-auto max-w-5xl text-slate-800"><header className="mb-6 flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 text-sm"><ArrowLeft size={18} />返回试卷</button><p className="text-sm text-slate-600" aria-live="polite">学习诊断，仅供学习改进使用</p></header>
    <div className="border-y-2 border-slate-900 bg-white px-5 py-6 sm:px-8"><p className="text-sm font-medium text-indigo-800">原创试卷 · 学习诊断</p><div className="mt-3 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold">逐题诊断结果</h1><p className="mt-2 text-sm text-slate-600">已提交作答会保留；低置信度结果不会计为已掌握。</p></div><p className="text-2xl font-semibold tabular-nums">{diagnosis.diagnosticScore ?? 0} <span className="text-base font-normal text-slate-600">/ {total} 分</span></p></div></div>
    <div className="mt-8 space-y-8">{diagnosis.items.map((item, index) => <article key={item.questionId} className="border-b border-slate-300 pb-8"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">第 {index + 1} 题</h2><p className="mt-1 text-sm text-slate-600">得分 {item.score} / {item.maxScore} 分</p></div><div className={`inline-flex min-h-11 items-center gap-2 px-3 text-sm ${item.verdict === 'mastered' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}>{item.verdict === 'mastered' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}{item.verdict === 'mastered' ? '已完成诊断' : '建议复核'}</div></div>
      {item.confidence < 0.75 && <p className="mt-4 flex items-center gap-2 text-sm text-amber-900"><AlertTriangle size={17} />置信度 {Math.round(item.confidence * 100)}%，本题不计入已掌握。</p>}
      <div className="mt-5 overflow-x-auto"><table className="min-w-full border-collapse text-left text-sm"><thead><tr className="border-y border-slate-300 text-slate-700"><th className="p-3 font-medium">要求</th><th className="p-3 font-medium">学生证据</th><th className="p-3 font-medium">得分/分值</th><th className="p-3 font-medium">原因</th></tr></thead><tbody>{item.rubric.points.map(point => <tr key={point.id} className="border-b border-slate-200 align-top"><td className="p-3"><span className="font-medium">{point.dimension === 'process' ? '过程' : point.dimension === 'result' ? '结果' : point.dimension === 'expression' ? '表达' : point.dimension === 'knowledge' ? '知识' : '答案'}</span><br />{point.description}</td><td className="max-w-xs whitespace-pre-wrap break-words p-3">{evidenceFor(item, point.id)}</td><td className="whitespace-nowrap p-3">{earnedFor(item, point.id)} / {point.score}</td><td className="max-w-xs whitespace-pre-wrap break-words p-3">{reasonFor(item, point.id)}</td></tr>)}</tbody></table></div>
      <button type="button" onClick={() => setSelected(item)} className="mt-5 inline-flex min-h-11 items-center gap-2 border border-slate-400 px-4 text-sm"><MessageSquare size={18} />申请复核或手动改判</button></article>)}</div>
    {diagnosis.events.length > 0 && <section className="mt-8 border-t border-slate-300 pt-6"><h2 className="text-lg font-semibold">复核记录</h2><ol className="mt-4 space-y-3">{diagnosis.events.map(event => <li key={event.id} className="border-l-2 border-slate-300 pl-4 text-sm"><p className="font-medium">{event.actorType === 'parent' ? '家长手动改判' : '学生提交复核'} · 第 {event.questionId} 题</p><p className="mt-1 text-slate-600">{event.reason}</p><time className="mt-1 block text-slate-500">{new Date(event.createdAt).toLocaleString('zh-CN')}</time></li>)}</ol></section>}
    {selected && <ReviewDrawer attemptId={attemptId} ownerId={currentUser.id} item={selected} onClose={() => setSelected(null)} onUpdated={setDiagnosis} />}
  </section>;
}
