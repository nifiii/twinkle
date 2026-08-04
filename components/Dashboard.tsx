import React, { useEffect, useMemo, useState } from 'react';
import { UserProfile } from '../types';
import { Card, CardHeader } from './ui';
import {
  BookOpen, AlertCircle, FileText,
  ChevronRight, Loader2, Library
} from 'lucide-react';

interface DashboardProps {
  currentUser: UserProfile;
  // 第二参数 subPath 用于深链跳转（如 tutor + 'courseware/<id>'）
  onTabChange: (tab: string, subPath?: string) => void;
}

interface PendingCourseware {
  id: string;
  bookTitle: string;
  chapter: string;
  subject: string;
  slideCount: number | null;
  createdAt: number;
}

interface PendingWrongProblem {
  scannedItemId: string;
  problemIndex: number;
  snippet: string;
  subject: string;
  timestamp: number;
}

interface PendingQuiz {
  id: string;
  bookTitle: string;
  chapter: string;
  subject: string;
  questionCount: number | null;
  source: string | null;
  createdAt: number;
}

interface OverviewData {
  stats: {
    pendingCoursewareCount: number;
    pendingWrongProblemCount: number;
    pendingQuizCount: number;
  };
  pendingCourseware: PendingCourseware[];
  pendingWrongProblems: PendingWrongProblem[];
  pendingQuizzes: PendingQuiz[];
}

const formatDate = (ts: number): string =>
  new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });

