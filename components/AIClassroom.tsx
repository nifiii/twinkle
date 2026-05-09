import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  GraduationCap, BookOpen, ClipboardCheck, ChevronRight,
  Loader2, AlertCircle, RefreshCw, Play, Pause, Square, Trash2, MessageSquare,
  ChevronDown, ChevronUp, History, CheckCircle, XCircle, Volume2,
  AlertTriangle, FileText, X
} from 'lucide-react';
import { Question } from './QuizGenerator';
import { QuizExam } from './QuizExam';

interface UserProfile { id: string; name: string; }

interface AIClassroomProps {
  currentUser: UserProfile;
  /**
   * Hash 子路径，如 "courseware/abc-123"、"wrong"、"history/xyz"。
   * 解析协议：第一段决定 Tab（courseware|quiz|wrong|history），第二段为目标条目 id（可选）。
   */
  subPath?: string;
}

interface ClassroomListItem {
  id: string;
  type: 'courseware' | 'quiz';
  bookTitle: string;
  chapter: string;
  subject: string;
  ownerId: string;
  userName: string;
  slideCount?: number;
  questionCount?: number;
  source?: 'manual' | 'wrong_problem';
  sourceProblemId?: string;
  createdAt: number;
}

interface LessonSection {
  index: number;
  title: string;
  content: string;
  notes: string;
}

interface QuizResultItem {
  id: string;
  quizId: string;
  bookTitle: string;
  chapter: string;
  subject: string;
  userName: string;
  correctCount: number;
  total: number;
  percentage: number;
  suggestions: string;
  status?: 'grading' | 'completed' | 'failed';
  gradedAt?: number | null;
  createdAt: number;
}

interface QuizResultDetail extends QuizResultItem {
  results: {
    id: string; type: string; question: string;
    studentAnswer: string; correctAnswer: string;
    isCorrect: boolean | null; explanation: string;
  }[];
}

type ActiveTab = 'courseware' | 'wrong' | 'history';
type ActiveView =
  | { kind: 'list' }
  | { kind: 'article'; item: ClassroomListItem; sections: LessonSection[] }
  | { kind: 'exam'; item: ClassroomListItem; questions: Question[] }
  | { kind: 'result_detail'; result: QuizResultDetail };

const formatDate = (ts: number): string => {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
};

const SUBJECTS = ['语文', '数学', '英语', '科学', '物理', '化学', '历史', '地理', '政治', '生物', '其他', '全部'];

const TYPE_LABELS: Record<string, string> = { choice: '选择题', fill: '填空题', essay: '解答题' };

