import React, { useState } from 'react';
import { CheckCircle, AlertCircle, Loader2, BookOpen, X } from 'lucide-react';
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

const TYPE_LABELS: Record<string, string> = {
  choice: '选择题', single_choice: '选择题', multiple_choice: '选择题', fill: '填空题', essay: '解答题',
};

const isChoiceQuestion = (type: string) => ['choice', 'single_choice', 'multiple_choice'].includes(type);

export const QuizExam: React.FC<QuizExamProps> = ({
  quizId, questions, bookTitle, chapter, subject, studentName, ownerId, onClose, onSubmitted,
}) => {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState('');

  const setAnswer = (id: string, val: string) => {
    setAnswers(prev => ({ ...prev, [id]: val }));
  };

  // 提交后直接打开不可变作答回顾；该路径不触发评分或模型调用。
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
                  isChoiceQuestion(q.type) ? 'bg-blue-100 text-blue-700' :
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
              {isChoiceQuestion(q.type) && q.options && (
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
            提交后可立即查看题目、自己的答案、参考答案和解析
          </p>
        </div>
      </div>
    );
};
