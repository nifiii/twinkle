import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import {
  AlertCircle, CheckCircle, Loader2, RefreshCw, Eye, X,
  FileText, ClipboardCheck, AlertTriangle,
  Sparkles, Save, GraduationCap,
} from 'lucide-react';
import { UserProfile } from '../types';
import { Badge } from './ui';

interface WrongProblemItem {
  scannedItemId: string;
  problemIndex: number;
  ownerId: string;
  userName: string;
  subject: string;
  timestamp: number;
  snippet: string;
  content: string;
  standardAnswer: string;
  studentAnswer: string;
  teacherComment: string;
  correction: string;
  explanation: string;
  knowledgePoints: string[];
  hasAnswer: boolean;
  alreadyGenerated: boolean;
}

interface Slide {
  index: number;
  chapter: string;
  title: string;
  content: string;
  notes: string;
}

interface QuizQuestion {
  id: string;
  type: string;
  question: string;
  options?: string[];
  answer: string;
  explanation: string;
}

interface DraftCourseware {
  scannedItemId: string;
  problemIndex: number;
  subject: string;
  content: string;
  slides: Slide[];
}

interface DraftQuiz {
  scannedItemId: string;
  problemIndex: number;
  subject: string;
  questions: QuizQuestion[];
}

type WPStep = 'select' | 'courseware' | 'quiz' | 'done';
type Busy = null | { kind: 'gen-cw' | 'save-cw' | 'gen-qz' | 'save-qz'; title: string; hint: string };

interface Props {
  currentUser: UserProfile;
}

const SUBJECTS = ['语文', '数学', '英语', '科学', '物理', '化学', '生物', '历史', '地理', '政治'];
const MAX_SELECT = 10;

const TYPE_LABELS: Record<string, string> = { choice: '选择题', fill: '填空题', essay: '解答题' };

const itemKey = (it: { scannedItemId: string; problemIndex: number }) =>
  `${it.scannedItemId}:${it.problemIndex}`;