// ——— 文章 section 卡片 ———
const SectionCard: React.FC<{ section: LessonSection; isLast: boolean }> = ({ section, isLast }) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const isSummary = isLast && (section.title.includes('小结') || section.title.includes('总结'));

  return (
    <div className={`rounded-lg border overflow-hidden ${isSummary ? 'border-indigo-200 bg-indigo-50' : 'border-gray-200 bg-white'}`}>
      <div className={`px-6 py-3 flex items-center gap-3 ${isSummary ? 'bg-indigo-100' : 'bg-gray-50 border-b border-gray-200'}`}>
        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${isSummary ? 'bg-indigo-600 text-white' : 'bg-blue-100 text-blue-700'}`}>
          {isSummary ? '📋 小结' : `第 ${section.index} 节`}
        </span>
        <h3 className={`font-semibold ${isSummary ? 'text-indigo-800' : 'text-gray-800'}`}>{section.title}</h3>
      </div>
      <div className="px-6 py-5">
        <div className={`text-sm leading-relaxed whitespace-pre-wrap ${isSummary ? 'text-indigo-900' : 'text-gray-700'}`}>
          {section.content}
        </div>
      </div>
      {section.notes && !isSummary && (
        <div className="px-6 pb-4">
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
              <div className="text-sm text-amber-900 whitespace-pre-line leading-relaxed">{section.notes}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// 把课件文本切成 ≤280 字的片段，按中文标点优先断句，避免 TTS 音质下降
const splitIntoChunks = (text: string, maxLen = 280): string[] => {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return [cleaned];
  const chunks: string[] = [];
  let buf = '';
  // 按句号/问号/感叹号/分号断句
  const sentences = cleaned.split(/(?<=[。！？；!?;])/);
  for (const s of sentences) {
    if ((buf + s).length > maxLen) {
      if (buf) { chunks.push(buf); buf = ''; }
      // 单句仍超长则按逗号再切，最后兜底硬切
      if (s.length > maxLen) {
        const subs = s.split(/(?<=[，,])/);
        let sub = '';
        for (const t of subs) {
          if ((sub + t).length > maxLen) {
            if (sub) chunks.push(sub);
            sub = t.length > maxLen ? '' : t;
            while (t.length > maxLen) {
              chunks.push(t.substring(0, maxLen));
              break; // 仅切一次防止死循环
            }
          } else {
            sub += t;
          }
        }
        if (sub) buf = sub;
      } else {
        buf = s;
      }
    } else {
      buf += s;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.filter(c => c.trim().length > 0);
};

// 课件全文连播控制条
const CoursewareNarrator: React.FC<{ sections: LessonSection[]; coursewareId: string }> = ({ sections, coursewareId }) => {
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [chunkIdx, setChunkIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [prefetchingCount, setPrefetchingCount] = useState(0);
  // complete.mp3 是否已在服务端存在（挂载时检查 + 合并成功后更新）
  const [hasComplete, setHasComplete] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopRef = useRef(false);
  const markedRef = useRef(false);
  // 内存 Promise 去重：同 idx 只发一次 API 请求
  const prefetchCache = useRef<Map<number, Promise<string | null>>>(new Map());

  // 拼接全文
  const fullText = sections.map(s => {
    const head = `第 ${s.index} 节，${s.title}。`;
    const body = (s.content || '').trim();
    return head + body;
  }).join('\n');
  const chunks = splitIntoChunks(fullText);

  // 完整音频文件的 URL（由静态文件中间件直接服务，无需 base64）
  const completeAudioUrl = `/data/tts_cache/${coursewareId}/complete.mp3`;

  // 挂载时检查 complete.mp3 是否已存在
  // Why cache:no-store: 文件有可能被手动删除或重根，不能依赖浏览器缓存的 200 响应
  useEffect(() => {
    if (!coursewareId) return;
    fetch(completeAudioUrl + '?_=' + Date.now(), { method: 'HEAD', cache: 'no-store' })
      .then(r => {
        // 防止 Nginx/Express SPA fallback 把 missing file 的请求返回 200 html
        const isAudio = r.headers.get('content-type')?.includes('audio');
        setHasComplete(r.ok && !!isAudio);
      })
      .catch(() => setHasComplete(false));
  }, [coursewareId, completeAudioUrl]);

  // SessionStorage 缓存（会话内免网络）
  const cacheKey = (idx: number) => `tts:${coursewareId}:${idx}`;
  const readCache = (idx: number): string | null => {
    try { return sessionStorage.getItem(cacheKey(idx)); } catch { return null; }
  };
  const writeCache = (idx: number, b64: string) => {
    try { sessionStorage.setItem(cacheKey(idx), b64); } catch { /* QuotaExceeded: ignore */ }
  };

  // 单段 TTS 请求（三层缓存：内存 Promise → SessionStorage → 服务端磁盘 → 豆包 API）
  const fetchAudio = (idx: number): Promise<string | null> => {
    const existing = prefetchCache.current.get(idx);
    if (existing) return existing;

    const p = (async (): Promise<string | null> => {
      const cached = readCache(idx);
      if (cached) return cached;
      try {
        const resp = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: chunks[idx], coursewareId, chunkIdx: idx }),
        });
        const data = await resp.json();
        if (data.success && data.audio) {
          writeCache(idx, data.audio);
          return data.audio;
        }
        if (data.fallback) return null;
        return null;
      } catch { return null; }
    })();

    prefetchCache.current.set(idx, p);
    return p;
  };

  // 预取接下来 LOOKAHEAD 段（非阻塞，保证段间无等待）
  const LOOKAHEAD = 2;
  const prefetch = (fromIdx: number) => {
    for (let i = fromIdx + 1; i <= Math.min(fromIdx + LOOKAHEAD, chunks.length - 1); i++) {
      if (!prefetchCache.current.has(i)) {
        setPrefetchingCount(c => c + 1);
        fetchAudio(i).finally(() => setPrefetchingCount(c => Math.max(0, c - 1)));
      }
    }
  };

  // 后台任务：串行拉取所有分片 → 全部到齐后通知后端合并为 complete.mp3
  // 与播放循环并行运行，不阻塞播放
  const prefetchAllAndMerge = async () => {
    for (let i = 0; i < chunks.length; i++) {
      await fetchAudio(i);                               // 命中缓存时立即返回
      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 400));      // 避免并发过多触发 API 限流
      }
    }
    // 所有分片已在磁盘，触发服务端合并
    try {
      const r = await fetch('/api/tts/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coursewareId, totalChunks: chunks.length }),
      });
      if (r.ok) {
        setHasComplete(true);
        console.log(`[TTS] ${coursewareId} 完整音频合并完成，下次播放将使用单文件`);
      }
    } catch { /* 合并失败不影响当前播放，下次重试 */ }
  };

  // MSE 流式播放：将所有分片顺序 appendBuffer 进同一 SourceBuffer
  // Why: 数据一旦进入 SourceBuffer，音频引擎独立播放，不依赖 JS 主线程
  //       锁屏导致 JS 暂停时，已缓冲的内容仍可连续播出
  // Fallback: 若浏览器不支持 audio/mpeg MSE（iOS Safari），退回 chunk-by-chunk
  const playWithMSE = async () => {
    const mediaSource = new MediaSource();
    const audio = audioRef.current || new Audio();
    audioRef.current = audio;
    const objectUrl = URL.createObjectURL(mediaSource);
    audio.src = objectUrl;

    await new Promise<void>(resolve =>
      mediaSource.addEventListener('sourceopen', () => resolve(), { once: true })
    );

    let sb: SourceBuffer;
    try {
      sb = mediaSource.addSourceBuffer('audio/mpeg');
    } catch {
      // audio/mpeg SourceBuffer 不支持（iOS Safari）→ 释放 MSE，由调用方 fallback
      URL.revokeObjectURL(objectUrl);
      audio.src = '';
      throw new Error('MSE_UNSUPPORTED');
    }

    // 等待 SourceBuffer 完成上一次 append
    const waitUpdate = () => new Promise<void>(resolve => {
      if (!sb.updating) { resolve(); return; }
      sb.addEventListener('updateend', () => resolve(), { once: true });
    });

    let started = false;
    for (let i = 0; i < chunks.length; i++) {
      if (stopRef.current) break;
      setChunkIdx(i);
      prefetch(i); // LOOKAHEAD 继续预取

      const needsFetch = !prefetchCache.current.has(i);
      if (needsFetch) setLoading(true);
      const b64 = await fetchAudio(i);
      setLoading(false);
      if (!b64 || stopRef.current) break;

      try {
        // base64 → Uint8Array → SourceBuffer
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
        await waitUpdate();
        if (stopRef.current) break;
        sb.appendBuffer(bytes.buffer);
        await waitUpdate();
      } catch {
        // SourceBuffer 出错（通常是 stop() 清空了 src）
        break;
      }

      // 第一片 append 完毕后立即开始播放（低延迟启动）
      if (!started) {
        started = true;
        audio.play().catch(() => {});
      }
    }

    // 通知音频引擎数据已结束
    if (!stopRef.current && mediaSource.readyState === 'open') {
      try {
        await waitUpdate();
        mediaSource.endOfStream();
      } catch { /* already closed */ }
    }

    // 等待播放结束（或被 stop() 中断）
    if (started && !stopRef.current) {
      await new Promise<void>(resolve => {
        audio.addEventListener('ended', () => resolve(), { once: true });
        audio.addEventListener('error', () => resolve(), { once: true });
      });
    }

    URL.revokeObjectURL(objectUrl);
  };

  const stop = useCallback(() => {
    stopRef.current = true;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setPlaying(false);
    setPaused(false);
    setChunkIdx(0);
    setLoading(false);
  }, []);

  // 播放单段（LOOKAHEAD + 缓存命中）
  const playChunk = async (idx: number): Promise<boolean> => {
    if (idx >= chunks.length || stopRef.current) return false;
    setChunkIdx(idx);
    prefetch(idx);

    const needsFetch = !prefetchCache.current.has(idx);
    if (needsFetch) setLoading(true);
    const b64 = await fetchAudio(idx);
    setLoading(false);
    if (stopRef.current) return false;

    if (b64) {
      const audio = audioRef.current || new Audio();
      audioRef.current = audio;
      audio.src = `data:audio/mp3;base64,${b64}`;
      try { await audio.play(); } catch { return false; }
      return new Promise(resolve => {
        audio.onended = () => resolve(true);
        audio.onerror = () => resolve(false);
      });
    }

    // fallback: 浏览器 Web Speech API
    if ('speechSynthesis' in window) {
      return new Promise(resolve => {
        const utter = new SpeechSynthesisUtterance(chunks[idx]);
        utter.lang = 'zh-CN';
        utter.rate = 1.0;
        utter.onend = () => resolve(true);
        utter.onerror = () => resolve(false);
        window.speechSynthesis.speak(utter);
      });
    }

    setErrMsg('TTS 服务暂不可用');
    return false;
  };

  const markStudied = async () => {
    if (markedRef.current) return;
    try {
      const r = await fetch(`/api/classroom/${coursewareId}/mark-studied`, { method: 'POST' });
      if (r.ok) markedRef.current = true;
    } catch { /* 网络异常，不影响播放 */ }
  };

  const startPlayAll = async () => {
    if (chunks.length === 0) return;
    setErrMsg('');
    setPlaying(true);
    setPaused(false);
    stopRef.current = false;

    // ── 单文件模式（complete.mp3 已存在）──────────────────────
    // 直接用 HTTP URL 播放，浏览器原生缓冲，无任何分段切换
    if (hasComplete) {
      const audio = audioRef.current || new Audio();
      audioRef.current = audio;
      // 加时间戳避免浏览器缓存到已删除的文件
      audio.src = completeAudioUrl + '?_=' + Date.now();
      setChunkIdx(0);
      let started = false;
      try { await audio.play(); started = true; } catch { /* autoplay policy */ }
      if (!started) { setPlaying(false); return; }
      const playOk = await new Promise<boolean>(resolve => {
        audio.onended = () => resolve(true);
        // onerror: 文件被删除或损坏 → 降级到分段模式
        audio.onerror = () => resolve(false);
      });
      if (!playOk && !stopRef.current) {
        console.warn('[TTS] complete.mp3 不可用，重置为分段模式');
        setHasComplete(false);
        setPlaying(false);
        setErrMsg('完整音频已失效，请重新点击播放');
        return;
      }
      if (!stopRef.current) await markStudied();
      setPlaying(false);
      setChunkIdx(0);
      return;
    }

    // ── 分段模式（首次播放）──────────────────────────────────
    // 后台全量预取 + 合并（与播放并行，不阻塞）
    prefetchAllAndMerge();

    // 优先尝试 MSE 流式播放（数据进入 SourceBuffer 后锁屏不中断）
    const mseSupported = typeof window.MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported('audio/mpeg');

    if (mseSupported) {
      try {
        await playWithMSE();
        if (!stopRef.current) await markStudied();
      } catch (e: any) {
        if (e?.message !== 'MSE_UNSUPPORTED') {
          console.warn('[TTS] MSE 播放异常，回退分段模式', e);
        }
        // MSE 不支持 → fallback chunk-by-chunk
        if (!stopRef.current) {
          prefetch(-1);
          for (let i = 0; i < chunks.length; i++) {
            if (stopRef.current) break;
            const ok = await playChunk(i);
            if (ok) await markStudied();
            if (!ok || stopRef.current) break;
          }
        }
      }
    } else {
      // MSE 不可用（iOS Safari）→ 直接 chunk-by-chunk
      prefetch(-1);
      for (let i = 0; i < chunks.length; i++) {
        if (stopRef.current) break;
        const ok = await playChunk(i);
        if (ok) await markStudied();
        if (!ok || stopRef.current) break;
      }
    }

    setPlaying(false);
    setChunkIdx(0);
  };

  const togglePause = () => {
    if (!audioRef.current) return;
    if (paused) {
      audioRef.current.play();
      setPaused(false);
    } else {
      audioRef.current.pause();
      setPaused(true);
    }
  };

  // 离开页面时停止
  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  // 未播放时的缓存状态指示
  const sessionCachedCount = chunks.filter((_, i) => !!readCache(i)).length;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center gap-3 flex-wrap">
      <Volume2 className="w-5 h-5 text-amber-600 flex-shrink-0" />
      <span className="text-sm text-amber-900 font-medium">
        课文朗读（豆包 TTS）
      </span>
      {!playing ? (
        <button
          onClick={startPlayAll}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-xs font-medium"
        >
          <Play className="w-3.5 h-3.5" />
          {hasComplete ? '全文连播' : `全文连播（${chunks.length} 段）`}
        </button>
      ) : (
        <>
          <button
            onClick={togglePause}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-amber-400 text-amber-700 rounded-lg hover:bg-amber-100 text-xs font-medium"
          >
            {paused ? <><Play className="w-3.5 h-3.5" />继续</> : <><Pause className="w-3.5 h-3.5" />暂停</>}
          </button>
          <button
            onClick={stop}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-red-300 text-red-600 rounded-lg hover:bg-red-50 text-xs font-medium"
          >
            <Square className="w-3.5 h-3.5" />停止
          </button>
          <span className="text-xs text-amber-700">
            {hasComplete
              ? '完整音频播放中'
              : loading ? '合成音频...' : `第 ${chunkIdx + 1}/${chunks.length} 段`
            }
            {!hasComplete && prefetchingCount > 0 && !loading && (
              <span className="ml-1 text-amber-500">（后台缓存中）</span>
            )}
          </span>
        </>
      )}
      {/* 缓存状态提示 */}
      {!playing && hasComplete && (
        <span className="text-xs text-green-600">✓ 完整音频已缓存</span>
      )}
      {!playing && !hasComplete && sessionCachedCount > 0 && (
        <span className="text-xs text-green-600">✓ {sessionCachedCount}/{chunks.length} 段已缓存</span>
      )}
      {errMsg && <span className="text-xs text-red-600">⚠ {errMsg}</span>}
    </div>
  );
};

const SUBPATH_TABS: Record<string, ActiveTab> = {
  courseware: 'courseware',
  quiz: 'courseware', // 旧链接 #tutor/quiz/:id 重定向到合并后的"课程学习" Tab
  wrong: 'wrong',
  history: 'history',
};

export const AIClassroom: React.FC<AIClassroomProps> = ({ currentUser, subPath }) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('courseware');
  // 已根据 subPath 自动定位过的标记，避免 list 加载完成后无限自动打开
  const subPathHandledRef = useRef<string>('');

  // 切换 Tab 时同步到 hash，便于浏览器前进/后退与外部深链
  const switchTab = useCallback((tab: ActiveTab) => {
    setActiveTab(tab);
    const target = `#tutor/${tab}`;
    if (window.location.hash !== target) {
      window.history.pushState(null, '', target);
    }
  }, []);
  const [coursewareList, setCoursewareList] = useState<ClassroomListItem[]>([]);
  const [quizList, setQuizList] = useState<ClassroomListItem[]>([]);
  const [wrongCwList, setWrongCwList] = useState<ClassroomListItem[]>([]);
  const [wrongQuizList, setWrongQuizList] = useState<ClassroomListItem[]>([]);
  const [historyList, setHistoryList] = useState<QuizResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<ActiveView>({ kind: 'list' });
  const [deletingId, setDeletingId] = useState<string>('');
  const [cwSubject, setCwSubject] = useState('语文');
  const [wrongSubject, setWrongSubject] = useState('语文');
  const [histSubject, setHistSubject] = useState('语文');

  const activeSubject =
    activeTab === 'courseware' ? cwSubject :
    activeTab === 'wrong' ? wrongSubject :
    histSubject;
  const setActiveSubject =
    activeTab === 'courseware' ? setCwSubject :
    activeTab === 'wrong' ? setWrongSubject :
    setHistSubject;

  const loadList = useCallback(async (type: 'courseware' | 'quiz') => {
    try {
      setLoading(true); setError('');
      const resp = await fetch(`/api/classroom?type=${type}&ownerId=${currentUser.id}`);
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || '加载失败');
      if (type === 'courseware') setCoursewareList(data.data);
      else setQuizList(data.data);
    } catch (e: any) { setError(e.message || '加载失败'); }
    finally { setLoading(false); }
  }, [currentUser.id]);

  const loadWrongList = useCallback(async () => {
    try {
      setLoading(true); setError('');
      const [cwResp, quizResp] = await Promise.all([
        fetch(`/api/classroom?type=courseware&ownerId=${currentUser.id}&source=wrong_problem`),
        fetch(`/api/classroom?type=quiz&ownerId=${currentUser.id}&source=wrong_problem`),
      ]);
      const cwData = await cwResp.json();
      const quizData = await quizResp.json();
      if (!cwData.success) throw new Error(cwData.error || '加载失败');
      if (!quizData.success) throw new Error(quizData.error || '加载失败');
      setWrongCwList(cwData.data || []);
      setWrongQuizList(quizData.data || []);
    } catch (e: any) { setError(e.message || '加载失败'); }
    finally { setLoading(false); }
  }, [currentUser.id]);

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true); setError('');
      const resp = await fetch(`/api/quiz-results?ownerId=${currentUser.id}`);
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || '加载失败');
      setHistoryList(data.data);
    } catch (e: any) { setError(e.message || '加载失败'); }
    finally { setLoading(false); }
  }, [currentUser.id]);

  useEffect(() => {
    loadList('courseware');
    loadList('quiz');
    loadWrongList();
    loadHistory();
  }, [loadList, loadWrongList, loadHistory]);

  // 解析 subPath：第一段定位 Tab，第二段（如有）打开对应条目
  // 仅在 subPath 变化时执行一次（subPathHandledRef 防止 list 数据更新时反复触发）
  useEffect(() => {
    if (!subPath) {
      subPathHandledRef.current = '';
      return;
    }
    if (subPathHandledRef.current === subPath) return;

    const [seg1, seg2] = subPath.split('/');
    const targetTab = SUBPATH_TABS[seg1];
    if (!targetTab) return;

    if (activeTab !== targetTab) setActiveTab(targetTab);
    if (!seg2) {
      subPathHandledRef.current = subPath;
      return;
    }

    // 等待对应列表加载完成后定位
    const tryOpen = (): boolean => {
      if (targetTab === 'courseware') {
        // 课程学习 Tab 合并了课件与测验：双源查找
        const cw = coursewareList.find(i => i.id === seg2);
        if (cw) { openCourseware(cw); return true; }
        const qz = quizList.find(i => i.id === seg2);
        if (qz) { openQuiz(qz); return true; }
      } else if (targetTab === 'wrong') {
        const item = wrongCwList.find(i => i.id === seg2) || wrongQuizList.find(i => i.id === seg2);
        if (item) {
          if (item.type === 'courseware') openCourseware(item);
          else openQuiz(item);
          return true;
        }
      } else if (targetTab === 'history') {
        const r = historyList.find(h => h.id === seg2);
        if (r) { openResultDetail(r); return true; }
      }
      return false;
    };

    if (tryOpen()) {
      subPathHandledRef.current = subPath;
    }
    // 列表尚未加载到目标 id 时不更新 ref，下次列表更新会再次执行本 effect 重试
  }, [subPath, activeTab, coursewareList, quizList, wrongCwList, wrongQuizList, historyList]);

  // 后台批改轮询：当历史列表存在 status=grading 的项时，每 3 秒轮询一次
  useEffect(() => {
    const hasGrading = historyList.some(h => h.status === 'grading');
    if (!hasGrading) return;
    const timer = setInterval(() => { loadHistory(); }, 3000);
    return () => clearInterval(timer);
  }, [historyList, loadHistory]);

  // 二次批改：用户标记某题为正确/错误
  const handleOverride = async (resultId: string, questionId: string, isCorrect: boolean) => {
    try {
      const resp = await fetch(`/api/quiz-results/${resultId}/override`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId, isCorrect }),
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || '修改失败');
      // 更新当前详情视图
      setView(v => {
        if (v.kind !== 'result_detail') return v;
        const newResults = v.result.results.map(r =>
          r.id === questionId ? { ...r, isCorrect } : r
        );
        return {
          ...v,
          result: {
            ...v.result,
            results: newResults,
            correctCount: data.data.correctCount,
            percentage: data.data.percentage,
          },
        };
      });
      // 同步列表中的分数
      setHistoryList(prev => prev.map(h =>
        h.id === resultId ? { ...h, correctCount: data.data.correctCount, percentage: data.data.percentage } : h
      ));
    } catch (e: any) { setError(e.message || '修改失败'); }
  };

  const openCourseware = async (item: ClassroomListItem) => {
    try {
      setLoading(true);
      const resp = await fetch(`/api/classroom/${item.id}`);
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || '加载失败');
      setView({ kind: 'article', item, sections: data.data.content });
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const openQuiz = async (item: ClassroomListItem) => {
    try {
      setLoading(true);
      const resp = await fetch(`/api/classroom/${item.id}`);
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || '加载失败');
      setView({ kind: 'exam', item, questions: data.data.content });
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const openResultDetail = async (result: QuizResultItem) => {
    try {
      setLoading(true);
      const resp = await fetch(`/api/quiz-results/${result.id}`);
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || '加载失败');
      setView({ kind: 'result_detail', result: data.data });
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleDelete = async (e: React.MouseEvent, item: ClassroomListItem) => {
    e.stopPropagation();
    if (!window.confirm(`确定删除《${item.bookTitle}》${item.chapter}吗？删除后不可恢复。`)) return;
    setDeletingId(item.id);
    try {
      const resp = await fetch(`/api/classroom/${item.id}`, { method: 'DELETE' });
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || '删除失败');
      if (activeTab === 'courseware') {
        setCoursewareList(prev => prev.filter(i => i.id !== item.id));
        setQuizList(prev => prev.filter(i => i.id !== item.id));
      } else if (activeTab === 'wrong') {
        setWrongCwList(prev => prev.filter(i => i.id !== item.id));
        setWrongQuizList(prev => prev.filter(i => i.id !== item.id));
      }
    } catch (e: any) { setError(e.message); }
    finally { setDeletingId(''); }
  };

  // ——— 文章阅读视图 ———
  if (view.kind === 'article') {
    const { item, sections } = view;
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-gray-800">《{item.bookTitle}》{item.chapter}</h2>
              <p className="text-xs text-gray-500">{item.subject} · {item.userName} · {formatDate(item.createdAt)}</p>
            </div>
            <button
              onClick={() => setView({ kind: 'list' })}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold shadow-sm hover:shadow-md transition-all flex-shrink-0"
            >
              <X className="w-4 h-4" />
              退出
            </button>
          </div>
        </div>
        <CoursewareNarrator sections={sections} coursewareId={item.id} />
        <div className="space-y-4">
          {sections.map((s, i) => <SectionCard key={s.index} section={s} isLast={i === sections.length - 1} />)}
        </div>
      </div>
    );
  }

  // ——— 考试视图 ———
  if (view.kind === 'exam') {
    const { item, questions } = view;
    return (
      <QuizExam
        quizId={item.id}
        questions={questions}
        bookTitle={item.bookTitle}
        chapter={item.chapter}
        subject={item.subject}
        studentName={item.userName || currentUser.name}
        ownerId={item.ownerId}
        onClose={() => { setView({ kind: 'list' }); loadList('quiz'); loadList('courseware'); loadHistory(); }}
        onSubmitted={() => {
          setView({ kind: 'list' });
          switchTab('history');
          loadHistory();
          loadList('quiz');
          loadList('courseware');
        }}
      />
    );
  }

  // ——— 测验结果详情视图 ———
  if (view.kind === 'result_detail') {
    const { result } = view;
    const scoreColor = result.percentage >= 80 ? 'text-green-600' : result.percentage >= 60 ? 'text-yellow-600' : 'text-red-600';
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-gray-800">《{result.bookTitle}》{result.chapter} — 测验记录</h2>
              <p className="text-xs text-gray-500">{result.subject} · {result.userName} · {formatDate(result.createdAt)}</p>
            </div>
            <button
              onClick={() => setView({ kind: 'list' })}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold shadow-sm hover:shadow-md transition-all flex-shrink-0"
            >
              <X className="w-4 h-4" />
              退出
            </button>
          </div>
        </div>
        <div className={`bg-white rounded-lg border p-6 text-center ${result.percentage >= 80 ? 'border-green-200 bg-green-50' : result.percentage >= 60 ? 'border-yellow-200 bg-yellow-50' : 'border-red-200 bg-red-50'}`}>
          <p className={`text-3xl font-bold ${scoreColor}`}>{result.correctCount} / {result.total}</p>
          <p className="text-sm text-gray-600 mt-1">得分率 {result.percentage}%</p>
        </div>
        {result.suggestions && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm font-semibold text-blue-800 mb-1">📚 AI 学习建议</p>
            <p className="text-sm text-blue-700">{result.suggestions}</p>
          </div>
        )}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">题目详情</h3>
            <span className="text-xs text-gray-500">如对 AI 判分有异议，可点击「✓ 正确 / ✗ 错误」二次批改</span>
          </div>
          <div className="divide-y divide-gray-100">
            {result.results.map((r, idx) => {
              const isEssay = r.type === 'essay';
              return (
                <div key={r.id} className={`p-5 ${isEssay ? 'bg-purple-50/40' : ''}`}>
                  {/* 第一段：原题目 */}
                  <div className="flex items-start gap-3 mb-3">
                    <div className="flex-shrink-0 mt-0.5">
                      {r.isCorrect === true && <CheckCircle className="w-5 h-5 text-green-500" />}
                      {r.isCorrect === false && <XCircle className="w-5 h-5 text-red-500" />}
                      {r.isCorrect === null && <AlertCircle className="w-5 h-5 text-yellow-500" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.type === 'choice' ? 'bg-blue-100 text-blue-700' : r.type === 'fill' ? 'bg-yellow-100 text-yellow-700' : 'bg-purple-100 text-purple-700'}`}>
                          {TYPE_LABELS[r.type] || r.type}
                        </span>
                        <span className="text-xs text-gray-500">第 {idx + 1} 题</span>
                      </div>
                      <p className="text-sm font-medium text-gray-800 leading-relaxed">{r.question}</p>
                    </div>
                  </div>

                  {/* 第二段：答案对照 */}
                  <div className="ml-8 mb-3 p-3 rounded-lg bg-gray-50 border border-gray-200 space-y-1.5">
                    <div className="text-xs">
                      <span className="text-gray-500 inline-block w-20">你的答案：</span>
                      <span className={
                        r.isCorrect === null ? 'text-gray-700 font-medium' :
                        r.isCorrect ? 'text-green-700 font-medium' : 'text-red-700 font-medium'
                      }>
                        {r.studentAnswer || '（未作答）'}
                      </span>
                    </div>
                    <div className="text-xs">
                      <span className="text-gray-500 inline-block w-20">{isEssay ? '参考答案：' : '正确答案：'}</span>
                      <span className="text-green-700 font-medium">{r.correctAnswer}</span>
                    </div>
                  </div>

                  {/* 第三段：错误讲解 / AI 点评 */}
                  {r.explanation && (
                    <div className={`ml-8 mb-3 p-3 rounded-lg border text-xs leading-relaxed ${
                      isEssay
                        ? 'bg-purple-50 border-purple-200 text-purple-900'
                        : r.isCorrect === false
                          ? 'bg-yellow-50 border-yellow-200 text-yellow-900'
                          : 'bg-blue-50 border-blue-200 text-blue-900'
                    }`}>
                      <strong>{isEssay ? 'AI 点评：' : r.isCorrect === false ? '错误讲解：' : '解析：'}</strong>
                      {r.explanation}
                    </div>
                  )}

                  {/* 二次批改按钮 */}
                  <div className="ml-8 flex items-center gap-2">
                    <span className="text-xs text-gray-500">二次批改：</span>
                    <button
                      onClick={() => handleOverride(result.id, r.id, true)}
                      disabled={r.isCorrect === true}
                      className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                        r.isCorrect === true
                          ? 'border-green-500 bg-green-100 text-green-700 cursor-default'
                          : 'border-gray-300 text-gray-600 hover:border-green-500 hover:bg-green-50 hover:text-green-700'
                      }`}
                    >
                      ✓ 标为正确
                    </button>
                    <button
                      onClick={() => handleOverride(result.id, r.id, false)}
                      disabled={r.isCorrect === false}
                      className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                        r.isCorrect === false
                          ? 'border-red-500 bg-red-100 text-red-700 cursor-default'
                          : 'border-gray-300 text-gray-600 hover:border-red-500 hover:bg-red-50 hover:text-red-700'
                      }`}
                    >
                      ✗ 标为错误
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ——— 课程学习分组：按 bookTitle + chapter 配对课件+测验 ———
  type ChapterGroup = {
    key: string;
    bookTitle: string;
    chapter: string;
    subject: string;
    userName: string;
    courseware?: ClassroomListItem;
    quiz?: ClassroomListItem;
    latestAt: number;
  };
  const buildChapterGroups = (): ChapterGroup[] => {
    const map = new Map<string, ChapterGroup>();
    const norm = (s: string) => (s || '').trim();
    // 仅手动录入（来自智慧工坊"教材→课件+测验"），错题来源单独走 wrong tab
    const cwSource = coursewareList.filter(i => (i.source || 'manual') === 'manual');
    const qzSource = quizList.filter(i => (i.source || 'manual') === 'manual');
    for (const cw of cwSource) {
      const key = `${norm(cw.bookTitle)}||${norm(cw.chapter)}`;
      const cur = map.get(key) || {
        key, bookTitle: cw.bookTitle, chapter: cw.chapter,
        subject: cw.subject, userName: cw.userName, latestAt: 0,
      };
      // 同章节多课件取最新
      if (!cur.courseware || cw.createdAt > cur.courseware.createdAt) cur.courseware = cw;
      cur.latestAt = Math.max(cur.latestAt, cw.createdAt);
      map.set(key, cur);
    }
    for (const q of qzSource) {
      const key = `${norm(q.bookTitle)}||${norm(q.chapter)}`;
      const cur = map.get(key) || {
        key, bookTitle: q.bookTitle, chapter: q.chapter,
        subject: q.subject, userName: q.userName, latestAt: 0,
      };
      if (!cur.quiz || q.createdAt > cur.quiz.createdAt) cur.quiz = q;
      cur.latestAt = Math.max(cur.latestAt, q.createdAt);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.latestAt - a.latestAt);
  };

  // ——— 错题分组：按 sourceProblemId 配对讲解+测验 ———
  type WrongPair = { sourceProblemId: string; courseware?: ClassroomListItem; quiz?: ClassroomListItem; latestAt: number };
  const buildWrongPairs = (): WrongPair[] => {
    const map = new Map<string, WrongPair>();
    for (const cw of wrongCwList) {
      const key = cw.sourceProblemId || cw.id;
      const cur = map.get(key) || { sourceProblemId: key, latestAt: 0 };
      cur.courseware = cw;
      cur.latestAt = Math.max(cur.latestAt, cw.createdAt);
      map.set(key, cur);
    }
    for (const q of wrongQuizList) {
      const key = q.sourceProblemId || q.id;
      const cur = map.get(key) || { sourceProblemId: key, latestAt: 0 };
      cur.quiz = q;
      cur.latestAt = Math.max(cur.latestAt, q.createdAt);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.latestAt - a.latestAt);
  };

  // ——— 列表视图 ———
  const rawList =
    activeTab === 'courseware' ? buildChapterGroups() :
    activeTab === 'wrong' ? buildWrongPairs() :
    historyList;
  const list = (activeSubject === '全部'
    ? rawList
    : (rawList as any[]).filter((item: any) =>
        activeTab === 'courseware'
          ? item.subject === activeSubject
          : activeTab === 'wrong'
          ? (item.courseware?.subject === activeSubject || item.quiz?.subject === activeSubject)
          : item.subject === activeSubject
      )) as any[];

  return (
    <div className="space-y-6">
      <div className="bg-cyber-surface/60 backdrop-blur-md rounded-2xl border border-cyber-border/60 p-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-rose-400/15 rounded-xl flex items-center justify-center shadow-glow-sm">
            <GraduationCap className="w-6 h-6 text-rose-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight bg-gradient-to-r from-neon-blue via-cyber-text to-neon-purple bg-clip-text text-transparent">{currentUser.name} 的智慧课堂</h2>
            <p className="text-sm text-cyber-muted">课程学习 · 错题测验 · 测验记录，一站式复习</p>
          </div>
        </div>
      </div>

      <div className="bg-cyber-surface/60 backdrop-blur-md rounded-2xl border border-cyber-border/60 overflow-hidden">
        {/* Tab 切换 */}
        <div className="flex border-b border-cyber-border/60">
          {([
            { id: 'courseware', label: '课程学习', icon: BookOpen, count: buildChapterGroups().length, activeCls: 'text-neon-blue border-b-2 border-neon-blue bg-neon-blue/10' },
            { id: 'wrong', label: '错题测验', icon: AlertTriangle, count: wrongCwList.length + wrongQuizList.length, activeCls: 'text-neon-amber border-b-2 border-neon-amber bg-neon-amber/10' },
            { id: 'history', label: '测验记录', icon: History, count: historyList.length, activeCls: 'text-neon-purple border-b-2 border-neon-purple bg-neon-purple/10' },
          ] as const).map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors ${
                  isActive ? tab.activeCls : 'text-cyber-muted hover:text-cyber-text'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                <span className="text-xs text-cyber-muted">({tab.count})</span>
              </button>
            );
          })}
        </div>

        {/* 学科筛选 */}
        <div className="px-4 pt-3 pb-1 flex gap-2 flex-wrap border-b border-cyber-border/60">
          {SUBJECTS.map(s => (
            <button
              key={s}
              onClick={() => setActiveSubject(s)}
              className={`text-xs px-3 py-1 rounded-full font-medium transition-colors border ${
                activeSubject === s
                  ? activeTab === 'courseware' ? 'bg-neon-blue/20 text-neon-blue border-neon-blue/50 shadow-glow-sm'
                    : activeTab === 'wrong' ? 'bg-neon-amber/20 text-neon-amber border-neon-amber/50 shadow-glow-amber'
                    : 'bg-neon-purple/20 text-neon-purple border-neon-purple/50'
                  : 'bg-white/5 text-cyber-muted border-transparent hover:bg-white/10 hover:text-cyber-text'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* 列表内容 */}
        <div className="p-4">
          <div className="flex justify-end mb-3">
            <button
              onClick={() => {
                if (activeTab === 'history') loadHistory();
                else if (activeTab === 'wrong') loadWrongList();
                else { loadList('courseware'); loadList('quiz'); }
              }}
              className="flex items-center gap-1 text-xs text-cyber-muted hover:text-neon-blue transition-colors"
            >
              <RefreshCw className="w-3 h-3" />刷新
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 rounded-xl border border-red-500/40 mb-3">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="text-sm text-red-300">{error}</span>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-neon-blue animate-spin" />
            </div>
          )}

          {!loading && list.length === 0 && (
            <div className="text-center py-16 text-cyber-muted">
              <GraduationCap className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-sm">
                {rawList.length === 0
                  ? activeTab === 'courseware' ? '暂无课程内容，前往智慧工坊生成课件与配套测验'
                    : activeTab === 'wrong' ? '暂无错题测验，前往智慧工坊「错题 → 讲解 + 测验」生成'
                    : '暂无测验记录'
                  : `「${activeSubject}」学科暂无记录`}
              </p>
            </div>
          )}

          {!loading && list.length > 0 && activeTab === 'wrong' && (
            <div className="space-y-3">
              {(list as WrongPair[]).map(pair => {
                const subject = pair.courseware?.subject || pair.quiz?.subject || '综合';
                const userName = pair.courseware?.userName || pair.quiz?.userName || '';
                const title = pair.courseware?.bookTitle || pair.quiz?.bookTitle || '错题';
                return (
                  <div key={pair.sourceProblemId} className="border border-cyber-border/60 rounded-xl overflow-hidden bg-cyber-bg2/40">
                    <div className="bg-neon-amber/10 px-4 py-2 flex items-center gap-2 border-b border-neon-amber/30">
                      <AlertTriangle className="w-4 h-4 text-neon-amber" />
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-neon-amber/15 text-neon-amber border border-neon-amber/40">{subject}</span>
                      <span className="text-xs text-cyber-muted">{userName}</span>
                      <span className="text-sm font-medium text-cyber-text truncate flex-1">{title}</span>
                      <span className="text-xs text-cyber-muted">{formatDate(pair.latestAt)}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-x divide-cyber-border/40">
                      {pair.courseware ? (
                        <div className="relative group">
                          <button
                            onClick={() => openCourseware(pair.courseware!)}
                            className="w-full text-left p-4 hover:bg-neon-blue/10 transition-colors"
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="flex items-center gap-1.5 text-neon-blue font-medium text-sm">
                                  <FileText className="w-4 h-4" />错题讲解
                                </div>
                                <div className="text-xs text-cyber-muted mt-1">
                                  {pair.courseware.slideCount || 0} 节 · {formatDate(pair.courseware.createdAt)}
                                </div>
                              </div>
                              <ChevronRight className="w-5 h-5 text-cyber-muted group-hover:text-neon-blue" />
                            </div>
                          </button>
                          <button
                            onClick={(e) => handleDelete(e, pair.courseware!)}
                            disabled={deletingId === pair.courseware.id}
                            className="absolute top-3 right-10 p-1.5 text-cyber-muted hover:text-rose-400 hover:bg-rose-400/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                            title="删除讲解"
                          >
                            {deletingId === pair.courseware.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </button>
                        </div>
                      ) : (
                        <div className="p-4 text-xs text-cyber-muted">讲解已删除或缺失</div>
                      )}
                      {pair.quiz ? (
                        <div className="relative group">
                          <button
                            onClick={() => openQuiz(pair.quiz!)}
                            className="w-full text-left p-4 hover:bg-emerald-500/10 transition-colors"
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="flex items-center gap-1.5 text-emerald-400 font-medium text-sm">
                                  <ClipboardCheck className="w-4 h-4" />错题测验
                                </div>
                                <div className="text-xs text-cyber-muted mt-1">
                                  {pair.quiz.questionCount || 0} 道题 · {formatDate(pair.quiz.createdAt)}
                                </div>
                              </div>
                              <ChevronRight className="w-5 h-5 text-cyber-muted group-hover:text-emerald-400" />
                            </div>
                          </button>
                          <button
                            onClick={(e) => handleDelete(e, pair.quiz!)}
                            disabled={deletingId === pair.quiz.id}
                            className="absolute top-3 right-10 p-1.5 text-cyber-muted hover:text-rose-400 hover:bg-rose-400/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                            title="删除测验"
                          >
                            {deletingId === pair.quiz.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </button>
                        </div>
                      ) : (
                        <div className="p-4 text-xs text-cyber-muted">
                          {pair.quiz === undefined && '已完成或缺失'}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!loading && list.length > 0 && activeTab === 'courseware' && (
            <div className="space-y-3">
              {(list as ChapterGroup[]).map(group => (
                <div key={group.key} className="border border-cyber-border/60 rounded-xl overflow-hidden bg-cyber-bg2/40">
                  <div className="bg-neon-blue/10 px-4 py-2 flex items-center gap-2 border-b border-neon-blue/30">
                    <BookOpen className="w-4 h-4 text-neon-blue" />
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-neon-blue/15 text-neon-blue border border-neon-blue/40">{group.subject}</span>
                    {group.userName && <span className="text-xs text-cyber-muted">{group.userName}</span>}
                    <span className="text-sm font-medium text-cyber-text truncate flex-1">《{group.bookTitle}》{group.chapter}</span>
                    <span className="text-xs text-cyber-muted">{formatDate(group.latestAt)}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 divide-x divide-cyber-border/40">
                    {group.courseware ? (
                      <div className="relative group">
                        <button
                          onClick={() => openCourseware(group.courseware!)}
                          className="w-full text-left p-4 hover:bg-neon-blue/10 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-1.5 text-neon-blue font-medium text-sm">
                                <FileText className="w-4 h-4" />课件学习
                              </div>
                              <div className="text-xs text-cyber-muted mt-1">
                                {group.courseware.slideCount || 0} 节 · {formatDate(group.courseware.createdAt)}
                              </div>
                            </div>
                            <ChevronRight className="w-5 h-5 text-cyber-muted group-hover:text-neon-blue" />
                          </div>
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, group.courseware!)}
                          disabled={deletingId === group.courseware.id}
                          className="absolute top-3 right-10 p-1.5 text-cyber-muted hover:text-rose-400 hover:bg-rose-400/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          title="删除课件"
                        >
                          {deletingId === group.courseware.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    ) : (
                      <div className="p-4 text-xs text-cyber-muted">课件未生成</div>
                    )}
                    {group.quiz ? (
                      <div className="relative group">
                        <button
                          onClick={() => openQuiz(group.quiz!)}
                          className="w-full text-left p-4 hover:bg-emerald-500/10 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-1.5 text-emerald-400 font-medium text-sm">
                                <ClipboardCheck className="w-4 h-4" />配套测验
                              </div>
                              <div className="text-xs text-cyber-muted mt-1">
                                {group.quiz.questionCount || 0} 道题 · {formatDate(group.quiz.createdAt)}
                              </div>
                            </div>
                            <ChevronRight className="w-5 h-5 text-cyber-muted group-hover:text-emerald-400" />
                          </div>
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, group.quiz!)}
                          disabled={deletingId === group.quiz.id}
                          className="absolute top-3 right-10 p-1.5 text-cyber-muted hover:text-rose-400 hover:bg-rose-400/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          title="删除测验"
                        >
                          {deletingId === group.quiz.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    ) : (
                      <div className="p-4 text-xs text-cyber-muted">测验未生成</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 测验记录列表 */}
          {!loading && list.length > 0 && activeTab === 'history' && (
            <div className="space-y-3">
              {list.map((r: QuizResultItem) => {
                const scoreColor = r.percentage >= 80 ? 'text-green-600' : r.percentage >= 60 ? 'text-yellow-600' : 'text-red-600';
                const isGrading = r.status === 'grading';
                const isFailed = r.status === 'failed';
                return (
                  <button
                    key={r.id}
                    onClick={() => !isGrading && openResultDetail(r)}
                    disabled={isGrading}
                    className={`w-full text-left p-4 rounded-xl border border-cyber-border/60 bg-cyber-bg2/40 transition-colors group ${
                      isGrading ? 'cursor-wait opacity-70' : 'hover:border-neon-purple/50 hover:bg-neon-purple/5'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-neon-purple/15 text-neon-purple border border-neon-purple/40">{r.subject}</span>
                          <span className="text-xs text-cyber-muted">{r.userName}</span>
                          {isGrading && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-neon-blue/15 text-neon-blue border border-neon-blue/40 flex items-center gap-1">
                              <Loader2 className="w-3 h-3 animate-spin" />批改中
                            </span>
                          )}
                          {isFailed && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-rose-400/15 text-rose-300 border border-rose-400/40">批改失败</span>
                          )}
                          {r.status === 'completed' && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/40">已完成</span>
                          )}
                        </div>
                        <p className="font-medium text-cyber-text truncate">《{r.bookTitle}》{r.chapter}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-cyber-muted">{formatDate(r.createdAt)}</span>
                          {!isGrading && !isFailed && (
                            <span className={`text-xs font-bold ${scoreColor}`}>{r.correctCount}/{r.total} ({r.percentage}%)</span>
                          )}
                          {isGrading && <span className="text-xs text-neon-blue">AI 正在批改，请稍候...</span>}
                        </div>
                      </div>
                      {!isGrading && <ChevronRight className="w-5 h-5 text-cyber-muted group-hover:text-neon-purple flex-shrink-0" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
