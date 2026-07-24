import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Send, Volume2, Wifi, X } from 'lucide-react';
import { UserProfile } from '../types';
import { decode, decodeAudioData } from '../services/audioUtils';

interface LiveTutorProps {
  currentUser: UserProfile;
  onClose: () => void;
}

interface ChatMessage {
  id: string;
  side: 'user' | 'tutor';
  text: string;
}

interface TutorEvent {
  type: string;
  side?: 'user' | 'tutor';
  text?: string;
  data?: string;
  isInterim?: boolean;
}

const createMessageId = (side: ChatMessage['side']) => `${side}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const LiveTutor: React.FC<LiveTutorProps> = ({ currentUser, onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [interimUserText, setInterimUserText] = useState('');
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const vadEndedAtRef = useRef<number | null>(null);
  const isMicMutedRef = useRef(false);
  const activeTutorMessageIdRef = useRef<string | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  const stopPlayback = () => {
    for (const source of sourcesRef.current.values()) source.stop();
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsSpeaking(false);
  };

  const closeSession = () => {
    socketRef.current?.close();
    socketRef.current = null;
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach(track => track.stop());
    audioContextRef.current?.close();
    outputAudioContextRef.current?.close();
    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
    outputAudioContextRef.current = null;
    stopPlayback();
  };

  const addMessage = (side: ChatMessage['side'], text: string) => {
    setMessages(previous => [...previous, { id: createMessageId(side), side, text }]);
  };

  const appendTutorText = (text: string) => {
    let messageId = activeTutorMessageIdRef.current;
    if (!messageId) {
      messageId = createMessageId('tutor');
      activeTutorMessageIdRef.current = messageId;
      const createdId = messageId;
      setMessages(previous => [...previous, { id: createdId, side: 'tutor', text }]);
      return;
    }
    setMessages(previous => previous.map(message => message.id === messageId
      ? { ...message, text: message.text + text }
      : message));
  };

  const startSession = async () => {
    try {
      setErrorMessage(null);
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${scheme}://${window.location.host}/api/live-tutor?ownerId=${encodeURIComponent(currentUser.id)}`);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;
      socket.onopen = () => {
        const source = audioContextRef.current!.createMediaStreamSource(stream);
        const processor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
        source.connect(processor);
        processor.connect(audioContextRef.current!.destination);
        sourceRef.current = source;
        processorRef.current = processor;
        processor.onaudioprocess = event => {
          if (isMicMutedRef.current || socket.readyState !== WebSocket.OPEN) return;
          const input = event.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(input.length);
          for (let index = 0; index < input.length; index++) pcm[index] = Math.max(-1, Math.min(1, input[index])) * 32767;
          socket.send(pcm.buffer);
        };
      };
      socket.onmessage = async event => {
        const message = JSON.parse(event.data as string) as TutorEvent;
        if (message.type === 'session_started') setIsSessionReady(true);
        if (message.type === 'transcript' && message.text && message.side === 'user') {
          if (message.isInterim) {
            setInterimUserText(message.text);
          } else {
            setInterimUserText('');
            activeTutorMessageIdRef.current = null;
            addMessage('user', message.text);
          }
        }
        if (message.type === 'transcript' && message.text && message.side === 'tutor') appendTutorText(message.text);
        if (message.type === 'vad_ended') vadEndedAtRef.current = performance.now();
        if (message.type === 'interrupted') {
          activeTutorMessageIdRef.current = null;
          stopPlayback();
        }
        if (message.type === 'audio' && message.data && outputAudioContextRef.current) {
          const context = outputAudioContextRef.current;
          const audioBuffer = await decodeAudioData(decode(message.data), context, 24000, 1);
          const source = context.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(context.destination);
          source.addEventListener('ended', () => {
            sourcesRef.current.delete(source);
            if (sourcesRef.current.size === 0) setIsSpeaking(false);
          });
          nextStartTimeRef.current = Math.max(nextStartTimeRef.current, context.currentTime);
          source.start(nextStartTimeRef.current);
          if (vadEndedAtRef.current !== null) {
            console.info('[LiveTutor] live_first_audio_ms', Math.round(performance.now() - vadEndedAtRef.current));
            vadEndedAtRef.current = null;
          }
          nextStartTimeRef.current += audioBuffer.duration;
          sourcesRef.current.add(source);
          setIsSpeaking(true);
        }
        if (message.type === 'error') {
          const text = message.text || '实时导师暂时不可用，请稍后重试';
          setErrorMessage(text);
          addMessage('tutor', text);
        }
      };
      socket.onerror = () => setErrorMessage('实时导师连接失败，请检查网络后重试');
      socket.onclose = () => {
        setIsSessionReady(false);
        activeTutorMessageIdRef.current = null;
      };
    } catch {
      setErrorMessage('无法使用麦克风，请检查浏览器权限后重试');
      setIsSessionReady(false);
    }
  };

  const sendText = () => {
    const text = draft.trim();
    const socket = socketRef.current;
    if (!text || !isSessionReady || !socket || socket.readyState !== WebSocket.OPEN) return;
    activeTutorMessageIdRef.current = null;
    addMessage('user', text);
    socket.send(JSON.stringify({ type: 'text', text }));
    setDraft('');
  };

  const toggleMicrophone = () => {
    const nextMuted = !isMicMutedRef.current;
    isMicMutedRef.current = nextMuted;
    setIsMicMuted(nextMuted);
  };

  useEffect(() => {
    startSession();
    return () => closeSession();
  }, []);

  useEffect(() => {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, interimUserText]);

  const statusText = errorMessage || (isSessionReady ? (isSpeaking ? '导师正在回复' : isMicMuted ? '语音已暂停' : '正在聆听') : '正在连接');

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] flex items-end justify-end p-4 animate-fade-in">
      <section className="pointer-events-auto flex h-[min(620px,calc(100dvh-2rem))] w-full max-w-md flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl" aria-label="实时导师聊天">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-zinc-200 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white" aria-hidden="true">
              <Volume2 size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold text-zinc-900">家庭导师</h2>
              <p className="flex items-center gap-1 truncate text-xs text-zinc-500"><Wifi size={12} className={isSessionReady ? 'text-emerald-500' : 'text-zinc-400'} />{statusText}</p>
            </div>
          </div>
          <button type="button" onClick={() => { closeSession(); onClose(); }} className="flex h-9 items-center gap-1 rounded-md border border-zinc-300 px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900" aria-label="关闭实时导师">
            <X size={20} />
            <span>关闭</span>
          </button>
        </header>

        <main ref={messageListRef} className="flex-1 overflow-y-auto px-4 py-5" aria-live="polite">
          {messages.length === 0 && !interimUserText && (
            <div className="mx-auto mt-16 max-w-sm text-center">
              <p className="text-sm font-medium text-zinc-700">现在开始辅导</p>
              <p className="mt-2 text-sm leading-6 text-zinc-500">直接说话，或输入想问的问题。</p>
            </div>
          )}
          <div className="space-y-4">
            {messages.map(message => (
              <div key={message.id} className={`flex ${message.side === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[82%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-6 ${message.side === 'user' ? 'bg-brand-500 text-white' : 'bg-zinc-100 text-zinc-800'}`}>
                  {message.text}
                </div>
              </div>
            ))}
            {interimUserText && (
              <div className="flex justify-end">
                <div className="max-w-[82%] whitespace-pre-wrap break-words rounded-lg bg-brand-50 px-3 py-2 text-sm leading-6 text-brand-700 ring-1 ring-brand-200">
                  {interimUserText}
                </div>
              </div>
            )}
          </div>
        </main>

        <footer className="shrink-0 border-t border-zinc-200 bg-white px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="flex items-end gap-2">
            <button type="button" onClick={toggleMicrophone} disabled={!isSessionReady} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:text-zinc-300 ${isMicMuted ? 'bg-zinc-100 text-zinc-500' : 'bg-brand-50 text-brand-600 hover:bg-brand-100'}`} aria-label={isMicMuted ? '恢复语音输入' : '暂停语音输入'}>
              {isMicMuted ? <MicOff size={19} /> : <Mic size={19} />}
            </button>
            <textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendText(); } }} disabled={!isSessionReady} rows={1} maxLength={2000} placeholder={isSessionReady ? '输入消息' : '正在连接导师...'} className="max-h-28 min-h-10 flex-1 resize-none rounded-md border border-zinc-300 px-3 py-2 text-sm leading-5 text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-brand-500 disabled:bg-zinc-50" />
            <button type="button" onClick={sendText} disabled={!draft.trim() || !isSessionReady} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand-500 text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-zinc-200" aria-label="发送消息">
              <Send size={18} />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
};

export default LiveTutor;