// 错题详情弹窗:复用 KnowledgeHub 错题卡片样式
const WrongProblemDetailModal: React.FC<{ item: WrongProblemItem; onClose: () => void }> = ({ item, onClose }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    className="fixed inset-0 z-[260] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
    onClick={onClose}
  >
    <motion.div
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">{item.subject}</span>
          <span className="text-xs text-gray-400">{new Date(item.timestamp).toLocaleString('zh-CN')}</span>
          {item.userName && <span className="text-xs text-gray-400">· {item.userName}</span>}
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
          <X className="w-5 h-5 text-gray-500" />
        </button>
      </div>
      <div className="overflow-y-auto p-6 space-y-4">
        <div className="space-y-4">
          <div className="text-gray-800 leading-relaxed font-medium">
            <div className="markdown-content prose prose-sm max-w-none">
              <ReactMarkdown
                components={{
                  p: ({ node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
                  blockquote: ({ node, ...props }) => (
                    <blockquote className="border-l-4 border-gray-200 pl-3 italic bg-gray-50 py-1 my-2 rounded" {...props} />
                  ),
                }}
              >
                {item.content || '(未识别题干)'}
              </ReactMarkdown>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-100">
            <div className="space-y-1">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">学生作答</span>
              <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">
                {item.studentAnswer || '(未填写)'}
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">标准答案</span>
              <div className="p-3 bg-blue-50 text-blue-700 rounded-xl text-sm">
                {item.standardAnswer || '(暂无)'}
              </div>
            </div>
          </div>

          {(item.teacherComment || item.correction) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {item.teacherComment && (
                <div className="space-y-1">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">老师批注</span>
                  <div className="p-3 bg-amber-50 text-amber-700 rounded-xl text-sm border border-amber-100">
                    {item.teacherComment}
                  </div>
                </div>
              )}
              {item.correction && (
                <div className="space-y-1">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">订正内容</span>
                  <div className="p-3 bg-indigo-50 text-indigo-700 rounded-xl text-sm border border-indigo-100">
                    {item.correction}
                  </div>
                </div>
              )}
            </div>
          )}

          {item.knowledgePoints && item.knowledgePoints.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {item.knowledgePoints.map(kp => (
                <Badge key={kp} variant="outline" size="sm">#{kp}</Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  </motion.div>
);

// 全屏遮罩:与 CoursewareGenerator/QuizGenerator 风格一致
const BusyOverlay: React.FC<{ busy: Busy; accent: 'amber' | 'blue' | 'green' }> = ({ busy, accent }) => {
  if (!busy) return null;
  const color = accent === 'amber' ? 'text-amber-600' : accent === 'blue' ? 'text-blue-600' : 'text-green-600';
  return (
    <div className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-white rounded-2xl px-8 py-6 shadow-2xl flex items-center gap-4">
        <Loader2 className={`w-8 h-8 animate-spin ${color}`} />
        <div>
          <div className="font-semibold text-gray-800">{busy.title}</div>
          <div className="text-sm text-gray-500 mt-0.5">{busy.hint}</div>
        </div>
      </div>
    </div>
  );
};

// 讲解预览卡片:对齐 CoursewareGenerator 的 SectionCard 风格
const CoursewareSectionCard: React.FC<{ slide: Slide; isLast: boolean }> = ({ slide, isLast }) => {
  const isSummary = isLast && (slide.title.includes('小结') || slide.title.includes('总结'));
  return (
    <div className={`rounded-lg border overflow-hidden ${isSummary ? 'border-indigo-200 bg-indigo-50' : 'border-gray-200 bg-white shadow-sm'}`}>
      <div className={`px-5 py-2.5 flex items-center gap-2 ${isSummary ? 'bg-indigo-100' : 'bg-gray-50 border-b border-gray-200'}`}>
        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${isSummary ? 'bg-indigo-600 text-white' : 'bg-blue-100 text-blue-700'}`}>
          {isSummary ? '📋 小结' : `第 ${slide.index} 节`}
        </span>
        <h3 className={`font-semibold text-sm ${isSummary ? 'text-indigo-800' : 'text-gray-800'}`}>{slide.title}</h3>
      </div>
      <div className="px-5 py-4">
        <div className={`text-sm leading-relaxed whitespace-pre-wrap ${isSummary ? 'text-indigo-900' : 'text-gray-700'}`}>
          {slide.content}
        </div>
        {slide.notes && !isSummary && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900 whitespace-pre-line leading-relaxed">
            {slide.notes}
          </div>
        )}
      </div>
    </div>
  );
};

const CoursewarePreviewBlock: React.FC<{ item: WrongProblemItem; draft: DraftCourseware }> = ({ item, draft }) => (
  <div className="border border-blue-200 rounded-xl overflow-hidden bg-blue-50/30">
    <div className="bg-blue-50 px-4 py-2.5 border-b border-blue-100 flex items-center gap-2">
      <FileText className="w-4 h-4 text-blue-600" />
      <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">{draft.subject}</span>
      <span className="text-sm text-gray-700 truncate flex-1 font-medium">{item.snippet || item.content.slice(0, 40)}</span>
      <span className="text-xs text-gray-500">{draft.slides.length} 节</span>
    </div>
    <div className="p-4 space-y-3">
      {draft.slides.map((s, i) => <CoursewareSectionCard key={s.index} slide={s} isLast={i === draft.slides.length - 1} />)}
    </div>
  </div>
);

// 测验预览卡片:对齐 QuizGenerator 的题目卡片风格
const QuizPreviewBlock: React.FC<{ item: WrongProblemItem; draft: DraftQuiz }> = ({ item, draft }) => (
  <div className="border border-green-200 rounded-xl overflow-hidden bg-green-50/30">
    <div className="bg-green-50 px-4 py-2.5 border-b border-green-100 flex items-center gap-2">
      <ClipboardCheck className="w-4 h-4 text-green-600" />
      <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">{draft.subject}</span>
      <span className="text-sm text-gray-700 truncate flex-1 font-medium">{item.snippet || item.content.slice(0, 40)}</span>
      <span className="text-xs text-gray-500">{draft.questions.length} 题</span>
    </div>
    <div className="p-4 space-y-3">
      {draft.questions.map((q, i) => (
        <div key={q.id || i} className="p-4 bg-white rounded-lg border border-gray-200">
          <div className="flex items-start gap-3">
            <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
              q.type === 'choice' ? 'bg-blue-100 text-blue-700' :
              q.type === 'fill' ? 'bg-yellow-100 text-yellow-700' :
              'bg-purple-100 text-purple-700'
            }`}>
              {TYPE_LABELS[q.type] || q.type}
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-800">{i + 1}. {q.question}</p>
              {q.options && q.options.length > 0 && (
                <div className="mt-2 space-y-1">
                  {q.options.map((opt, oi) => <p key={oi} className="text-xs text-gray-600 pl-2">{opt}</p>)}
                </div>
              )}
              <div className="mt-2 text-xs">
                <span className="text-gray-500">参考答案:</span>
                <span className="text-green-700 font-medium ml-1">{q.answer}</span>
              </div>
              {q.explanation && (
                <div className="mt-1 text-xs text-gray-500 line-clamp-2">
                  <span className="font-semibold">解析:</span> {q.explanation}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export const WrongProblemQuizGenerator: React.FC<Props> = ({ currentUser }) => {
  // 步骤
  const [step, setStep] = useState<WPStep>('select');
  // 列表/筛选
  const [subject, setSubject] = useState<string>('语文');
  const [items, setItems] = useState<WrongProblemItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [excludeGenerated, setExcludeGenerated] = useState(true);
  const [loading, setLoading] = useState(false);
  // 详情弹窗
  const [detailItem, setDetailItem] = useState<WrongProblemItem | null>(null);
  // 拣选 + 草稿
  const [picks, setPicks] = useState<WrongProblemItem[]>([]);
  const [cwDrafts, setCwDrafts] = useState<DraftCourseware[]>([]);
  const [cwSavedMap, setCwSavedMap] = useState<Map<string, string>>(new Map());
  const [qzDrafts, setQzDrafts] = useState<DraftQuiz[]>([]);
  // 异步态
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string>('');
  const [resultMsg, setResultMsg] = useState<string>('');

  // ---------- 数据加载 ----------
  const loadList = useCallback(async () => {
    if (!subject) return;
    setLoading(true);
    setError('');
    setSelected(new Set());
    try {
      const url = `/api/wrong-problems?ownerId=${encodeURIComponent(currentUser.id)}&subject=${encodeURIComponent(subject)}${excludeGenerated ? '&excludeGenerated=1' : ''}`;
      const r = await fetch(url);
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '加载失败');
      setItems(j.data || []);
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [subject, currentUser.id, excludeGenerated]);

  useEffect(() => {
    if (subject) loadList();
    else setItems([]);
  }, [subject, excludeGenerated, loadList]);

  // ---------- Step 1: 选择 ----------
  const toggle = (it: WrongProblemItem) => {
    if (!it.hasAnswer) return;
    const k = itemKey(it);
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else {
      if (next.size >= MAX_SELECT) return;
      next.add(k);
    }
    setSelected(next);
  };

  const handleConfirmSelect = async () => {
    const chosen = items.filter(it => selected.has(itemKey(it)));
    if (chosen.length === 0) return;

    setPicks(chosen);
    setStep('courseware');
    await generateCourseware(chosen);
  };

  // ---------- Step 2: 讲解 ----------
  const generateCourseware = async (chosen: WrongProblemItem[]) => {
    setBusy({
      kind: 'gen-cw',
      title: 'AI 正在生成错题讲解',
      hint: `共 ${chosen.length} 道,预计 30 秒至 2 分钟,请勿关闭页面`,
    });
    setError('');
    setCwDrafts([]);
    try {
      const r = await fetch('/api/wrong-problem-quiz/generate-courseware', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: chosen.map(p => ({ scannedItemId: p.scannedItemId, problemIndex: p.problemIndex })),
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '生成失败');
      setCwDrafts(j.data.generated || []);
      if ((j.data.failed || []).length > 0) {
        setError(`部分讲解生成失败:${j.data.failed.length} 道。可重新生成或返回剔除。`);
      }
    } catch (e: any) {
      setError(e.message || '生成失败');
    } finally {
      setBusy(null);
    }
  };

  const handleRegenerateCw = async () => {
    await generateCourseware(picks);
  };

  const handleSaveCw = async () => {
    if (cwDrafts.length === 0) return;
    setBusy({
      kind: 'save-cw',
      title: '正在保存到 AI 课堂',
      hint: '保存讲解内容,稍候将自动生成配套测验',
    });
    setError('');
    try {
      const r = await fetch('/api/wrong-problem-quiz/save-courseware', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: currentUser.id,
          userName: currentUser.name,
          items: cwDrafts.map(d => ({
            scannedItemId: d.scannedItemId,
            problemIndex: d.problemIndex,
            slides: d.slides,
          })),
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '保存失败');
      const savedMap = new Map<string, string>();
      for (const s of (j.data.saved || [])) {
        savedMap.set(`${s.scannedItemId}:${s.problemIndex}`, s.coursewareId);
      }
      setCwSavedMap(savedMap);
      const survivors = picks.filter(p => savedMap.has(itemKey(p)));
      if (survivors.length === 0) {
        throw new Error('没有讲解保存成功,无法进入下一步');
      }
      setPicks(survivors);
      setStep('quiz');
      await generateQuiz(survivors);
    } catch (e: any) {
      setError(e.message || '保存失败');
      setBusy(null);
    }
  };

  // ---------- Step 3: 测验 ----------
  const generateQuiz = async (chosen: WrongProblemItem[]) => {
    setBusy({
      kind: 'gen-qz',
      title: 'AI 正在生成错题测验',
      hint: `共 ${chosen.length} 道,每道生成 3 道同类型试题`,
    });
    setError('');
    setQzDrafts([]);
    try {
      const r = await fetch('/api/wrong-problem-quiz/generate-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: chosen.map(p => ({ scannedItemId: p.scannedItemId, problemIndex: p.problemIndex })),
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '生成失败');
      setQzDrafts(j.data.generated || []);
      if ((j.data.failed || []).length > 0) {
        setError(`部分测验生成失败:${j.data.failed.length} 道。`);
      }
    } catch (e: any) {
      setError(e.message || '生成失败');
    } finally {
      setBusy(null);
    }
  };

  const handleRegenerateQz = async () => {
    await generateQuiz(picks);
  };

  const handleSaveQz = async () => {
    if (qzDrafts.length === 0) return;
    setBusy({
      kind: 'save-qz',
      title: '正在保存到 AI 课堂',
      hint: '保存测验内容,完成后可在 AI 课堂查看',
    });
    setError('');
    try {
      const r = await fetch('/api/wrong-problem-quiz/save-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: currentUser.id,
          userName: currentUser.name,
          items: qzDrafts.map(d => {
            const cwId = cwSavedMap.get(`${d.scannedItemId}:${d.problemIndex}`);
            return {
              scannedItemId: d.scannedItemId,
              problemIndex: d.problemIndex,
              coursewareId: cwId,
              questions: d.questions,
            };
          }).filter(x => !!x.coursewareId),
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '保存失败');
      const savedCount = (j.data.saved || []).length;
      const failCount = (j.data.failed || []).length;
      setResultMsg(`成功生成并保存 ${savedCount} 道错题的讲解 + 测验${failCount > 0 ? `(${failCount} 道测验保存失败)` : ''}。已同步到 AI 课堂"错题测验"。`);
      setStep('done');
    } catch (e: any) {
      setError(e.message || '保存失败');
    } finally {
      setBusy(null);
    }
  };

  // ---------- 重置 ----------
  const handleReset = () => {
    setStep('select');
    setPicks([]);
    setCwDrafts([]);
    setCwSavedMap(new Map());
    setQzDrafts([]);
    setError('');
    setResultMsg('');
    setSelected(new Set());
    if (subject) loadList();
  };

  // ---------- 步骤指示器(可点击按钮) ----------
  // 启用规则:
  // - select 始终可点
  // - courseware 需 picks.length>0(已确认选择)
  // - quiz 需 cwSavedMap.size>0(讲解已保存)
  // 任何 LLM/保存流程进行中(busy)禁止跳转,避免打断异步态。
  const renderSteps = () => {
    const steps = [
      { key: 'select' as WPStep, label: '选择错题', icon: AlertTriangle,
        enabled: !busy },
      { key: 'courseware' as WPStep, label: '错题讲解', icon: FileText,
        enabled: !busy && picks.length > 0 },
      { key: 'quiz' as WPStep, label: '错题测验', icon: ClipboardCheck,
        enabled: !busy && cwSavedMap.size > 0 },
    ];
    const idx = step === 'done' ? 3 : steps.findIndex(s => s.key === step);
    return (
      <div className="flex items-center justify-center gap-3 mb-6 flex-wrap">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const isActive = i === idx;
          const isDone = i < idx;
          return (
            <React.Fragment key={s.key}>
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 }}
                disabled={!s.enabled || isActive}
                onClick={() => s.enabled && !isActive && setStep(s.key)}
                title={!s.enabled ? '请先完成上一步' : isActive ? '当前步骤' : `跳转到「${s.label}」`}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all border ${
                  isActive
                    ? 'bg-gradient-to-r from-neon-blue/25 to-neon-purple/15 text-neon-blue border-neon-blue/50 shadow-glow-sm scale-105'
                    : isDone
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/15'
                    : s.enabled
                    ? 'bg-cyber-surface/60 text-cyber-text border-cyber-border/60 hover:border-neon-blue/50 hover:text-neon-blue'
                    : 'bg-cyber-surface/30 text-cyber-muted/50 border-cyber-border/30 cursor-not-allowed'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{s.label}</span>
                {isDone && !isActive && <span className="text-xs">✓</span>}
              </motion.button>
              {i < steps.length - 1 && (
                <div className="w-6 h-0.5 bg-cyber-border/60" />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  // 当前步骤的强调色
  const stepAccent: 'amber' | 'blue' | 'green' =
    step === 'select' ? 'amber' :
    step === 'courseware' ? 'blue' :
    step === 'quiz' ? 'green' :
    'green';

  return (
    <div className="space-y-6 relative">
      <BusyOverlay busy={busy} accent={stepAccent} />
      {detailItem && <WrongProblemDetailModal item={detailItem} onClose={() => setDetailItem(null)} />}

      {/* 步骤指示器 — 与「教材课件」三步骤同款 */}
      {renderSteps()}

      {/* ===== Step 1:选择错题 ===== */}
      {step === 'select' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
          <div className="flex items-baseline gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-500" />
              <h4 className="font-semibold text-gray-800">选择学科与错题</h4>
            </div>
            <span className="text-xs text-gray-500">
              （AI 将分步生成"错题讲解 + 错题测验",每步可预览 / 重新生成 / 保存到 AI 课堂,最多一次 {MAX_SELECT} 道）
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-700 mr-1">学科:</span>
            {SUBJECTS.map(s => (
              <button
                key={s}
                onClick={() => setSubject(s)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                  subject === s ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-700 border-gray-200 hover:border-amber-300'
                }`}
              >
                {s}
              </button>
            ))}
            {subject && (
              <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={excludeGenerated}
                  onChange={e => setExcludeGenerated(e.target.checked)}
                />
                仅显示未生成
              </label>
            )}
          </div>

          {!subject ? (
            <div className="text-center text-gray-400 py-12">请先选择学科</div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-gray-400 py-12">
              该学科暂无{excludeGenerated ? '可生成的' : ''}错题。
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>共 {items.length} 道错题,已选 {selected.size}/{MAX_SELECT}</span>
                <button onClick={loadList} className="flex items-center gap-1 hover:text-amber-600">
                  <RefreshCw className="w-3 h-3" /> 刷新
                </button>
              </div>
              <div className="border rounded-lg divide-y max-h-[420px] overflow-y-auto">
                {items.map(it => {
                  const k = itemKey(it);
                  const checked = selected.has(k);
                  const disabled = !it.hasAnswer;
                  const date = new Date(it.timestamp).toLocaleDateString('zh-CN');
                  return (
                    <div
                      key={k}
                      className={`flex items-start gap-3 p-3 transition ${
                        disabled ? 'opacity-60 bg-gray-50' : 'hover:bg-amber-50'
                      } ${checked ? 'bg-amber-50' : ''}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 cursor-pointer"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(it)}
                      />
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => !disabled && toggle(it)}>
                        <div className="text-sm text-gray-800 line-clamp-2">{it.snippet || '(未识别题干)'}</div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 flex-wrap">
                          <span>{it.subject}</span>
                          <span>·</span>
                          <span>{date}</span>
                          {it.knowledgePoints.length > 0 && (
                            <>
                              <span>·</span>
                              <span className="text-amber-600">{it.knowledgePoints.slice(0, 2).join('、')}</span>
                            </>
                          )}
                          {disabled && (
                            <span className="ml-1 text-amber-600">原题缺解析无法生成</span>
                          )}
                          {it.alreadyGenerated && (
                            <span className="ml-1 text-mint-600">已生成</span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDetailItem(it)}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-white border border-gray-200 text-gray-600 hover:border-amber-400 hover:text-amber-600 flex-shrink-0"
                      >
                        <Eye className="w-3 h-3" /> 查看详情
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <button
            onClick={handleConfirmSelect}
            disabled={selected.size === 0}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium disabled:bg-gray-400"
          >
            <Sparkles className="w-4 h-4" />
            生成错题讲解预览(已选 {selected.size} 道)
          </button>
        </div>
      )}

      {/* ===== Step 2:讲解预览 ===== */}
      {step === 'courseware' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              <h4 className="font-semibold text-gray-800">错题讲解预览({cwDrafts.length} 道)</h4>
              <span className="text-xs text-gray-500">— 请确认是否保存</span>
            </div>
          </div>

          <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
            {cwDrafts.map(d => {
              const item = picks.find(p => itemKey(p) === itemKey(d));
              if (!item) return null;
              return <CoursewarePreviewBlock key={itemKey(d)} item={item} draft={d} />;
            })}
            {cwDrafts.length === 0 && !busy && (
              <div className="text-center text-gray-400 py-8">暂无讲解预览,点击"重新生成"重试</div>
            )}
          </div>

          <div className="flex gap-3 justify-between flex-wrap">
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
            >
              返回选择
            </button>
            <div className="flex gap-3">
              <button
                onClick={handleRegenerateCw}
                className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-white text-sm font-medium"
              >
                <RefreshCw className="w-4 h-4" />重新生成
              </button>
              <button
                onClick={handleSaveCw}
                disabled={cwDrafts.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:bg-gray-400"
              >
                <Save className="w-4 h-4" />保存到 AI 课堂
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Step 3:测验预览 ===== */}
      {step === 'quiz' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-green-600" />
              <h4 className="font-semibold text-gray-800">错题测验预览({qzDrafts.length} 道)</h4>
              <span className="text-xs text-gray-500">— 每道错题生成 3 道同类型试题</span>
            </div>
          </div>

          <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
            {qzDrafts.map(d => {
              const item = picks.find(p => itemKey(p) === itemKey(d));
              if (!item) return null;
              return <QuizPreviewBlock key={itemKey(d)} item={item} draft={d} />;
            })}
            {qzDrafts.length === 0 && !busy && (
              <div className="text-center text-gray-400 py-8">暂无测验预览,点击"重新生成"重试</div>
            )}
          </div>

          <div className="flex gap-3 justify-between flex-wrap">
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
            >
              重新开始
            </button>
            <div className="flex gap-3">
              <button
                onClick={handleRegenerateQz}
                className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-white text-sm font-medium"
              >
                <RefreshCw className="w-4 h-4" />重新生成
              </button>
              <button
                onClick={handleSaveQz}
                disabled={qzDrafts.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium disabled:bg-gray-400"
              >
                <Save className="w-4 h-4" />保存到 AI 课堂
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Step 4:完成 ===== */}
      {step === 'done' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="font-semibold text-gray-800">已完成</span>
            <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full flex items-center gap-1">
              <GraduationCap className="w-3 h-3" />已同步到 AI 课堂
            </span>
          </div>
          <p className="text-sm text-gray-700 mb-4">{resultMsg}</p>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm font-medium"
          >
            <RefreshCw className="w-4 h-4" />继续生成
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 rounded-lg border border-red-200">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <span className="text-sm text-red-700">{error}</span>
        </div>
      )}
    </div>
  );
};
