import React from 'react';
import { UserProfile } from '../types';
import { Home, Library, GraduationCap, LucideIcon, Sparkles } from 'lucide-react';
import UserSwitcher from './UserSwitcher';
import FloatingDots from './FloatingDots';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  onTabChange: (tab: string) => void;
  currentUser: UserProfile;
  availableUsers: UserProfile[];
  onSwitchUser: (userId: string) => void;
  onEditProfile: (user: UserProfile) => void;
  onCreateUser: (payload: { name: string; avatar?: string; birthDate?: string; baseGrade?: number }) => Promise<UserProfile>;
  onDeleteUser: (id: string) => void;
  onOpenLiveTutor: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: '我的看板', icon: Home, color: '#4A90E2' },
  { id: 'resources', label: '学习资料', icon: Library, color: '#A78BFA' },
  { id: 'tutor', label: '智慧课堂', icon: GraduationCap, color: '#FB7185' },
];

// 移动端：3 项均分
const mobileNavItems = navItems;

const Layout: React.FC<LayoutProps> = ({
  children,
  activeTab,
  onTabChange,
  currentUser,
  availableUsers,
  onSwitchUser,
  onEditProfile,
  onCreateUser,
  onDeleteUser,
  onOpenLiveTutor
}) => {
  return (
    <div className="h-screen w-screen bg-cyber-gradient flex flex-col overflow-hidden relative">
      <FloatingDots />
      {/* 顶部导航栏（所有设备） */}
      <header className="fixed top-0 w-full h-16 backdrop-blur-xl bg-cyber-surface/60 border-b border-cyber-border/60 z-50 shadow-glow-sm">
        <div className="h-full px-4 md:px-6 flex items-center justify-between max-w-7xl mx-auto">
          {/* 左侧：Logo */}
          <button
            type="button"
            className="flex items-center gap-3 cursor-pointer group"
            onClick={onOpenLiveTutor}
            aria-label="打开 AI 导师"
            title="AI 导师"
          >
            <div className="w-9 h-9 bg-gradient-to-br from-neon-blue via-sky-500 to-neon-purple rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-glow-sm group-hover:shadow-glow transition-shadow duration-300">
              <Sparkles size={20} className="text-white" />
            </div>
            <span className="text-lg font-semibold bg-gradient-to-r from-neon-blue to-neon-purple bg-clip-text text-transparent hidden sm:block">闪闪</span>
          </button>

          {/* 中间：页面标题（仅移动端） */}
          <h1 className="md:hidden font-medium text-cyber-text">
            {activeTab === 'dashboard'
              ? `${currentUser.name} 的看板`
              : activeTab === 'resources'
              ? `${currentUser.name} 的学习资料`
              : activeTab === 'tutor'
              ? `${currentUser.name} 的智慧课堂`
              : '闪闪'}
          </h1>

          {/* 右侧：用户切换 */}
          <div className="flex items-center gap-3">
            <UserSwitcher
              currentUser={currentUser}
              availableUsers={availableUsers}
              onUserSwitch={onSwitchUser}
              onEditProfile={onEditProfile}
              onCreateUser={onCreateUser}
              onDeleteUser={onDeleteUser}
            />
          </div>
        </div>
      </header>

      {/* 侧边栏导航（桌面端） */}
      <nav className="hidden md:block fixed left-0 top-16 w-70 h-[calc(100vh-4rem)] bg-cyber-surface/40 backdrop-blur-lg border-r border-cyber-border/60 overflow-y-auto z-40">
        <div className="p-4 space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`w-full flex items-center gap-4 px-4 py-3 rounded-2xl transition-all duration-300
                  ${isActive
                    ? 'bg-gradient-to-r from-neon-blue/15 to-neon-purple/10 font-medium text-neon-blue border border-neon-blue/40 shadow-glow-sm'
                    : 'text-cyber-muted hover:text-cyber-text hover:bg-white/5 border border-transparent'
                  }`}
              >
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${isActive ? 'shadow-glow-sm' : ''}`}
                  style={{
                    backgroundColor: isActive ? item.color + '30' : item.color + '15',
                    color: item.color
                  }}
                >
                  <Icon size={20} />
                </div>
                <span className="text-sm">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* 底部导航栏（移动端） */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-18 bg-cyber-surface/70 backdrop-blur-xl border-t border-cyber-border/60 z-50 safe-area-bottom">
        <div className="flex justify-around items-center h-full px-2">
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-0 flex-1 relative"
              >
                <Icon
                  size={26}
                  className={`transition-all duration-300 ${
                    isActive ? 'scale-110' : 'scale-100'
                  }`}
                  style={{
                    color: isActive ? '#15803D' : '#5C6655',
                    filter: isActive ? 'drop-shadow(0 0 8px rgba(21,128,61,0.35))' : undefined,
                  }}
                />
                <span
                  className={`text-[11px] transition-all duration-200 truncate max-w-full ${
                    isActive ? 'font-semibold' : 'font-normal'
                  }`}
                  style={{ color: isActive ? '#15803D' : '#5C6655' }}
                >
                  {item.label}
                </span>
                {isActive && (
                  <div className="absolute -top-0.5 w-6 h-0.5 rounded-full bg-neon-blue shadow-glow-sm" />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* 主内容区 */}
      <main className="pt-16 pb-20 md:pb-8 md:pl-70 min-h-screen overflow-y-auto relative z-10">
        <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-6 md:py-8">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