const Dashboard: React.FC<DashboardProps> = ({ currentUser, onTabChange }) => {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/dashboard/overview?ownerId=${encodeURIComponent(currentUser.id)}`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return;
        if (json.success) setData(json.data);
        else setError(json.error || '加载失败');
      })
      .catch(err => {
        if (!cancelled) setError(err.message || '网络错误');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [currentUser.id]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? '早安' : h < 18 ? '下午好' : '晚上好';
  }, []);

  // 每日寄语：按"年内第几天"取模选取，确保同一天稳定一致、跨天自动轮换
  // Why: 青少年用户每日打开 App 看到不同的鼓励，提升仪式感
  const dailyQuote = useMemo(() => {
    const QUOTES = [
      '不负春光，野蛮生长。',
      '愿你眼里有光，心中有梦。',
      '少年不惧岁月长，敢叫日月换新天。',
      '今日的努力，是明日的底气。',
      '种一棵树最好的时间是十年前，其次是现在。',
      '知识是通往世界的护照。',
      '小步慢走，也能抵达远方。',
      '万物皆可期待，包括更好的你。',
      '把每一道题，都当作一次小小的探险。',
      '心中有热爱，眼里有星辰。',
      '今天比昨天多懂一点点，就是了不起。',
      '专注当下这一题，世界会为你让路。',
      '比聪明更重要的，是不放弃。',
      '风会记得每一朵花的香。',
      '所谓天才，不过是把别人喝咖啡的时间用在了笔记上。',
      '每一次提问，都是离答案更近一步。',
      '像海绵一样吸收，像树一样生长。',
      '勇敢做错，才能学会做对。',
      '今天的小坚持，是未来的大底气。',
      '把好奇心当作翅膀。',
      '认真听讲的样子，最帅。',
      '复习一遍，比新学一遍更牢靠。',
      '走得慢没关系，别走错方向就好。',
      '每个聪明的脑袋，都被笔头磨亮过。',
      '与其担心未来，不如专注当下这一页。',
      '少年自有少年狂，心如骄阳万丈光。',
      '题不会做，就一行一行慢慢来。',
      '梦想的种子，要用每天的努力去浇灌。',
      '在别人放弃的地方再多坚持一下。',
      '世界很大，从这一页书开始。',
      '微光也能汇成星海。',
    ];
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86400000);
    return QUOTES[dayOfYear % QUOTES.length];
  }, []);

  return (
    <div className="space-y-6">
      {/* 欢迎条 */}
      <section className="relative rounded-3xl p-8 overflow-hidden bg-gradient-to-br from-cyber-surface/80 via-cyber-bg2/60 to-cyber-surface/80 border border-neon-blue/40 shadow-glow-sm text-cyber-text">
        <div className="absolute inset-0 opacity-30 pointer-events-none">
          <div className="absolute top-4 right-8 w-40 h-40 rounded-full bg-neon-blue/40 blur-3xl animate-float" />
          <div className="absolute bottom-2 right-40 w-24 h-24 rounded-full bg-neon-purple/40 blur-2xl animate-float" style={{ animationDelay: '1.2s' }} />
          <div className="absolute top-8 left-20 w-16 h-16 rounded-full bg-neon-amber/40 blur-2xl animate-float" style={{ animationDelay: '0.6s' }} />
        </div>
        <div className="relative z-10">
          <p className="text-cyber-text/90 text-base font-medium mb-1.5">{greeting}，{currentUser.name}！</p>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-neon-blue via-cyber-text to-neon-purple bg-clip-text text-transparent">
            {dailyQuote}
          </h1>
        </div>
      </section>

      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          <span>加载学情概览…</span>
        </div>
      )}

      {error && !loading && (
        <Card className="border border-red-200 bg-red-50/60">
          <div className="text-sm text-red-600">概览加载失败：{error}</div>
        </Card>
      )}

      {!loading && !error && data && (
        <>
          <StatCards stats={data.stats} onJump={onTabChange} />

          <PendingCoursewareList items={data.pendingCourseware} onTabChange={onTabChange} />

          <PendingWrongList items={data.pendingWrongProblems} onTabChange={onTabChange} />

          <PendingQuizList items={data.pendingQuizzes} onTabChange={onTabChange} />

          {data.stats.pendingCoursewareCount === 0 &&
            data.stats.pendingWrongProblemCount === 0 &&
            data.stats.pendingQuizCount === 0 && (
              <EmptyState onTabChange={onTabChange} />
            )}
        </>
      )}
    </div>
  );
};

// =============== 子组件 ===============

const StatCards: React.FC<{
  stats: OverviewData['stats'];
  onJump: (tab: string, subPath?: string) => void;
}> = ({ stats, onJump }) => {
  const { pendingCoursewareCount, pendingWrongProblemCount, pendingQuizCount } = stats;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      <Card hover className="p-5" onClick={() => onJump('tutor')}>
        <div className="w-11 h-11 rounded-xl mb-3 flex items-center justify-center bg-neon-blue/15 shadow-glow-sm">
          <BookOpen className="w-5 h-5 text-neon-blue" />
        </div>
        <div className="text-3xl font-bold mb-0.5 tracking-tight text-cyber-text">{pendingCoursewareCount}</div>
        <div className="text-xs text-cyber-muted">待学课件</div>
      </Card>

      <Card hover className="p-5" onClick={() => onJump('assistant', 'wrong')}>
        <div className="w-11 h-11 rounded-xl mb-3 flex items-center justify-center bg-rose-400/15">
          <AlertCircle className="w-5 h-5 text-rose-400" />
        </div>
        <div className="text-3xl font-bold mb-0.5 tracking-tight text-cyber-text">{pendingWrongProblemCount}</div>
        <div className="text-xs text-cyber-muted">待订正错题</div>
      </Card>

      <Card hover className="p-5" onClick={() => onJump('tutor')}>
        <div className="w-11 h-11 rounded-xl mb-3 flex items-center justify-center bg-neon-amber/15 shadow-glow-amber">
          <FileText className="w-5 h-5 text-neon-amber" />
        </div>
        <div className="text-3xl font-bold mb-0.5 tracking-tight text-cyber-text">{pendingQuizCount}</div>
        <div className="text-xs text-cyber-muted">待完成测验</div>
      </Card>

    </div>
  );
};

const ListRow: React.FC<{
  primary: string;
  secondary: string;
  badge?: string;
  badgeColor?: string;
  onClick: () => void;
}> = ({ primary, secondary, badge, badgeColor = 'bg-gray-100 text-gray-600', onClick }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 hover:border-neon-blue/30 border border-transparent transition-colors text-left group"
  >
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-0.5">
        {badge && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${badgeColor}`}>{badge}</span>
        )}
        <div className="text-sm font-medium text-cyber-text truncate">{primary}</div>
      </div>
      <div className="text-xs text-cyber-muted truncate">{secondary}</div>
    </div>
    <ChevronRight className="w-4 h-4 text-cyber-muted group-hover:text-neon-blue flex-shrink-0" />
  </button>
);

