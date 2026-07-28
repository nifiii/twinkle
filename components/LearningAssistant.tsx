import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardCheck, Loader2, Sparkles } from 'lucide-react';
import { UserProfile } from '../types';
import { createWrongReviewTask, fetchWrongProblemCandidates, WrongProblemCandidate } from '../services/learningAssistantApi';

const refKey = (item: WrongProblemCandidate) => `${item.source}:${item.source === 'scanned_item' ? item.scannedItemId : item.quizResultId}:${item.problemIndex}`;

interface LearningAssistantProps { currentUser: UserProfile; onOpenClassroom: () => void; }

const LearningAssistant: React.FC<LearningAssistantProps> = ({ currentUser, onOpenClassroom }) => {
  const [items, setItems] = useState<WrongProblemCandidate[]>([]);
  const [subject, setSubject] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [createdTitle, setCreatedTitle] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    fetchWrongProblemCandidates(currentUser.id)
      .then(data => { if (!cancelled) { setItems(data); setSubject(current => data.some(item => item.subject === current) ? current : (data[0]?.subject || '')); } })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '错题读取失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentUser.id]);

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

  return <section className="mx-auto max-w-6xl space-y-6" aria-labelledby="assistant-title">
    <header className="flex items-center gap-3 border-b border-cyber-border pb-5"><Sparkles className="text-neon-blue" aria-hidden="true" /><div><h1 id="assistant-title" className="text-2xl font-semibold text-cyber-text">学习小助手</h1><p className="mt-1 text-sm text-cyber-muted">{currentUser.name} 的错题讲解与测验</p></div></header>
    <div role="tablist" aria-label="学习来源" className="flex gap-2 overflow-x-auto"><button role="tab" aria-selected="true" className="min-h-11 border-b-2 border-neon-blue px-3 text-sm font-medium text-neon-blue">错题讲解与测验</button><button role="tab" aria-selected="false" disabled className="min-h-11 px-3 text-sm text-cyber-muted">教材章节学习</button></div>
    {error && <div role="alert" className="flex items-center gap-2 border border-red-300 bg-red-50 p-3 text-sm text-red-800"><AlertCircle size={18} />{error}</div>}
    {createdTitle && <div role="status" className="flex flex-wrap items-center justify-between gap-3 border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900"><span className="flex items-center gap-2"><CheckCircle2 size={18} />已生成“{createdTitle}”</span><button type="button" onClick={onOpenClassroom} className="min-h-11 border border-emerald-700 px-3 font-medium text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-700">进入智慧课堂</button></div>}
    {loading ? <div role="status" className="flex items-center gap-2 py-12 text-cyber-muted"><Loader2 className="animate-spin" />正在读取错题</div> : !items.length ? <div role="status" className="border border-cyber-border p-8 text-sm text-cyber-muted">暂无可用于讲解的错题。</div> : <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]"><div className="space-y-3"><label className="grid gap-2 text-sm font-medium text-cyber-text">学科<select value={subject} onChange={event => { setSubject(event.target.value); setSelected(new Set()); }} className="min-h-11 border border-cyber-border bg-white px-3 text-base text-slate-800 focus:outline-none focus:ring-2 focus:ring-neon-blue">{subjects.map(value => <option key={value}>{value}</option>)}</select></label>{visibleItems.map(item => { const checked = selected.has(refKey(item)); return <label key={refKey(item)} className="flex gap-3 border border-cyber-border p-4 text-left"><input type="checkbox" checked={checked} onChange={() => toggle(item)} className="mt-1 h-4 w-4" /><span className="min-w-0"><span className="text-sm font-medium text-cyber-text">{item.title}</span><span className="mt-1 block break-words text-sm text-cyber-muted">{item.contentExcerpt}</span>{item.knowledgePoints.length > 0 && <span className="mt-2 block text-xs text-neon-blue">{item.knowledgePoints.join(' · ')}</span>}</span></label>; })}</div><aside className="border border-cyber-border p-4"><div className="flex items-center gap-2 text-sm font-semibold text-cyber-text"><ClipboardCheck size={18} />本次选择</div><p className="mt-3 text-sm text-cyber-muted">已选 {selectedItems.length}/10 题</p>{knowledgePoints.length > 0 && <p className="mt-3 text-sm text-cyber-muted">{knowledgePoints.join(' · ')}</p>}<button type="button" disabled={!selectedItems.length || creating} onClick={create} className="mt-6 min-h-11 w-full bg-neon-blue px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-neon-blue">{creating ? '正在生成讲解与测验' : '生成讲解与测验'}</button></aside></div>}
  </section>;
};

export default LearningAssistant;
