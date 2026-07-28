import React, { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, FileText, Headphones, PencilLine } from 'lucide-react';
import { EBook, UserProfile } from '../types';

type LearningAction = 'listening' | 'practice' | 'assessment';

interface LearningHubProps {
  books: EBook[];
  currentUser: UserProfile;
  onActionSelected: (action: LearningAction, book: EBook, chapterId: string) => void;
}

const actions: Array<{ id: LearningAction; label: string; hint: string; icon: typeof Headphones; color: string }> = [
  { id: 'listening', label: '英语听力', hint: '约 10 分钟', icon: Headphones, color: 'text-cyan-700 bg-cyan-50 border-cyan-200' },
  { id: 'practice', label: '思维练习', hint: '约 15 分钟', icon: PencilLine, color: 'text-indigo-700 bg-indigo-50 border-indigo-200' },
  { id: 'assessment', label: '开始测试', hint: '约 30 分钟', icon: FileText, color: 'text-rose-700 bg-rose-50 border-rose-200' },
];

function actionsForSubject(subject: string): LearningAction[] {
  const normalized = subject.trim().toLocaleLowerCase();
  if (normalized === '英语' || normalized === 'english') return ['listening', 'assessment'];
  if (normalized === '数学' || ['math', 'maths', 'mathematics'].includes(normalized)) return ['practice', 'assessment'];
  if (normalized === '科学' || normalized === 'science') return ['assessment'];
  return ['assessment'];
}

function chaptersFor(book: EBook | undefined) {
  if (!book) return [];
  const chapters: Array<{ id: string; title: string }> = [];
  const visit = (nodes: EBook['tableOfContents']) => {
    for (const node of nodes || []) {
      // Catalog IDs are persisted data and older imports can contain numbers.
      // Normalize only this UI-to-request boundary so all selection state stays string-based.
      const id = typeof node.id === 'string' || typeof node.id === 'number' ? String(node.id).trim() : '';
      if (id && node.title?.trim()) chapters.push({ id, title: node.title.trim() });
      if (node.children?.length) visit(node.children);
    }
  };
  visit(book.tableOfContents);
  return chapters;
}

export const LearningHub: React.FC<LearningHubProps> = ({ books, currentUser, onActionSelected }) => {
  const eligibleBooks = useMemo(
    () => books.filter(book => Boolean(book.subject?.trim() && book.grade?.trim() && book.tableOfContents?.length)),
    [books],
  );
  const [bookId, setBookId] = useState('');
  const selectedBook = eligibleBooks.find(book => book.id === bookId);
  const chapters = useMemo(() => chaptersFor(selectedBook), [selectedBook]);
  const availableActions = useMemo(
    () => actions.filter(action => selectedBook && actionsForSubject(selectedBook.subject).includes(action.id)),
    [selectedBook],
  );
  const [chapterId, setChapterId] = useState('');

  useEffect(() => {
    setBookId(current => eligibleBooks.some(book => book.id === current) ? current : eligibleBooks[0]?.id || '');
  }, [eligibleBooks]);

  useEffect(() => {
    setChapterId(current => chapters.some(chapter => chapter.id === current) ? current : chapters[0]?.id || '');
  }, [chapters]);

  const missingMetadata = books.filter(book => !eligibleBooks.includes(book));
  const chapterReady = Boolean(selectedBook && chapterId);

  return (
    <section className="mx-auto max-w-6xl text-slate-800">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">{currentUser.name} 的学习中心</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">从教材开始</h1>
        </div>
        <BookOpenCheck aria-hidden="true" className="mt-1 text-emerald-700" size={28} />
      </header>

      {eligibleBooks.length === 0 ? (
        <div className="border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950" role="status">
          暂无可用于学习的教材。请先补全年级、学科和章节目录。
        </div>
      ) : (
        <>
          <div className="grid gap-4 border-y border-slate-200 py-5 md:grid-cols-2">
            <label className="grid min-w-0 gap-2 text-sm font-medium">
              教材
              <select value={bookId} onChange={event => setBookId(event.target.value)} className="min-h-11 w-full border border-slate-300 bg-white px-3 text-base outline-none focus:ring-2 focus:ring-emerald-700">
                {eligibleBooks.map(book => <option key={book.id} value={book.id}>{book.title}</option>)}
              </select>
            </label>
            <label className="grid min-w-0 gap-2 text-sm font-medium">
              章节
              <select value={chapterId} onChange={event => setChapterId(event.target.value)} className="min-h-11 w-full border border-slate-300 bg-white px-3 text-base outline-none focus:ring-2 focus:ring-emerald-700">
                {chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
              </select>
            </label>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {availableActions.map(action => {
              const Icon = action.icon;
              return (
                <button key={action.id} type="button" disabled={!chapterReady} onClick={() => selectedBook && onActionSelected(action.id, selectedBook, chapterId)} className={`min-h-36 border p-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-700 disabled:cursor-not-allowed disabled:opacity-45 ${action.color}`}>
                  <Icon aria-hidden="true" size={24} />
                  <span className="mt-5 block text-base font-semibold">{action.label}</span>
                  <span className="mt-1 block text-sm opacity-80">{action.hint}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {missingMetadata.length > 0 && (
        <p className="mt-5 text-sm text-amber-800" role="status">{missingMetadata.length} 册教材尚未补全信息，暂不能生成学习内容。</p>
      )}
    </section>
  );
};

export default LearningHub;
