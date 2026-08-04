import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { CoursewareNarrator, LessonSection, SectionCard } from './AIClassroom';
import { QuizExam } from './QuizExam';
import { Question } from './QuizGenerator';
import { ClassroomTaskDetail, fetchLegacyClassroomContent } from '../services/classroomTaskApi';
import AnswerReview from './AnswerReview';

interface ClassroomLegacyDetailProps {
  task: ClassroomTaskDetail;
  currentUser: { id: string; name: string };
  onBack: () => void;
  onOpenTask: (taskId: string) => void;
  initialEntityId?: string;
}

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

  useEffect(() => {
    setActiveLinkKey(initialLinkKey());
  }, [task.id, task.primaryLink?.entityId, task.primaryLink?.entityType, initialEntityId]);

  useEffect(() => {
    let cancelled = false;
    if (!link || !['classroom_courseware', 'classroom_quiz'].includes(link.entityType)) { setLoading(false); return; }
    setLoading(true); setError('');
    fetchLegacyClassroomContent(link.entityId, currentUser.id).then(value => {
      if (cancelled) return;
      setContent(value);
    })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '历史内容读取失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentUser.id, link?.entityId, link?.entityType]);

  if (!link) return null;
  if (loading) return <div role="status" className="flex items-center gap-2 py-12 text-cyber-muted"><Loader2 className="animate-spin" />正在读取学习内容</div>;
  if (error) return <section className="mx-auto max-w-4xl space-y-5"><button type="button" onClick={onBack} className="inline-flex min-h-10 items-center gap-2 text-sm text-neon-blue"><ArrowLeft size={18} />返回智慧课堂</button><div role="alert" className="flex gap-2 border border-red-300 bg-red-50 p-4 text-sm text-red-800"><AlertCircle size={18} />{error}</div></section>;
  if (link.entityType === 'quiz_result') return <AnswerReview sourceType="quiz_result" sourceId={link.entityId} currentUser={currentUser} onBack={onBack} />;
  if (!content) return null;
  const contentSwitch = links.length > 1 ? <div role="tablist" aria-label="本任务学习内容" className="mx-auto flex max-w-4xl gap-2"><span className="self-center text-sm text-cyber-muted">本任务</span>{links.map(item => { const key = `${item.entityType}:${item.entityId}`; const label = item.role === 'explanation' ? '错题讲解' : item.role === 'practice' ? '针对性测验' : item.entityType === 'classroom_quiz' ? '随堂测验' : item.entityType === 'quiz_result' ? '测验记录' : '课件'; return <button key={key} type="button" role="tab" aria-selected={key === activeLinkKey} onClick={() => setActiveLinkKey(key)} className={`min-h-10 border px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-neon-blue ${key === activeLinkKey ? 'border-neon-blue bg-neon-blue/10 text-neon-blue' : 'border-cyber-border text-cyber-muted hover:bg-white/5'}`}>{label}</button>; })}</div> : null;
  if (content.type === 'quiz') return <section className="space-y-4">{contentSwitch}<QuizExam quizId={content.id} questions={content.content as Question[]} bookTitle={content.bookTitle} chapter={content.chapter} subject={content.subject} studentName={content.userName || currentUser.name} ownerId={currentUser.id} onClose={onBack} onSubmitted={(resultId) => onOpenTask(`legacy:quiz_result:${resultId}`)} /></section>;
  const sections = content.content as LessonSection[];
  return <section className="mx-auto max-w-4xl space-y-5" aria-labelledby="legacy-courseware-title"><button type="button" onClick={onBack} className="inline-flex min-h-10 items-center gap-2 text-sm text-neon-blue focus:outline-none focus:ring-2 focus:ring-neon-blue"><ArrowLeft size={18} />返回智慧课堂</button>{contentSwitch}<header className="border border-cyber-border bg-white p-5"><p className="text-sm text-neon-blue">课件学习</p><h1 id="legacy-courseware-title" className="mt-1 text-xl font-semibold text-cyber-text">《{content.bookTitle}》· {content.chapter}</h1><p className="mt-2 text-sm text-cyber-muted">{content.subject} · {content.userName || currentUser.name}</p></header><CoursewareNarrator sections={sections} coursewareId={content.id} /><div className="space-y-4">{sections.map((section, index) => <SectionCard key={section.index || index} section={section} isLast={index === sections.length - 1} />)}</div></section>;
};

export default ClassroomLegacyDetail;
