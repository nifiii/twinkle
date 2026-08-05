import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Headphones, Pause, Play, RotateCcw } from 'lucide-react';
import { getLearningPackage, updatePlayback } from '../services/learningPackageApi';
import { UserProfile } from '../types';

type ListeningSpeed = 'slow' | 'standard' | 'fast';
type ListeningQuestion = { id: string; prompt: string; options?: string[]; answer: string; explanation: string; rubricPoints: string[] };
type ListeningData = { script: string; questions: ListeningQuestion[] };
type AudioProfile = { label: string; request: Record<string, unknown>; endpoint?: string };
type Playback = { completedPlays: number; submittedAt: number | null; canPlay: boolean; transcriptUnlocked: boolean; questionsUnlocked: boolean; answers?: Record<string, string> };
type PackageData = { id: string; kind: string; content: { listening?: ListeningData; audio?: AudioProfile; audioProfiles?: Partial<Record<ListeningSpeed, AudioProfile>>; gradeProfile?: { defaultSpeed?: ListeningSpeed } }; playback?: Playback };

const SPEEDS: ListeningSpeed[] = ['slow', 'standard', 'fast'];
const SPEED_LABELS: Record<ListeningSpeed, string> = { slow: '慢速 0.75x', standard: '标准 1.00x', fast: '加快 1.10x' };

