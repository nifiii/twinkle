import React, { useState } from 'react';
import { FileText, Sparkles, GraduationCap, Loader2, CheckCircle, AlertCircle, MessageSquare, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { EBook, ChapterNode, ScannedItem } from '../types';

interface CoursewareGeneratorProps {
  selectedBook: EBook;
  selectedChapters: ChapterNode[];
  wrongProblems: ScannedItem[];
  studentName: string;
  ownerId?: string;
  onCoursewareReady?: (content: string) => void;
}

interface LessonSection {
  index: number;
  title: string;
  content: string;
  notes: string;
  chapter?: string; // 该 section 所属章节，便于章节覆盖核验
}

type TeachingStyle = 'rigorous' | 'storytelling' | 'practice' | 'exploration';

const TEACHING_STYLES = [
  { value: 'rigorous' as TeachingStyle, label: '严谨讲解', description: '系统完整，逻辑严密，适合理科学习', icon: '📐' },
  { value: 'storytelling' as TeachingStyle, label: '故事化', description: '生动形象，趣味性强，易于理解', icon: '📚' },
  { value: 'practice' as TeachingStyle, label: '实践导向', description: '大量例题，边学边练，巩固知识', icon: '✏️' },
  { value: 'exploration' as TeachingStyle, label: '探究式', description: '启发思考，培养探索精神', icon: '🔍' },
];

const SectionCard: React.FC<{ section: LessonSection; isLast: boolean }> = ({ section, isLast }) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const isSummary = isLast && (section.title.includes('小结') || section.title.includes('总结'));

  return (
    <div className={`rounded-lg border overflow-hidden ${isSummary ? 'border-indigo-200 bg-indigo-50' : 'border-gray-200 bg-white shadow-sm'}`}>
      <div className={`px-6 py-3 flex items-center gap-3 flex-wrap ${isSummary ? 'bg-indigo-100' : 'bg-gray-50 border-b border-gray-200'}`}>
        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${isSummary ? 'bg-indigo-600 text-white' : 'bg-blue-100 text-blue-700'}`}>
          {isSummary ? '📋 小结' : `第 ${section.index} 节`}
        </span>
        <h3 className={`font-semibold ${isSummary ? 'text-indigo-800' : 'text-gray-800'}`}>{section.title}</h3>
        {section.chapter && !isSummary && (
          <span className="text-xs px-2 py-0.5 bg-sky-100 text-sky-700 rounded-full">{section.chapter}</span>
        )}
      </div>

      <div className="px-6 py-5">
        <div className={`text-sm leading-relaxed whitespace-pre-wrap ${isSummary ? 'text-indigo-900 font-medium' : 'text-gray-700'}`}>
          {section.content}
        </div>
      </div>

      {section.notes && !isSummary && (
        <div className="px-6 pb-5">
          <button
            onClick={() => setDialogOpen(o => !o)}
            className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700 font-medium"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            故事讲解
            {dialogOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {dialogOpen && (
            <div className="mt-2 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="text-sm text-amber-900 whitespace-pre-line leading-relaxed">
                {section.notes}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const CoursewareGenerator: React.FC<CoursewareGeneratorProps> = ({
  selectedBook, selectedChapters, wrongProblems, studentName, ownerId, onCoursewareReady,
}) => {
  const [selectedStyle, setSelectedStyle] = useState<TeachingStyle>('rigorous');
  const [generating, setGenerating] = useState(false);
  const [savedSections, setSavedSections] = useState<LessonSection[]>([]); // 已保存的 sections
  const [savedId, setSavedId] = useState<string>('');
  const [extensionStatus, setExtensionStatus] = useState<'idle' | 'generating' | 'completed' | 'failed'>('idle');
  const [extensionError, setExtensionError] = useState('');
  const [error, setError] = useState<string>('');

  const notifyCoursewareReady = (sections: LessonSection[]) => {
    onCoursewareReady?.(sections.map(section => `## ${section.title}\n${section.content}`).join('\n\n'));
  };

  const pollExtension = async (taskId: string) => {
    try {
      setExtensionStatus('generating');
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const response = await fetch(`/api/generate-courseware/task/${taskId}?ownerId=${encodeURIComponent(ownerId || 'shared')}`);
        if (!response.ok) continue;
        const task = (await response.json()).data;
        if (task.status === 'failed') {
          setExtensionStatus('failed');
          setExtensionError(task.error || '扩展讲解暂未完成，核心课件仍可正常使用');
          return;
        }
        if (task.status === 'completed' && task.result?.slides) {
          setSavedSections(task.result.slides);
          notifyCoursewareReady(task.result.slides);
          setExtensionStatus('completed');
          return;
        }
      }
    } catch {
      setExtensionStatus('failed');
      setExtensionError('扩展讲解状态读取失败，核心课件仍可正常使用');
    }
  };

  // 核心课件完成即由服务端保存，扩展讲解不阻塞可用结果。
  const handleGenerate = async () => {
    try {
      setGenerating(true);
      setError('');
      setExtensionStatus('idle');
      setExtensionError('');

      const response = await fetch('/api/generate-courseware', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookTitle: selectedBook.title,
          // 多章节：传入数组；后端如未支持则降级
          chapters: selectedChapters.map(c => c.title),
          chapter: selectedChapters.map(c => c.title).join('；'),
          studentName,
          subject: selectedBook.subject,
          teachingStyle: selectedStyle,
          wrongProblems,
          ownerId: ownerId || 'shared',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `生成失败 (${response.status})`);
      }

      const submission = await response.json();
      if (!submission.success || !submission.data?.taskId) throw new Error(submission.error || '课件任务提交失败');
      const startedAt = Date.now();
      const taskId = submission.data.taskId;
      while (Date.now() - startedAt < 10 * 60 * 1000) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const taskResponse = await fetch(`/api/generate-courseware/task/${taskId}?ownerId=${encodeURIComponent(ownerId || 'shared')}`);
        if (!taskResponse.ok) continue;
        const task = (await taskResponse.json()).data;
        if (task.status === 'failed') throw new Error(task.error || '课件生成失败');
        if (task.status === 'completed' && task.result?.slides && task.result?.coursewareId) {
          setSavedSections(task.result.slides);
          setSavedId(task.result.coursewareId);
          notifyCoursewareReady(task.result.slides);
          if (task.result.extensionJobId) void pollExtension(task.result.extensionJobId);
          else if (task.result.extensionStatus === 'failed') {
            setExtensionStatus('failed');
            setExtensionError('扩展讲解暂未排入队列，核心课件仍可正常使用');
          }
          return;
        }
      }
      throw new Error('课件生成超时，请稍后重试');
    } catch (err) {
      console.error('生成课件失败:', err);
      setError(err instanceof Error ? err.message : '生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6 relative">
      {/* 顶部信息栏 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <FileText className="w-6 h-6 text-blue-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-gray-800 mb-1">{selectedChapters.map(c => c.title).join('、')}</h3>
            <p className="text-sm text-gray-600">
              《{selectedBook.title}》- {selectedBook.subject} - {selectedBook.grade} · 共 {selectedChapters.length} 章
            </p>
          </div>
        </div>
      </div>

      {/* 教学风格选择（无已保存课件时显示） */}
      {savedSections.length === 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h4 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-yellow-500" />
            选择讲解风格
          </h4>
          <div className="grid grid-cols-2 gap-4">
            {TEACHING_STYLES.map((style) => (
              <button
                key={style.value}
                onClick={() => setSelectedStyle(style.value)}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  selectedStyle === style.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{style.icon}</span>
                  <div>
                    <h5 className="font-semibold text-gray-800 mb-1">{style.label}</h5>
                    <p className="text-xs text-gray-600">{style.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full mt-6 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:bg-gray-400"
          >
            {generating ? <><Loader2 className="w-4 h-4 animate-spin" />生成中...</> : <><Sparkles className="w-4 h-4" />生成核心课件</>}
          </button>

          {error && (
            <div className="mt-4 flex items-center gap-3 p-4 bg-red-50 rounded-lg border border-red-200">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <span className="text-sm text-red-800">{error}</span>
            </div>
          )}

          <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-sm text-blue-800">
              <strong>智能提示：</strong>
              {wrongProblems.length > 0
                ? `已检测到 ${wrongProblems.length} 道相关错题，将针对性强化讲解。`
                : '将按已选 ' + selectedChapters.length + ' 个章节的知识点全面覆盖生成讲义。'}
            </p>
          </div>
        </div>
      )}

      {/* 已保存课件展示 */}
      {savedSections.length > 0 && (
        <>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <span className="font-semibold text-gray-800">课件已保存</span>
              {savedId && (
                <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full flex items-center gap-1">
                  <GraduationCap className="w-3 h-3" />已同步到 AI 课堂
                </span>
              )}
              {extensionStatus === 'generating' && <span className="text-xs text-blue-700">扩展讲解生成中</span>}
              {extensionStatus === 'completed' && <span className="text-xs text-green-700">扩展讲解已补全</span>}
              {extensionStatus === 'failed' && <span className="text-xs text-amber-700">扩展讲解未完成</span>}
            </div>
            <button
              onClick={() => { setSavedSections([]); setSavedId(''); }}
              className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-xs font-medium flex items-center gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />重新生成
            </button>
          </div>

          {extensionStatus === 'failed' && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{extensionError}
            </div>
          )}

          <div className="space-y-4">
            {savedSections.map((s, i) => (
              <SectionCard key={s.index} section={s} isLast={i === savedSections.length - 1} />
            ))}
          </div>
        </>
      )}

      {/* 生成中遮罩（阻断页面交互） */}
      {generating && (
        <div className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white rounded-2xl px-8 py-6 shadow-2xl flex items-center gap-4">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            <div>
              <div className="font-semibold text-gray-800">AI 正在生成核心课件</div>
              <div className="text-sm text-gray-500 mt-0.5">核心课件保存后即可使用，扩展讲解会继续补全</div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
