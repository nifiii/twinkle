import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, Bookmark, Loader2 } from 'lucide-react';
import { AnswerReviewItem, getPaperAttemptReview, setPaperAttemptReinforcement } from '../services/assessmentPaperApi';
import { fetchLegacyQuizResult, setLegacyQuizReinforcement } from '../services/classroomTaskApi';

const TYPE_LABEL: Record<string, string> = { choice: '选择题', fill: '填空题', essay: '解答题' };

type Review = { id: string; subject?: string; bookTitle?: string; chapter?: string; submittedAt: number | null; items: AnswerReviewItem[] };

export default function AnswerReview({ sourceType, sourceId, currentUser, onBack }: { sourceType: 'quiz_result' | 'paper_attempt'; sourceId: string; currentUser: { id: string; name: string }; onBack: () => void }) {
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setReview(null);
    const request = sourceType === 'quiz_result'
      ? fetchLegacyQuizResult(sourceId, currentUser.id)
      : getPaperAttemptReview(sourceId, currentUser.id);
    request.then(value => { if (!cancelled) setReview(value); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '读取作答回顾失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sourceId, sourceType, currentUser.id]);

  const toggle = async (item: AnswerReviewItem) => {
    if (!review) return;
    const next = !item.needsReinforcement;
    setPending(item.questionId); setError('');
    try {
      if (sourceType === 'quiz_result') await setLegacyQuizReinforcement(review.id, item.questionId, { ownerId: currentUser.id, needsReinforcement: next });
      else await setPaperAttemptReinforcement(review.id, item.questionId, { ownerId: currentUser.id, needsReinforcement: next });
      setReview(previous => previous ? { ...previous, items: previous.items.map(value => value.questionId === item.questionId ? { ...value, needsReinforcement: next } : value) } : previous);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '更新需巩固状态失败，请重试'); }
    finally { setPending(null); }
  };

  if (loading) return <p role="status" className="p-6 text-slate-600"><Loader2 className="mr-2 inline animate-spin" size={18} />正在打开作答回顾</p>;
  if (error && !review) return <section className="mx-auto max-w-3xl"><button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2"><ArrowLeft size={18} />返回</button><p role="alert" className="mt-6 text-red-700">{error}</p></section>;
  if (!review) return null;
  return <section className="mx-auto max-w-4xl space-y-5" aria-labelledby="answer-review-title">
    <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 text-sm text-indigo-700"><ArrowLeft size={18} />返回智慧课堂</button>
    <header className="border border-slate-300 bg-white p-5"><p className="text-sm text-indigo-700">作答回顾</p><h1 id="answer-review-title" className="mt-1 text-xl font-semibold text-slate-900">{review.bookTitle || '原创试卷'}</h1>{review.chapter && <p className="mt-2 text-sm text-slate-600">{review.subject} · {review.chapter}</p>}</header>
    {error && <p role="alert" className="flex gap-2 border border-red-300 bg-red-50 p-3 text-sm text-red-800"><AlertCircle size={18} />{error}</p>}
    <div className="space-y-4">{review.items.map((item, index) => <article key={item.questionId} className="border border-slate-300 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-indigo-700">{TYPE_LABEL[item.type] || item.type} · 第 {index + 1} 题</p><button type="button" disabled={pending === item.questionId} aria-pressed={item.needsReinforcement} onClick={() => void toggle(item)} className={`inline-flex min-h-10 items-center gap-2 border px-3 text-sm font-medium disabled:opacity-50 ${item.needsReinforcement ? 'border-indigo-700 bg-indigo-50 text-indigo-800' : 'border-slate-400 text-slate-700'}`}><Bookmark size={16} fill={item.needsReinforcement ? 'currentColor' : 'none'} />{item.needsReinforcement ? '已加入需巩固' : '标记需巩固'}</button></div><p className="mt-3 whitespace-pre-wrap text-base font-medium leading-7 text-slate-900">{item.question || '该历史题未保留题目'}</p><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div className="border-l-2 border-slate-400 pl-3"><dt className="text-slate-500">我的答案</dt><dd className="mt-1 whitespace-pre-wrap text-slate-800">{item.studentAnswer || '未作答'}</dd></div><div className="border-l-2 border-indigo-500 pl-3"><dt className="text-slate-500">参考答案</dt><dd className="mt-1 whitespace-pre-wrap text-slate-800">{item.referenceAnswer || '该历史题未保留参考答案'}</dd></div></dl><div className="mt-4 border-l-2 border-amber-500 bg-amber-50 p-3 text-sm leading-6 text-slate-800"><strong>解析</strong><p className="mt-1 whitespace-pre-wrap">{item.explanation || '该历史题未保留解析'}</p></div></article>)}</div>
  </section>;
}