const PendingCoursewareList: React.FC<{
  items: PendingCourseware[];
  onTabChange: (tab: string, subPath?: string) => void;
}> = ({ items, onTabChange }) => (
  <Card>
    <CardHeader
      title="待学习课件"
      icon={<BookOpen size={20} />}
      iconBg="bg-neon-blue/15"
      iconColor="text-neon-blue"
    />
    {items.length === 0 ? (
      <div className="text-center py-8 text-cyber-muted text-sm">暂无待学课件</div>
    ) : (
      <div className="space-y-1">
        {items.map(it => (
          <ListRow
            key={it.id}
            badge={it.subject}
            badgeColor="bg-neon-blue/15 text-neon-blue border border-neon-blue/30"
            primary={`${it.bookTitle}·${it.chapter}`}
            secondary={`${it.slideCount || '?'} 节 · 创建于 ${formatDate(it.createdAt)}`}
            onClick={() => onTabChange('tutor')}
          />
        ))}
      </div>
    )}
  </Card>
);

const PendingWrongList: React.FC<{
  items: PendingWrongProblem[];
  onTabChange: (tab: string, subPath?: string) => void;
}> = ({ items, onTabChange }) => (
  <Card>
    <CardHeader
      title="待订正错题"
      icon={<AlertCircle size={20} />}
      iconBg="bg-rose-400/15"
      iconColor="text-rose-400"
    />
    {items.length === 0 ? (
      <div className="text-center py-8 text-cyber-muted text-sm">暂无待订正错题</div>
    ) : (
      <div className="space-y-1">
        {items.map(it => (
          <ListRow
            key={`${it.scannedItemId}:${it.problemIndex}`}
            badge={it.subject}
            badgeColor="bg-rose-400/15 text-rose-300 border border-rose-400/30"
            primary={it.snippet || '（题干为空）'}
            secondary={`录入于 ${formatDate(it.timestamp)}`}
            onClick={() => onTabChange('assistant', 'wrong')}
          />
        ))}
      </div>
    )}
  </Card>
);

const PendingQuizList: React.FC<{
  items: PendingQuiz[];
  onTabChange: (tab: string, subPath?: string) => void;
}> = ({ items, onTabChange }) => (
  <Card>
    <CardHeader
      title="待完成测验"
      icon={<FileText size={20} />}
      iconBg="bg-neon-amber/15"
      iconColor="text-neon-amber"
    />
    {items.length === 0 ? (
      <div className="text-center py-8 text-cyber-muted text-sm">暂无待完成测验</div>
    ) : (
      <div className="space-y-1">
        {items.map(it => {
          const isWrong = it.source === 'wrong_problem';
          return (
            <ListRow
              key={it.id}
              badge={it.subject}
              badgeColor={isWrong ? 'bg-neon-amber/20 text-neon-amber border border-neon-amber/40' : 'bg-neon-amber/15 text-neon-amber border border-neon-amber/30'}
              primary={`${isWrong ? '错题测验·' : ''}${it.bookTitle}·${it.chapter}`}
              secondary={`${it.questionCount || '?'} 题 · 创建于 ${formatDate(it.createdAt)}`}
              onClick={() => onTabChange('tutor')}
            />
          );
        })}
      </div>
    )}
  </Card>
);

const EmptyState: React.FC<{
  onTabChange: (tab: string, subPath?: string) => void;
}> = ({ onTabChange }) => (
  <Card>
    <div className="flex flex-col items-center py-10">
      <Library className="w-12 h-12 text-gray-300 mb-3" />
      <div className="text-base font-medium text-gray-700 mb-1">还没有任何学习数据</div>
      <div className="text-sm text-gray-500 mb-4">从上传第一本教材开始</div>
      <button
        onClick={() => onTabChange('resources', 'library')}
        className="px-5 py-2 rounded-full bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors"
      >
        去书架上传教材
      </button>
    </div>
  </Card>
);

export default Dashboard;
