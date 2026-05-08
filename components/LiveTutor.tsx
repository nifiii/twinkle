
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Blob } from '@google/genai';
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
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const startSession = async () => {
    try {
      setIsActive(true);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            console.log('Tutor Session Connected');
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              if (!sessionRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              // Convert to Int16
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) {
                int16[i] = inputData[i] * 32768;
              }
              
              const pcmBlob: Blob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current!.destination);
            setIsListening(true);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text ?? '';
              setTranscription(prev => [...prev, { type: 'user', text }]);
            }
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text ?? '';
              setTranscription(prev => [...prev, { type: 'model', text }]);
            }

            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              setIsSpeaking(true);
              const ctx = outputAudioContextRef.current!;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setIsSpeaking(false);
              });
              
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              for (const source of sourcesRef.current.values()) {
                source.stop();
              }
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }
          },
          onerror: (e) => console.error('Tutor Error:', e),
          onclose: () => setIsActive(false),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `你是一位全能 AI 家庭导师，正在为${currentUser.name}（${currentUser.grade}）提供辅导。
          你的语气应该是：热情、专业、富有启发性。
          如果学生问你题目，你应该通过引导思考的方式帮助他们，而不是直接给答案。
          保持简短有力的语音反馈。`,
        },
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error('Failed to start tutor session:', err);
      setIsActive(false);
    }
  };

  useEffect(() => {
    startSession();
    return () => {
      if (sessionRef.current) sessionRef.current.close();
      if (audioContextRef.current) audioContextRef.current.close();
      if (outputAudioContextRef.current) outputAudioContextRef.current.close();
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
            {isSpeaking ? '正在讲解中...' : isListening ? '正在倾听...' : '连接中...'}
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
            onClick={onClose}
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