export default function LearningPackage({ id, currentUser, onBack }: { id: string; currentUser: UserProfile; onBack: () => void }) {
  const [data, setData] = useState<PackageData>();
  const [loadError, setLoadError] = useState('');
  const [audioError, setAudioError] = useState('');
  const [loading, setLoading] = useState(true);
  const [audioLoading, setAudioLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [speed, setSpeed] = useState<ListeningSpeed>('standard');
  const audio = useRef<HTMLAudioElement | null>(null);

  const releaseAudio = () => {
    const current = audio.current;
    if (!current) return;
    current.pause();
    current.onended = null;
    current.onerror = null;
    if (current.src.startsWith('blob:')) URL.revokeObjectURL(current.src);
    audio.current = null;
  };

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const packageData = await getLearningPackage(id, currentUser.id) as PackageData;
      setData(packageData);
      if (packageData.kind === 'english-listening') {
        setSpeed(packageData.content.gradeProfile?.defaultSpeed || (packageData.content.audioProfiles ? 'slow' : 'standard'));
        setAnswers(packageData.playback?.answers || {});
      }
    } catch (error: any) {
      setLoadError(error.message || '读取学习包失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return releaseAudio;
  }, [id, currentUser.id]);

  const content = data?.content;
  const playback = data?.playback;
  const listening = content?.listening;

  const recordCompletedPlayback = async () => {
    try {
      const nextPlayback = await updatePlayback(id, currentUser.id, 'completed') as Playback;
      setData(current => current ? { ...current, playback: nextPlayback } : current);
    } catch (error: any) {
      setAudioError(error.message || '播放进度保存失败，请重新播放');
    }
  };

  const createAudio = async () => {
    const profile = content?.audioProfiles?.[speed] || content?.audio;
    if (!profile) throw new Error('当前听力音频不可用');
    const response = await fetch(profile.endpoint || '/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile.request),
    });
    const tts = await response.json();
    if (!response.ok || !tts.success) throw new Error(tts.error || '音频生成失败');
    const bytes = Uint8Array.from(atob(tts.audio), char => char.charCodeAt(0));
    const element = new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })));
    element.onended = () => {
      setPlaying(false);
      void recordCompletedPlayback();
    };
    element.onerror = () => {
      setPlaying(false);
      setAudioError('当前语速音频播放失败，请重试或切换语速');
    };
    audio.current = element;
  };

  const play = async () => {
    if (!playback?.canPlay || audioLoading) return;
    setAudioError('');
    setAudioLoading(true);
    try {
      if (!audio.current) await createAudio();
      await audio.current?.play();
      setPlaying(true);
    } catch (error: any) {
      setAudioError(error.message || '播放失败，请稍后重试');
      releaseAudio();
    } finally {
      setAudioLoading(false);
    }
  };

  const chooseSpeed = (nextSpeed: ListeningSpeed) => {
    if (nextSpeed === speed || audioLoading) return;
    releaseAudio();
    setPlaying(false);
    setAudioError('');
    setSpeed(nextSpeed);
  };

  const restart = async () => {
    if (!audio.current) return play();
    audio.current.currentTime = 0;
    await audio.current.play();
    setPlaying(true);
  };

  const submitAnswers = async () => {
    if (submitting) return;
    setSubmitting(true);
    setAudioError('');
    try {
      const nextPlayback = await updatePlayback(id, currentUser.id, 'submit', answers) as Playback;
      setAnswers(nextPlayback.answers || {});
      setData(current => current ? { ...current, playback: nextPlayback } : current);
    } catch (error: any) {
      setAudioError(error.message || '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-6 text-slate-600" role="status">正在准备学习内容...</div>;
  if (loadError) return <section className="p-6"><button onClick={onBack} className="min-h-11 text-sm underline">返回智慧课堂</button><p className="mt-4 text-red-700" role="alert">{loadError}</p><button onClick={() => void load()} className="mt-4 min-h-11 border px-4">重试</button></section>;
  if (!data || !content) return null;
  if (['english-video', 'math-video', 'chinese-video', 'science-video'].includes(data.kind)) return <section className="mx-auto max-w-4xl"><button onClick={onBack} className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm"><ArrowLeft size={18} />返回智慧课堂</button><div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">视频学习已取消，历史学习包仅保留记录，不再提供资源查找或播放。</div></section>;
  if (data.kind !== 'english-listening' || !listening || !playback) return <section className="mx-auto max-w-4xl"><button onClick={onBack} className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm"><ArrowLeft size={18} />返回智慧课堂</button><h1 className="text-2xl font-semibold">数学思维训练</h1><p className="mt-4 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">该学习内容请在智慧课堂任务详情中继续完成。</p></section>;

  const submitted = Boolean(playback.submittedAt);
  const savedAnswers = playback.answers || answers;
  return <section className="mx-auto max-w-4xl text-slate-800">
    <button onClick={onBack} className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm"><ArrowLeft size={18} />返回智慧课堂</button>
    <div className="border border-cyan-200 bg-white p-5 sm:p-6">
      <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center bg-cyan-50 text-cyan-800"><Headphones size={21} /></span><div><p className="text-sm text-cyan-800">AI 原创听力练习</p><h1 className="mt-1 text-2xl font-semibold">英语听力</h1><p className="mt-2 text-sm text-slate-600">可按自己的节奏反复听，完整听完后开始作答。</p></div></div>
      <div className="mt-5" role="group" aria-label="选择播放速度"><p className="mb-2 text-sm font-medium">播放速度</p><div className="grid grid-cols-3 gap-2">{SPEEDS.map(item => <button key={item} type="button" aria-pressed={speed === item} disabled={audioLoading} onClick={() => chooseSpeed(item)} className={`min-h-11 border px-2 text-sm ${speed === item ? 'border-cyan-700 bg-cyan-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-cyan-500'} disabled:opacity-50`}>{content.audioProfiles?.[item]?.label || SPEED_LABELS[item]}</button>)}</div></div>
      <div className="mt-5 flex items-center gap-3"><button type="button" aria-label={playing ? '暂停播放' : '播放听力'} disabled={!playback.canPlay || audioLoading} onClick={() => playing ? (audio.current?.pause(), setPlaying(false)) : void play()} className="grid h-11 w-11 place-items-center bg-cyan-700 text-white disabled:opacity-40">{playing ? <Pause size={20} /> : <Play size={20} />}</button><button type="button" aria-label="从头播放" disabled={!playback.canPlay || audioLoading} onClick={() => void restart()} className="grid h-11 w-11 place-items-center border border-slate-300 text-slate-700 disabled:opacity-40"><RotateCcw size={18} /></button><span className="text-sm text-slate-600" role="status" aria-live="polite">{audioLoading ? '正在加载音频...' : playing ? '正在播放' : '可重复播放'}</span></div>
      {audioError && <p className="mt-4 text-sm text-red-700" role="alert">{audioError}</p>}
    </div>

    {playback.transcriptUnlocked && <details className="mt-5 border border-slate-200 bg-white p-4"><summary className="cursor-pointer font-medium">查看听力文本</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">{listening.script}</p></details>}

    {playback.questionsUnlocked && <div className="mt-6 space-y-5 border-t border-slate-200 pt-6">
      <h2 className="text-xl font-semibold">理解题</h2>
      {listening.questions.map((question, index) => <article key={question.id} className="border border-slate-200 bg-white p-4 sm:p-5"><p className="font-medium">{index + 1}. {question.prompt}</p>{submitted ? <div className="mt-4 space-y-3 text-sm"><p><span className="font-medium text-slate-500">我的答案：</span>{savedAnswers[question.id] || '未作答'}</p><p><span className="font-medium text-slate-500">参考答案：</span>{question.answer}</p><p><span className="font-medium text-slate-500">解析：</span>{question.explanation}</p><p><span className="font-medium text-slate-500">评分点：</span>{question.rubricPoints.join('；')}</p></div> : question.options?.length ? <fieldset className="mt-4 space-y-2"><legend className="sr-only">第 {index + 1} 题作答</legend>{question.options.map(option => <label key={option} className="flex min-h-11 items-center gap-3 border border-slate-200 px-3 text-sm hover:border-cyan-500"><input type="radio" name={question.id} value={option} checked={answers[question.id] === option} onChange={() => setAnswers(current => ({ ...current, [question.id]: option }))} />{option}</label>)}</fieldset> : <label className="mt-4 block text-sm"><span className="sr-only">第 {index + 1} 题作答</span><input value={answers[question.id] || ''} onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))} className="min-h-11 w-full border border-slate-300 px-3" placeholder="输入你的答案" /></label>}</article>)}
      {!submitted && <button type="button" disabled={submitting} onClick={() => void submitAnswers()} className="min-h-11 bg-slate-800 px-5 text-sm font-medium text-white disabled:opacity-50">{submitting ? '正在提交...' : '提交作答'}</button>}
    </div>}
  </section>;
}
