import React, { useState, useMemo } from 'react';
import { GraduationCap, BookOpen, FileText, ClipboardCheck, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import { UserProfile, EBook, ChapterNode, ScannedItem } from '../types';
import { ChapterSelector } from './ChapterSelector';
import { CoursewareGenerator } from './CoursewareGenerator';
import { QuizGenerator } from './QuizGenerator';
import { WrongProblemQuizGenerator } from './WrongProblemQuizGenerator';
import { Button } from './ui';

type StudyMode = 'textbook' | 'wrong';

interface StudyRoomProps {
  currentUser: UserProfile;
  books: EBook[];
  wrongProblems: ScannedItem[];
  /** 嵌入到 ResourcesShell 时，隐藏顶部"智慧工坊"渐变标题区 */
  hideHeader?: boolean;
}

type StudyStep = 'select' | 'courseware' | 'quiz';

const StudyRoom: React.FC<StudyRoomProps> = ({ currentUser, books, wrongProblems, hideHeader = false }) => {
  const [mode, setMode] = useState<StudyMode>('textbook');
  const [currentStep, setCurrentStep] = useState<StudyStep>('select');
  const [selectedBook, setSelectedBook] = useState<EBook | null>(null);
  const [selectedChapters, setSelectedChapters] = useState<ChapterNode[]>([]);
  const [coursewareContent, setCoursewareContent] = useState<string>('');

  // 过滤出当前章节相关的错题（按学科匹配）
  const relevantWrongProblems = useMemo(() => {
    if (!selectedBook || selectedChapters.length === 0) return [];
    return wrongProblems.filter((item) => item.meta.subject === selectedBook.subject);
  }, [selectedBook, selectedChapters, wrongProblems]);

  // 章节确认（单选；ChapterSelector 仍以数组形式回调，长度 1）
  const handleChaptersConfirm = (book: EBook, chapters: ChapterNode[]) => {
    setSelectedBook(book);
    setSelectedChapters(chapters);
    setCurrentStep('courseware');
  };

  // 重置回选择
  const handleReset = () => {
    setCurrentStep('select');
    setSelectedBook(null);
    setSelectedChapters([]);
    setCoursewareContent('');
  };

  // 步骤完成情况
  const hasSelected = selectedBook && selectedChapters.length > 0;
  const hasCourseware = coursewareContent.length > 0;

  // 步骤切换按钮（顶部）—— 用户可自主切换
  const renderStepButtons = () => {
    const steps = [
      { key: 'select' as StudyStep, label: '选择章节', icon: BookOpen, enabled: true },
      { key: 'courseware' as StudyStep, label: '生成课件', icon: FileText, enabled: hasSelected },
      { key: 'quiz' as StudyStep, label: '配套测验', icon: ClipboardCheck, enabled: hasSelected },
    ];

    return (
      <div className="flex items-center justify-center gap-3 mb-6 flex-wrap">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isActive = currentStep === step.key;
          const isCompleted =
            (step.key === 'select' && hasSelected) ||
            (step.key === 'courseware' && hasCourseware);

          return (
            <React.Fragment key={step.key}>
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
                disabled={!step.enabled}
                onClick={() => step.enabled && setCurrentStep(step.key)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all border ${
                  isActive
                    ? 'bg-gradient-to-r from-neon-blue/25 to-neon-purple/15 text-neon-blue border-neon-blue/50 shadow-glow-sm scale-105'
                    : isCompleted
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/15'
                    : step.enabled
                    ? 'bg-cyber-surface/60 text-cyber-text border-cyber-border/60 hover:border-neon-blue/50 hover:text-neon-blue'
                    : 'bg-cyber-surface/30 text-cyber-muted/50 border-cyber-border/30 cursor-not-allowed'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{step.label}</span>
                {isCompleted && !isActive && <span className="text-xs">✓</span>}
              </motion.button>
              {index < steps.length - 1 && (
                <div className="w-6 h-0.5 bg-cyber-border/60" />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {!hideHeader && (
        <div className="bg-gradient-to-br from-sky-500 via-sky-400 to-mint-400 text-white rounded-3xl p-8 shadow-card relative overflow-hidden">
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <div className="absolute top-4 right-12 w-28 h-28 rounded-full bg-white blur-2xl" />
            <div className="absolute bottom-2 right-40 w-16 h-16 rounded-full bg-neon-purple blur-xl animate-float" />
          </div>
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
            backgroundSize: '40px 40px'
          }} />

          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative z-10">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <GraduationCap className="w-10 h-10" />
                <h2 className="text-3xl font-bold">智慧工坊</h2>
              </div>
              <p className="text-sky-50 text-sm">
                为 {currentUser.name} 定制的个性化学习内容
              </p>
            </div>
            <div className="text-right">
              <div className="text-sm text-sky-100 mb-1">当前年级</div>
              <div className="text-2xl font-bold">{currentUser.grade}</div>
            </div>
          </div>
        </div>
      )}

      {/* 模式切换：教材方案 / 错题测验 */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => setMode('textbook')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all border ${
            mode === 'textbook'
              ? 'bg-gradient-to-r from-neon-blue/25 to-sky-500/15 text-neon-blue border-neon-blue/50 shadow-glow-sm'
              : 'bg-cyber-surface/60 text-cyber-text border-cyber-border/60 hover:border-neon-blue/50 hover:text-neon-blue'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>教材 → 课件 + 测验</span>
        </button>
        <button
          onClick={() => setMode('wrong')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all border ${
            mode === 'wrong'
              ? 'bg-gradient-to-r from-neon-amber/25 to-amber-500/15 text-neon-amber border-neon-amber/50 shadow-glow-amber'
              : 'bg-cyber-surface/60 text-cyber-text border-cyber-border/60 hover:border-neon-amber/50 hover:text-neon-amber'
          }`}
        >
          <AlertTriangle className="w-4 h-4" />
          <span>错题 → 讲解 + 测验</span>
        </button>
      </div>

      {/* 三步骤切换按钮（仅教材模式） */}
      {mode === 'textbook' && renderStepButtons()}

      {/* 错题模式 */}
      {mode === 'wrong' && (
        <WrongProblemQuizGenerator currentUser={currentUser} />
      )}

      {/* 当前已选章节摘要（在 courseware/quiz 步骤显示） */}
      {mode === 'textbook' && currentStep !== 'select' && hasSelected && (
        <div className="bg-neon-blue/10 border border-neon-blue/40 rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="text-sm text-cyber-text">
            <span className="font-semibold text-neon-blue">{selectedBook!.title}</span>
            <span className="mx-2 text-cyber-muted">·</span>
            <span className="text-cyber-muted">当前章节：</span>
            <span className="text-neon-blue font-medium">{selectedChapters.map(c => c.title).join('、')}</span>
          </div>
          <button
            onClick={handleReset}
            className="text-xs text-neon-blue hover:text-sky-300 underline"
          >
            重新选择
          </button>
        </div>
      )}

      {/* Step：选择 */}
      {mode === 'textbook' && currentStep === 'select' && (
        <div>
          <div className="mb-4 flex items-baseline gap-2 flex-wrap">
            <h3 className="text-lg font-semibold text-cyber-text">章节选择</h3>
            <span className="text-xs text-cyber-muted">
              （从图书馆中选择一本教材并指定 1 个章节，AI 将围绕该章节生成课件与配套测验）
            </span>
          </div>
          <ChapterSelector books={books} onConfirm={handleChaptersConfirm} maxChapters={1} />
        </div>
      )}

      {/* Step：课件 */}
      {mode === 'textbook' && currentStep === 'courseware' && selectedBook && selectedChapters.length > 0 && (
        <CoursewareGenerator
          selectedBook={selectedBook}
          selectedChapters={selectedChapters}
          wrongProblems={relevantWrongProblems}
          studentName={currentUser.name}
          ownerId={currentUser.id}
          onCoursewareReady={(content) => {
            setCoursewareContent(content);
            setCurrentStep('quiz');
          }}
        />
      )}

      {/* Step：测验 */}
      {mode === 'textbook' && currentStep === 'quiz' && selectedBook && selectedChapters.length > 0 && (
        <QuizGenerator
          selectedBook={selectedBook}
          selectedChapters={selectedChapters}
          wrongProblems={relevantWrongProblems}
          coursewareContent={coursewareContent}
          studentName={currentUser.name}
          ownerId={currentUser.id}
        />
      )}

      {/* 空态 */}
      {mode === 'textbook' && currentStep === 'select' && books.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center min-h-[40vh]"
        >
          <div className="relative w-60 h-60 mb-6">
            <div className="absolute inset-0 bg-gradient-to-br from-neon-blue/20 to-neon-purple/20 rounded-3xl blur-2xl" />
            <div className="absolute inset-8 flex items-center justify-center">
              <BookOpen size={80} className="text-neon-blue/60 drop-shadow-[0_0_20px_rgba(31,111,178,0.30)]" />
            </div>
          </div>
          <h2 className="text-xl font-semibold mb-2 text-cyber-text">图书馆还没有教材</h2>
          <p className="text-cyber-muted mb-4">请先前往「我的书架」上传您的电子教材</p>
        </motion.div>
      )}
    </div>
  );
};

export default StudyRoom;
