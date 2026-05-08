import React, { useState } from 'react';
import { ClipboardCheck, Sparkles, Loader2, CheckCircle, AlertCircle, GraduationCap, BookOpen, Save, RefreshCw, X } from 'lucide-react';
import { EBook, ChapterNode, ScannedItem } from '../types';

export interface Question {
  id: string;
  type: 'choice' | 'fill' | 'essay';
  question: string;
  options?: string[];
  answer: string;
  explanation: string;
}

interface QuizGeneratorProps {
  selectedBook: EBook;
  selectedChapters: ChapterNode[];
  wrongProblems: ScannedItem[];
  coursewareContent?: string;
  studentName: string;
  ownerId?: string;
  onStartExam?: (quizId: string, questions: Question[]) => void;
}

const TYPE_LABELS: Record<Question['type'], string> = {
  choice: '选择题', fill: '填空题', essay: '解答题',
};

const DIFFICULTY_OPTIONS = [
  {
    level: 1,
    label: '⭐ 1星',
    sublabel: '全基础',
    desc: '100% 基础题，单章 选择×5 + 填空×4',
    color: 'green',
  },
  {
    level: 2,
    label: '⭐⭐ 2星',
    sublabel: '基础+提高',
    desc: '70% 基础 + 30% 提高，单章 选择×4 + 填空×3 + 解答×2',
    color: 'blue',
  },
  {
    level: 3,
    label: '⭐⭐⭐ 3星',
    sublabel: '综合挑战',
    desc: '50% 基础 + 30% 提高 + 20% 进阶，单章 选择×4 + 填空×3 + 解答×3',
    color: 'purple',
  },
];

// 单章基础题量
const BASE_COUNT_PER_CHAPTER: Record<number, number> = { 1: 9, 2: 9, 3: 10 };

