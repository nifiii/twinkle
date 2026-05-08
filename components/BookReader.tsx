import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Download, Maximize2, Minimize2, BookOpen,
  FileText, AlertCircle, Menu, ChevronRight,
  Settings, Type, Sun, Moon, Coffee, Copy, Check
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, prism } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { EBook, ChapterNode } from '../types';
import { Button, LoadingSpinner } from './ui';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface BookReaderProps {
  book: EBook;
  onClose: () => void;
}

type ReadingMode = 'default' | 'sepia' | 'dark';

export const BookReader: React.FC<BookReaderProps> = ({ book, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [showToc, setShowToc] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [readingMode, setReadingMode] = useState<ReadingMode>('default');
  const [fontSize, setFontSize] = useState<number>(18);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // 监听滚动进度
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - clientHeight <= 0) return;
    const progress = (scrollTop / (scrollHeight - clientHeight)) * 100;
    setScrollProgress(progress);
  }, []);

  // 设置 Intersection Observer 追踪当前章节
  useEffect(() => {
    if (!content) return;

    const options = {
      root: containerRef.current,
      rootMargin: '-10% 0px -80% 0px',
      threshold: 0
    };

    observerRef.current = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActiveChapterId(entry.target.id);
        }
      });
    }, options);

    // 等待 Markdown 渲染完成后再观察
    const timer = setTimeout(() => {
      const headings = containerRef.current?.querySelectorAll('h1, h2, h3');
      headings?.forEach((h) => observerRef.current?.observe(h));
    }, 1000);

    return () => {
      observerRef.current?.disconnect();
      clearTimeout(timer);
    };
  }, [content]);

  // 跳转到章节
  const scrollToChapter = (title: string) => {
    if (!containerRef.current) return;
    
    // 在 Markdown 内容中寻找标题
    const headings = containerRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (const h of Array.from(headings)) {
      if (h.textContent?.includes(title)) {
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (window.innerWidth < 768) setShowToc(false);
        break;
      }
    }
  };

  // 代码块复制组件
  const CodeBlock = ({ node, inline, className, children, ...props }: any) => {
    const [copied, setCopied] = useState(false);
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : '';

    const handleCopy = () => {
      navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    if (inline) {
      return <code className={className} {...props}>{children}</code>;
    }

    return (
      <div className="relative group">
        <div className="absolute right-3 top-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleCopy}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-lg backdrop-blur-sm text-white/70 hover:text-white transition-colors"
            title="复制代码"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <SyntaxHighlighter
          style={readingMode === 'dark' ? vscDarkPlus : prism}
          language={language}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderRadius: '1rem',
            padding: '1.5rem',
            fontSize: `${fontSize * 0.85}px`
          }}
          {...props}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      </div>
    );
  };

  // 处理文件路径转换为可访问的 URL
  const getFileUrl = (path?: string) => {
    if (!path) return '';
    
    // 统一处理斜杠
    const normalizedPath = path.replace(/\\/g, '/');
    
    // 智能提取逻辑：寻找关键路径标识符
    const obsidianIndex = normalizedPath.indexOf('/obsidian/');
    const originalsIndex = normalizedPath.indexOf('/originals/');
    const uploadsIndex = normalizedPath.indexOf('/uploads/');
    
    if (obsidianIndex !== -1) {
      return '/data' + normalizedPath.substring(obsidianIndex);
    }
    if (originalsIndex !== -1) {
      return '/data' + normalizedPath.substring(originalsIndex);
    }
    if (uploadsIndex !== -1) {
      return normalizedPath.substring(uploadsIndex);
    }
    
    // 兜底逻辑：如果已经是相对 URL 或无法解析，原样返回
    return path;
  };

  const mdUrl = getFileUrl(book.mdPath || ((book as any).filePath?.endsWith('.md') ? (book as any).filePath : null));

  useEffect(() => {
    if (book.indexStatus === 'failed') {
      setError('图书处理失败（AI 转换超时或出错），请尝试重新上传。');
      setLoading(false);
      return;
    }

    if (!mdUrl) {
      setError('该图书暂无 Markdown 格式内容，请等待系统处理完成。');
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(mdUrl)
      .then(res => {
        if (!res.ok) throw new Error('无法读取图书内容');
        return res.text();
      })
      .then(text => {
        setContent(text);
        setLoading(false);
      })
      .catch(err => {
        console.error('加载 Markdown 失败:', err);
        setError('加载图书内容失败，请稍后重试。');
        setLoading(false);
      });
  }, [mdUrl]);

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  // ESC 退出全屏；全屏时锁住 body 滚动 + 加 reader-fullscreen 类
  // Why: 全屏类配合 src/index.css 规则隐藏 Layout 的 header/侧栏/底栏，
  //      根除移动端 z-index 被 backdrop-blur stacking context 截断的问题
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    if (isFullscreen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.body.classList.add('reader-fullscreen');
      return () => {
        document.body.style.overflow = prev;
        document.body.classList.remove('reader-fullscreen');
        window.removeEventListener('keydown', onKey);
      };
    }
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  // 组件卸载时（如直接 onClose 关闭阅读器）清理类，避免残留
  useEffect(() => {
    return () => {
      document.body.classList.remove('reader-fullscreen');
      document.body.style.overflow = '';
    };
  }, []);

  // 递归渲染目录项
  const ChapterItem: React.FC<{ chapter: ChapterNode; onSelect: (title: string) => void }> = ({ chapter, onSelect }) => {
    const isActive = activeChapterId === chapter.title;
    
    return (
      <div className="flex flex-col">
        <button
          onClick={() => onSelect(chapter.title)}
          className={cn(
            "text-left px-3 py-2 rounded-lg transition-all text-sm group flex items-center gap-2",
            isActive 
              ? "bg-blue-50 text-blue-600 font-bold" 
              : "text-gray-600 hover:bg-gray-100",
            chapter.level === 2 && "ml-4",
            chapter.level === 3 && "ml-8"
          )}
        >
          <ChevronRight 
            size={14} 
            className={cn(
              "transition-opacity",
              isActive ? "opacity-100 text-blue-400" : "opacity-0 group-hover:opacity-100 text-gray-300"
            )} 
          />
          <span className="truncate">{chapter.title}</span>
        </button>
        {chapter.children && chapter.children.length > 0 && (
          <div className="flex flex-col">
            {chapter.children.map(child => (
              <ChapterItem key={child.id} chapter={child} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>
    );
  };

  const reader = (
    <div className={cn(
      "fixed flex flex-col transition-colors duration-300",
      // 全屏：覆盖整个视口；非全屏：避开顶部 header(64px)、桌面侧栏(280px)、移动底栏(72px)
      isFullscreen
        ? "inset-0 z-[100] pt-[env(safe-area-inset-top)]"
        : "top-16 left-0 right-0 bottom-[72px] md:bottom-0 md:left-[280px] z-40 p-2 md:p-4",
      readingMode === 'default' && "bg-gray-50",
      readingMode === 'sepia' && "bg-[#f4ecd8]",
      readingMode === 'dark' && "bg-[#1a1a1a]"
    )}>
      {/* 顶部工具栏 */}
      <div className={cn(
        "px-4 py-3 flex items-center justify-between shadow-sm h-16 shrink-0 rounded-t-xl border-b transition-colors duration-300",
        readingMode === 'default' && "bg-white border-gray-200",
        readingMode === 'sepia' && "bg-[#fdf6e3] border-[#eee8d5]",
        readingMode === 'dark' && "bg-[#2d2d2d] border-[#3d3d3d]"
      )}>
        <div className="flex items-center gap-3 overflow-hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowToc(!showToc)}
            className={cn(
              "h-11 w-11 p-0 rounded-xl shrink-0 transition-all duration-300 shadow-sm border flex items-center justify-center group backdrop-blur-md",
              showToc 
                ? "bg-blue-600 text-white border-blue-400 shadow-blue-200/50 scale-105" 
                : (readingMode === 'dark' ? "bg-white/5 text-gray-400 border-white/10 hover:bg-white/10" : "bg-white/80 text-gray-500 border-gray-200/50 hover:bg-gray-50 hover:shadow-md")
            )}
            title={showToc ? "收起目录" : "展开目录"}
          >
            <BookOpen size={32} strokeWidth={1.5} className={cn("transition-all duration-300 group-hover:scale-110 shrink-0", showToc && "scale-110")} />
          </Button>
          
          <div className="flex flex-col overflow-hidden">
            <h2 className={cn(
              "font-bold truncate text-sm md:text-base tracking-tight",
              readingMode === 'dark' ? "text-gray-100" : "text-gray-800"
            )}>{book.title}</h2>
            <div className="flex items-center gap-1.5">
              <div className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
              <p className="text-[9px] text-gray-400 truncate uppercase tracking-[0.25em] font-black opacity-60">
                Premium Edition
              </p>
            </div>
          </div>
        </div>

        {/* 阅读进度 */}
        {!loading && !error && (
          <div className="hidden lg:flex flex-col items-center gap-1.5 min-w-[240px]">
            <div className="flex items-center justify-between w-full px-1 text-[9px] font-black text-gray-400 uppercase tracking-[0.2em]">
              <span>Reading Flow</span>
              <span className="text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">{Math.round(scrollProgress)}%</span>
            </div>
            <div className={cn(
              "w-full h-1.5 rounded-full overflow-hidden shadow-inner p-[1px]",
              readingMode === 'dark' ? "bg-white/5" : "bg-gray-100/50"
            )}>
              <div 
                className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all duration-500 ease-out shadow-[0_0_12px_rgba(59,130,246,0.4)]"
                style={{ width: `${scrollProgress}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2.5">
          {/* 阅读设置按钮 */}
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSettings(!showSettings)}
              className={cn(
                "h-11 w-11 p-0 rounded-xl flex items-center justify-center transition-all duration-300 border shadow-sm backdrop-blur-md group",
                showSettings 
                  ? "bg-blue-50/80 text-blue-600 border-blue-200/50 scale-105" 
                  : (readingMode === 'dark' ? "bg-white/5 border-white/5 text-gray-300/60 hover:bg-white/10 hover:border-white/20 hover:text-gray-200" : "bg-white/60 border-gray-100/50 text-gray-400/80 hover:bg-white hover:border-gray-200 hover:text-gray-600 hover:shadow-md")
              )}
              title="阅读设置"
            >
              <Settings size={32} strokeWidth={1.5} className={cn("transition-all duration-500 group-hover:rotate-90 shrink-0", showSettings && "rotate-180")} />
            </Button>

            {/* 设置浮层 */}
            {showSettings && (
              <div className={cn(
                "absolute right-0 mt-4 w-80 rounded-3xl shadow-2xl p-6 z-50 border animate-in fade-in zoom-in duration-300 backdrop-blur-xl",
                readingMode === 'dark' ? "bg-black/90 border-white/10 text-gray-200" : "bg-white/95 border-gray-100 text-gray-800"
              )}>
                <div className="space-y-8">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.25em]">Canvas Theme</label>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <button 
                        onClick={() => setReadingMode('default')}
                        className={cn(
                          "flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all duration-300 group relative overflow-hidden",
                          readingMode === 'default' ? "border-blue-500 bg-blue-50/50 text-blue-600 ring-4 ring-blue-500/10" : "border-transparent bg-gray-50 hover:bg-gray-100"
                        )}
                      >
                        <Sun size={20} strokeWidth={1.5} className={cn("transition-transform group-hover:rotate-12", readingMode === 'default' && "text-blue-500")} />
                        <span className="text-[10px] font-black uppercase tracking-wider">Light</span>
                      </button>
                      <button 
                        onClick={() => setReadingMode('sepia')}
                        className={cn(
                          "flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all duration-300 group relative overflow-hidden",
                          readingMode === 'sepia' ? "border-orange-500 bg-orange-50/50 text-orange-700 ring-4 ring-orange-500/10" : "border-transparent bg-[#f4ecd8] hover:opacity-80"
                        )}
                      >
                        <Coffee size={20} strokeWidth={1.5} className={cn("transition-transform group-hover:rotate-12", readingMode === 'sepia' && "text-orange-600")} />
                        <span className="text-[10px] font-black uppercase tracking-wider">Sepia</span>
                      </button>
                      <button 
                        onClick={() => setReadingMode('dark')}
                        className={cn(
                          "flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all duration-300 group relative overflow-hidden",
                          readingMode === 'dark' ? "border-gray-500 bg-gray-800 text-gray-100 ring-4 ring-gray-500/10" : "border-transparent bg-gray-900 text-gray-400 hover:bg-black"
                        )}
                      >
                        <Moon size={20} strokeWidth={1.5} className={cn("transition-transform group-hover:rotate-12", readingMode === 'dark' && "text-yellow-400")} />
                        <span className="text-[10px] font-black uppercase tracking-wider">Dark</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.25em]">Typography</label>
                      <span className="text-[10px] font-black text-blue-500 bg-blue-50 px-3 py-1 rounded-full shadow-sm">{fontSize}px</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-gray-50/80 p-1.5 rounded-2xl border border-gray-100 shadow-inner">
                      <button 
                        onClick={() => setFontSize(Math.max(14, fontSize - 2))} 
                        className="flex-1 flex justify-center py-2.5 hover:bg-white hover:shadow-md rounded-xl transition-all duration-300 text-gray-400 hover:text-blue-600 group"
                      >
                        <Type size={18} strokeWidth={1.5} className="group-hover:scale-90 transition-transform" />
                      </button>
                      <div className="w-[1px] h-6 bg-gray-200/50" />
                      <button 
                        onClick={() => setFontSize(Math.min(24, fontSize + 2))} 
                        className="flex-1 flex justify-center py-2.5 hover:bg-white hover:shadow-md rounded-xl transition-all duration-300 text-gray-400 hover:text-blue-600 group"
                      >
                        <Type size={24} strokeWidth={1.5} className="group-hover:scale-110 transition-transform" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={toggleFullscreen}
            className={cn(
              "h-11 w-11 p-0 rounded-xl flex items-center justify-center transition-all duration-300 border shadow-sm backdrop-blur-md group",
              readingMode === 'dark' 
                ? "bg-white/5 border-white/5 text-gray-300/60 hover:bg-white/10 hover:border-white/20 hover:text-gray-200" 
                : "bg-white/60 border-gray-100/50 text-gray-400/80 hover:bg-white hover:border-gray-200 hover:text-gray-600 hover:shadow-md"
            )}
            title={isFullscreen ? "退出全屏" : "全屏模式"}
          >
            {isFullscreen ? (
              <Minimize2 size={32} strokeWidth={1.5} className="transition-all duration-300 group-hover:scale-110 shrink-0" />
            ) : (
              <Maximize2 size={32} strokeWidth={1.5} className="transition-all duration-300 group-hover:scale-110 shrink-0" />
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className={cn(
              "h-11 w-11 p-0 rounded-xl transition-all duration-500 shadow-sm flex items-center justify-center group backdrop-blur-md border",
              readingMode === 'dark'
                ? "bg-white/5 border-white/5 text-red-400/40 hover:bg-red-500/20 hover:border-red-500/40 hover:text-red-400"
                : "bg-white/60 border-gray-100/50 text-red-500/40 hover:bg-red-50 hover:border-red-200 hover:text-red-500"
            )}
            title="关闭阅读器"
          >
            <X size={32} strokeWidth={1.5} className="group-hover:rotate-180 transition-all duration-500 ease-in-out group-hover:scale-110 shrink-0" />
          </Button>
        </div>
      </div>

      {/* 阅读内容区域 */}
      <div className={cn(
        "flex-1 flex overflow-hidden relative rounded-b-xl shadow-inner border transition-colors duration-300",
        readingMode === 'default' && "bg-white border-gray-100",
        readingMode === 'sepia' && "bg-[#fdf6e3] border-[#eee8d5]",
        readingMode === 'dark' && "bg-[#1a1a1a] border-[#2d2d2d]"
      )}>
        {/* 左侧目录侧边栏 */}
        {showToc && !loading && !error && (
          <div className={cn(
            "w-64 md:w-80 border-r overflow-y-auto shrink-0 animate-in slide-in-from-left duration-200",
            readingMode === 'default' && "bg-gray-50/50 border-gray-100",
            readingMode === 'sepia' && "bg-[#f4ecd8]/50 border-[#eee8d5]",
            readingMode === 'dark' && "bg-[#252525] border-[#3d3d3d]"
          )}>
            <div className={cn(
              "p-4 border-b sticky top-0 z-10",
              readingMode === 'default' && "bg-white/80 border-gray-100",
              readingMode === 'sepia' && "bg-[#fdf6e3]/80 border-[#eee8d5]",
              readingMode === 'dark' && "bg-[#2d2d2d]/80 border-[#3d3d3d]"
            )}>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <FileText size={14} />
                章节目录
              </h3>
            </div>
            <div className="p-2">
              {book.tableOfContents && book.tableOfContents.length > 0 ? (
                <div className="space-y-1">
                  {book.tableOfContents.map((chapter) => (
                    <ChapterItem 
                      key={chapter.id} 
                      chapter={chapter} 
                      onSelect={scrollToChapter} 
                    />
                  ))}
                </div>
              ) : (
                <div className="p-4 text-center text-sm text-gray-400 italic">
                  未识别到有效目录
                </div>
              )}
            </div>
          </div>
        )}

        {/* 右侧阅读主区域 */}
        <div className="flex-1 overflow-hidden relative">
          {loading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <LoadingSpinner size={48} />
              <p className="mt-4 text-gray-500 font-medium animate-pulse">正在准备阅读内容...</p>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4">
                <AlertCircle size={32} className="text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-2">出错了</h3>
              <p className="text-gray-500 max-w-md">{error}</p>
              <Button variant="outline" className="mt-6" onClick={onClose}>
                返回图书馆
              </Button>
            </div>
          ) : (
            <div 
              ref={containerRef}
              onScroll={handleScroll}
              className={cn(
                "h-full overflow-y-auto px-6 py-8 md:px-16 md:py-12 scroll-smooth",
                readingMode === 'sepia' && "selection:bg-orange-200"
              )}
            >
              <article className={cn(
                "prose prose-slate max-w-4xl mx-auto transition-all duration-300",
                readingMode === 'sepia' && "prose-sepia",
                readingMode === 'dark' && "prose-invert",
                "prose-headings:scroll-mt-20"
              )} style={{ fontSize: `${fontSize}px` }}>
                {(() => {
                  // 预处理：修复 AI 可能遗漏的 $$ 包裹（特别是 \begin{array} 等环境）
                  let processedContent = content || '';
                  
                  // 识别裸露的 LaTeX 环境并包裹 $$
                  // 匹配以 \begin{...} 开头且前面没有 $$ 的块，或者直接修复常见的 array/aligned 块
                  const environments = ['array', 'aligned', 'matrix', 'cases'];
                  environments.forEach(env => {
                    const regex = new RegExp(`\\\\begin\\{${env}\\}((.|\\n)*?)\\\\end\\{${env}\\}`, 'g');
                    processedContent = processedContent.replace(regex, (match) => {
                      // 如果前后已经是 $$ 包裹，则不处理
                      return `\n$$\n${match}\n$$\n`;
                    });
                  });

                  return (
                    <Markdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={{
                        code: CodeBlock,
                        h1: ({ children }) => <h1 id={String(children)}>{children}</h1>,
                        h2: ({ children }) => <h2 id={String(children)}>{children}</h2>,
                        h3: ({ children }) => <h3 id={String(children)}>{children}</h3>,
                      }}
                    >
                      {processedContent}
                    </Markdown>
                  );
                })()}
              </article>
              
              {/* 阅读结束标识 */}
              <div className={cn(
                "max-w-4xl mx-auto mt-20 mb-10 pt-10 border-t text-center",
                readingMode === 'dark' ? "border-gray-800" : "border-gray-100"
              )}>
                <div className="inline-flex items-center gap-2 text-gray-300">
                  <FileText size={16} />
                  <span className="text-xs font-medium uppercase tracking-[0.2em]">End of Document</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(reader, document.body);
};
