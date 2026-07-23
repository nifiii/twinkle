
import React, { useState, useEffect, useRef } from 'react';
import { UserProfile } from '../types';
import { encode, decode, decodeAudioData } from '../services/audioUtils';

interface LiveTutorProps {
  currentUser: UserProfile;
  onClose: () => void;
}

const LiveTutor: React.FC<LiveTutorProps> = ({ currentUser, onClose }) => {
  const [isActive, setIsActive] = useState(false);
  const [transcription, setTranscription] = useState<{ type: 'user' | 'model'; text: string }[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const vadEndedAtRef = useRef<number | null>(null);

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

  const startSession = async () => {
    try {
      setIsActive(true);
      setErrorMessage(null);
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
          if (socket.readyState !== WebSocket.OPEN) return;
          const input = event.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(input.length);
          for (let index = 0; index < input.length; index++) pcm[index] = Math.max(-1, Math.min(1, input[index])) * 32767;
          socket.send(pcm.buffer);
        };
        setIsListening(true);
      };
      socket.onmessage = async event => {
        const message = JSON.parse(event.data as string) as { type: string; side?: 'user' | 'tutor'; text?: string; data?: string };
        if (message.type === 'transcript' && message.text && message.side) {
          setTranscription(previous => [...previous, { type: message.side === 'user' ? 'user' : 'model', text: message.text! }]);
        }
        if (message.type === 'vad_ended') vadEndedAtRef.current = performance.now();
        if (message.type === 'interrupted') stopPlayback();
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
          setTranscription(previous => [...previous, { type: 'model', text }]);
        }
      };
      socket.onerror = () => setErrorMessage('实时导师连接失败，请检查网络后重试');
      socket.onclose = () => {
        setIsActive(false);
        setIsListening(false);
      };
    } catch (err) {
      console.error('Failed to start tutor session');
      setErrorMessage('无法使用麦克风，请检查浏览器权限后重试');
      setIsActive(false);
    }
  };

  useEffect(() => {
    startSession();
    return () => {
      closeSession();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-xl animate-fade-in">
      <div className="w-full max-w-lg p-8 flex flex-col items-center text-center space-y-8">
        <div className="relative">
          {/* Animated Pulse Orb */}
          <div className={`w-32 h-32 rounded-full bg-gradient-to-br from-brand-500 to-indigo-600 flex items-center justify-center shadow-[0_0_50px_rgba(14,165,233,0.4)] transition-transform duration-500 ${isSpeaking || isListening ? 'scale-110' : 'scale-100'}`}>
            <i className={`fa-solid ${isSpeaking ? 'fa-waveform-lines' : 'fa-microphone'} text-5xl text-white ${isSpeaking ? 'animate-pulse' : ''}`}></i>
          </div>
          {(isSpeaking || isListening) && (
             <div className="absolute inset-[-10px] rounded-full border-2 border-brand-400/30 animate-ping"></div>
          )}
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-black text-white">AI 专家导师</h2>
          <p className="text-brand-400 text-xs font-bold uppercase tracking-widest">
            {errorMessage || (isSpeaking ? '正在讲解中...' : isListening ? '正在倾听...' : '连接中...')}
          </p>
        </div>

        <div className="w-full h-48 bg-white/5 rounded-3xl border border-white/10 p-4 overflow-y-auto custom-scrollbar flex flex-col space-y-3">
          {transcription.length === 0 && (
            <p className="text-slate-500 text-sm mt-10">“你可以试着问我：这道几何题的辅助线怎么画？”</p>
          )}
          {transcription.map((t, i) => (
            <div key={i} className={`flex ${t.type === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-4 py-2 rounded-2xl text-xs font-medium ${t.type === 'user' ? 'bg-brand-500 text-white' : 'bg-slate-800 text-slate-200 border border-slate-700'}`}>
                {t.text}
              </div>
            </div>
          ))}
        </div>

        <div className="flex space-x-4">
          <button 
            onClick={() => { closeSession(); onClose(); }}
            className="px-10 py-4 bg-white/10 hover:bg-white/20 text-white rounded-2xl font-black transition-all"
          >
            结束辅导
          </button>
        </div>
      </div>
    </div>
  );
};

export default LiveTutor;