export const QuizGenerator: React.FC<QuizGeneratorProps> = ({
  selectedBook, selectedChapters, wrongProblems,
  coursewareContent, studentName, ownerId, onStartExam,
}) => {
  const [difficultyLevel, setDifficultyLevel] = useState(2);
  const [generating, setGenerating] = useState(false);
  const [previewQuestions, setPreviewQuestions] = useState<Question[] | null>(null);
  const [savedQuestions, setSavedQuestions] = useState<Question[]>([]);
  const [savedId, setSavedId] = useState<string>('');
  const [error, setError] = useState<string>('');

  const chapterCount = selectedChapters.length;
  const expectedTotal = (BASE_COUNT_PER_CHAPTER[difficultyLevel] || 9) * chapterCount;

  // 生成（仅预览，不保存）
  const handleGenerate = async () => {
    try {
      setGenerating(true);
      setError('');
      setPreviewQuestions(null);

      const response = await fetch('/api/generate-assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookTitle: selectedBook.title,
          subject: selectedBook.subject,
          chapters: selectedChapters.map(c => c.title),
          chapter: selectedChapters.map(c => c.title).join('；'),
          chapterCount,
          studentName,
          difficultyLevel,
          autoSave: false,
          wrongProblems: wrongProblems.slice(0, 10),
          coursewareContent: coursewareContent || '',
          ownerId: ownerId || 'shared',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `生成失败 (${response.status})`);
      }

      const result = await response.json();
      if (!result.success) throw new Error(result.error || '生成失败');

      setPreviewQuestions(result.data);
    } catch (err) {
      console.error('生成测验失败:', err);
      setError(err instanceof Error ? err.message : '生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  };

  // 用户在预览模态确认保存
  const handleConfirmSave = async () => {
    if (!previewQuestions) return;
    try {
      setGenerating(true);
      setError('');
      const response = await fetch('/api/generate-assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookTitle: selectedBook.title,
          subject: selectedBook.subject,
          chapters: selectedChapters.map(c => c.title),
          chapter: selectedChapters.map(c => c.title).join('；'),
          chapterCount,
          studentName,
          difficultyLevel,
          autoSave: true,
          wrongProblems: wrongProblems.slice(0, 10),
          coursewareContent: coursewareContent || '',
          ownerId: ownerId || 'shared',
          existingQuestions: previewQuestions,
        }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '保存失败');
      setSavedQuestions(result.data || previewQuestions);
      setSavedId(result.id || '');
      setPreviewQuestions(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请重试');
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = () => {
    setPreviewQuestions(null);
    handleGenerate();
  };

  const handleCloseModal = () => setPreviewQuestions(null);

  return (
    <div className="space-y-6 relative">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <ClipboardCheck className="w-6 h-6 text-green-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-gray-800 mb-1">配套测验题</h3>
            <p className="text-sm text-gray-600">
              基于《{selectedBook.title}》共 {chapterCount} 章：{selectedChapters.map(c => c.title).join('、')}
            </p>
          </div>
        </div>
      </div>

      {/* 未保存：难度选择 */}
      {savedQuestions.length === 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h4 className="font-semibold text-gray-800 mb-4">选择难度</h4>
          <div className="space-y-3 mb-6">
            {DIFFICULTY_OPTIONS.map(opt => (
              <button
                key={opt.level}
                onClick={() => setDifficultyLevel(opt.level)}
                className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                  difficultyLevel === opt.level
                    ? `border-${opt.color}-500 bg-${opt.color}-50`
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-800">{opt.label}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full bg-${opt.color}-100 text-${opt.color}-700 font-medium`}>
                        {opt.sublabel}
                      </span>
                      <span className="text-xs text-gray-500">
                        × {chapterCount} 章 ≈ {(BASE_COUNT_PER_CHAPTER[opt.level] || 9) * chapterCount} 题
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">{opt.desc}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {wrongProblems.length > 0 && (
            <div className="mb-4 p-3 bg-orange-50 rounded-lg border border-orange-200">
              <p className="text-sm text-orange-800">
                ⚠️ 已检测到 {wrongProblems.length} 道错题，将针对性强化薄弱环节
              </p>
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium disabled:bg-gray-400"
          >
            {generating ? <><Loader2 className="w-4 h-4 animate-spin" />生成中...</> : <><Sparkles className="w-4 h-4" />生成测验预览（约 {expectedTotal} 题）</>}
          </button>

          {error && (
            <div className="mt-4 flex items-center gap-3 p-4 bg-red-50 rounded-lg border border-red-200">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <span className="text-sm text-red-800">{error}</span>
            </div>
          )}
        </div>
      )}

      {/* 已保存：题目列表 */}
      {savedQuestions.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <span className="font-semibold text-gray-800">测验已保存（{savedQuestions.length} 道题）</span>
              {savedId && (
                <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full flex items-center gap-1">
                  <GraduationCap className="w-3 h-3" />已同步到 AI 课堂
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {onStartExam && savedId && (
                <button
                  onClick={() => onStartExam(savedId, savedQuestions)}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
                >
                  <BookOpen className="w-4 h-4" />前往考试
                </button>
              )}
              <button
                onClick={() => { setSavedQuestions([]); setSavedId(''); }}
                className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-white text-xs font-medium flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />重新生成
              </button>
            </div>
          </div>

          <div className="p-6 space-y-4 max-h-[500px] overflow-y-auto">
            {savedQuestions.map((q, idx) => (
              <div key={q.id} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-start gap-3">
                  <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                    q.type === 'choice' ? 'bg-blue-100 text-blue-700' :
                    q.type === 'fill' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-purple-100 text-purple-700'
                  }`}>
                    {TYPE_LABELS[q.type]}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">{idx + 1}. {q.question}</p>
                    {q.type === 'choice' && q.options && (
                      <div className="mt-2 space-y-1">
                        {q.options.map((opt, i) => <p key={i} className="text-xs text-gray-600 pl-2">{opt}</p>)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 生成中全屏遮罩 */}
      {generating && (
        <div className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white rounded-2xl px-8 py-6 shadow-2xl flex items-center gap-4">
            <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
            <div>
              <div className="font-semibold text-gray-800">AI 正在生成测验</div>
              <div className="text-sm text-gray-500 mt-0.5">请勿关闭页面，预计 30 秒–2 分钟</div>
            </div>
          </div>
        </div>
      )}

      {/* 预览模态 */}
      {previewQuestions && !generating && (
        <div className="fixed inset-0 z-[250] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-green-600" />
                <h3 className="font-semibold text-gray-800">测验预览（{previewQuestions.length} 道题）</h3>
                <span className="text-xs text-gray-500">— 请确认是否保存</span>
              </div>
              <button onClick={handleCloseModal} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {previewQuestions.map((q, idx) => (
                <div key={q.id} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-start gap-3">
                    <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                      q.type === 'choice' ? 'bg-blue-100 text-blue-700' :
                      q.type === 'fill' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-purple-100 text-purple-700'
                    }`}>
                      {TYPE_LABELS[q.type]}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800">{idx + 1}. {q.question}</p>
                      {q.type === 'choice' && q.options && (
                        <div className="mt-2 space-y-1">
                          {q.options.map((opt, i) => <p key={i} className="text-xs text-gray-600 pl-2">{opt}</p>)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex gap-3 justify-end">
              <button
                onClick={handleRegenerate}
                className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-white text-sm font-medium"
              >
                <RefreshCw className="w-4 h-4" />重新生成
              </button>
              <button
                onClick={handleConfirmSave}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
              >
                <Save className="w-4 h-4" />保存到 AI 课堂
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
