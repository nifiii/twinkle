import React, { useState } from 'react';
import { CheckCircle, XCircle, AlertCircle, Loader2, BookOpen, Award, RotateCcw, X } from 'lucide-react';
import { Question } from './QuizGenerator';

interface QuizExamProps {
  quizId: string;
  questions: Question[];
  bookTitle: string;
  chapter: string;
  subject?: string;
  studentName: string;
  ownerId?: string;
  onClose: () => void;
  // 提交后跳转到测验记录页（resultId 用于后续可选高亮）
  onSubmitted?: (resultId: string) => void;
}

type ExamPhase = 'exam' | 'grading' | 'result';

interface GradeResult {
  id: string;
  type: string;
  question: string;
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean | null;
  explanation: string;
}

interface GradeResponse {
  correctCount: number;
  total: number;
  wrongCount: number;
  results: GradeResult[];
  suggestions: string;
}

const TYPE_LABELS: Record<string, string> = {
  choice: '选择题', fill: '填空题', essay: '解答题',
};

export const QuizExam: React.FC<QuizExamProps> = ({
  quizId, questions, bookTitle, chapter, subject, studentName, ownerId, onClose, onSubmitted,
}) => {
  const [phase, setPhase] = useState<ExamPhase>('exam');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [gradeData, setGradeData] = useState<GradeResponse | null>(null);
  const [grading, setGrading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setAnswer = (id: string, val: string) => {
    setAnswers(prev => ({ ...prev, [id]: val }));
  };

  // 提交试卷 → 后端立即落库 status=grading → 后台异步批改 → 跳转测验记录
  const handleSubmit = async () => {
    try {
      setGrading(true);
      setError('');

      const response = await fetch('/api/quiz-result/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quizId,
          questions,
          answers,
          bookTitle,
          chapter,
          subject: subject || '',
          ownerId: ownerId || 'shared',
          userName: studentName,
        }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '提交失败');
      }

      // 跳转到测验记录页，由父组件接管显示「批改中」/「已完成」状态
      if (onSubmitted) {
        onSubmitted(result.id);
      } else {
        onClose();
      }
    } catch (err) {
      console.error('提交失败:', err);
      setError(err instanceof Error ? err.message : '提交失败，请重试');
    } finally {
      setGrading(false);
    }
  };

  // 答题阶段
  if (phase === 'exam') {
    return (
      <div className="space-y-6">
        {/* 考试头部 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <BookOpen className="w-6 h-6 text-green-600" />
                在线考试
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                《{bookTitle}》{chapter} · {studentName} · 共 {questions.length} 题
              </p>
            </div>
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold shadow-sm hover:shadow-md transition-all flex-shrink-0"
            >
              <X className="w-4 h-4" />
              退出
            </button>
          </div>
        </div>

        {/* 题目列表 */}
        <div className="space-y-4">
          {questions.map((q, idx) => (
            <div key={q.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-start gap-3 mb-4">
                <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                  q.type === 'choice' ? 'bg-blue-100 text-blue-700' :
                  q.type === 'fill' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-purple-100 text-purple-700'
                }`}>
                  {TYPE_LABELS[q.type] || q.type}
                </span>
                <p className="text-gray-800 font-medium">
                  {idx + 1}. {q.question}
                </p>
              </div>

              {/* 选择题 */}
              {q.type === 'choice' && q.options && (
                <div className="space-y-2 pl-6">
                  {q.options.map((opt, i) => {
                    const letter = opt.charAt(0);
                    const selected = answers[q.id] === letter;
                    return (
                      <button
                        key={i}
                        onClick={() => setAnswer(q.id, letter)}
                        className={`w-full text-left p-3 rounded-lg border transition-colors ${
                          selected
                            ? 'border-blue-500 bg-blue-50 text-blue-800'
                            : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 填空题 */}
              {q.type === 'fill' && (
                <div className="pl-6">
                  <input
                    type="text"
                    value={answers[q.id] || ''}
                    onChange={e => setAnswer(q.id, e.target.value)}
                    placeholder="请填写答案..."
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              )}

              {/* 解答题 */}
              {q.type === 'essay' && (
                <div className="pl-6">
                  <textarea
                    value={answers[q.id] || ''}
                    onChange={e => setAnswer(q.id, e.target.value)}
                    placeholder="请写出解题过程和答案..."
                    rows={4}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-50 rounded-lg border border-red-200">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <span className="text-sm text-red-800">{error}</span>
          </div>
        )}

        {/* 提交按钮 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <button
            onClick={handleSubmit}
            disabled={grading}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {grading ? (
              <><Loader2 className="w-5 h-5 animate-spin" />正在提交...</>
            ) : (
              <><CheckCircle className="w-5 h-5" />提交试卷</>
            )}
          </button>
          <p className="text-xs text-gray-500 text-center mt-2">
            提交后 AI 将在后台批改，您可在「测验记录」中查看进度
          </p>
        </div>
      </div>
    );
  }

  // 历史保留：批改中 / 结果页（当前主流程不会进入，提交后直接跳转到测验记录）
  if (phase === 'grading') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-12 h-12 text-green-600 animate-spin" />
        <p className="text-lg font-medium text-gray-700">提交中，请稍候...</p>
      </div>
    );
  }

  if (phase === 'result' && gradeData) {
    const { correctCount, total, wrongCount, results, suggestions } = gradeData;
    const percentage = Math.round((correctCount / total) * 100);
    const scoreColor = percentage >= 80 ? 'text-green-600' : percentage >= 60 ? 'text-yellow-600' : 'text-red-600';
    const scoreBg = percentage >= 80 ? 'bg-green-50 border-green-200' : percentage >= 60 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200';

    return (
      <div className="space-y-6">
        {/* 保存状态提示 */}
        {saving && (
          <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            <span className="text-sm text-blue-700">正在保存测验记录...</span>
          </div>
        )}

        {/* 成绩卡片 */}
        <div className={`bg-white rounded-lg shadow-sm border p-8 text-center ${scoreBg}`}>
          <Award className={`w-16 h-16 mx-auto mb-4 ${scoreColor}`} />
          <h2 className="text-3xl font-bold mb-2">
            <span className={scoreColor}>{correctCount}</span>
            <span className="text-gray-400"> / {total}</span>
          </h2>
          <p className="text-lg text-gray-600 mb-2">
            答对 <strong className={scoreColor}>{correctCount}</strong> 题，
            答错 <strong className="text-red-500">{wrongCount}</strong> 题
          </p>
          <div className="w-full bg-gray-200 rounded-full h-3 mt-4">
            <div
              className={`h-3 rounded-full transition-all ${
                percentage >= 80 ? 'bg-green-500' : percentage >= 60 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${percentage}%` }}
            />
          </div>
          <p className="text-sm text-gray-500 mt-2">得分率 {percentage}%</p>
          <p className="text-xs text-green-600 mt-1">✓ 本次测验已保存到测验记录</p>
        </div>

        {/* AI 学习建议 */}
        {suggestions && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h3 className="font-semibold text-blue-800 mb-2 flex items-center gap-2">
              📚 AI 学习建议
            </h3>
            <p className="text-sm text-blue-700 leading-relaxed">{suggestions}</p>
          </div>
        )}

        {/* 详细批改结果 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <h3 className="font-semibold text-gray-800">详细批改结果</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {results.map((r, idx) => {
              const isEssay = r.type === 'essay';
              const cannotJudge = r.isCorrect === null;
              return (
                <div key={r.id} className={`p-4 ${isEssay ? 'bg-purple-50/40' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      {r.isCorrect === true && <CheckCircle className="w-5 h-5 text-green-500" />}
                      {r.isCorrect === false && <XCircle className="w-5 h-5 text-red-500" />}
                      {cannotJudge && <AlertCircle className="w-5 h-5 text-yellow-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          r.type === 'choice' ? 'bg-blue-100 text-blue-700' :
                          r.type === 'fill' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-purple-100 text-purple-700'
                        }`}>
                          {TYPE_LABELS[r.type] || r.type}
                        </span>
                        {cannotJudge && <span className="text-xs text-yellow-600">AI 已阅卷，见点评</span>}
                      </div>
                      <p className="text-sm font-medium text-gray-800 mb-2">
                        {idx + 1}. {r.question}
                      </p>
                      <div className="space-y-1 text-xs">
                        <p>
                          <span className="text-gray-500">你的答案：</span>
                          <span className={
                            cannotJudge ? 'text-gray-700 font-medium' :
                            r.isCorrect ? 'text-green-700 font-medium' : 'text-red-700 font-medium'
                          }>
                            {r.studentAnswer || '（未作答）'}
                          </span>
                        </p>
                        {(isEssay || r.isCorrect !== true) && (
                          <p>
                            <span className="text-gray-500">{isEssay ? '参考答案：' : '正确答案：'}</span>
                            <span className="text-green-700 font-medium">{r.correctAnswer}</span>
                          </p>
                        )}
                      </div>
                      {r.explanation && (r.isCorrect !== true || isEssay) && (
                        <div className={`mt-2 p-2 rounded border text-xs ${
                          isEssay
                            ? 'bg-purple-50 border-purple-200 text-purple-900'
                            : 'bg-yellow-50 border-yellow-100 text-yellow-800'
                        }`}>
                          <strong>{isEssay ? 'AI 点评：' : '解析：'}</strong>{r.explanation}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            返回 AI 课堂
          </button>
        </div>
      </div>
    );
  }

  return null;
};
