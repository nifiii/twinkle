import React, { useState } from 'react';
import { BookOpen, FileText, LucideIcon, Library } from 'lucide-react';
import { UserProfile, ScannedItem, EBook } from '../types';
import LibraryHub from './LibraryHub';
import CaptureModule from './CaptureModule';

export type ResourcesSub = 'library' | 'capture';

interface ResourcesShellProps {
  currentUser: UserProfile;
  books: EBook[];
  scannedItems: ScannedItem[];
  sub: ResourcesSub;
  onSubChange: (sub: ResourcesSub) => void;
  onScanComplete: (item: ScannedItem) => void;
  onDeleteScannedItem: (id: string) => Promise<void> | void;
}

interface SubTabDef {
  id: ResourcesSub;
  label: string;
  icon: LucideIcon;
}

const SUB_TABS: SubTabDef[] = [
  { id: 'library',  label: '我的书架',   icon: BookOpen },
  { id: 'capture',  label: '错题本',     icon: FileText },
];

const ResourcesShell: React.FC<ResourcesShellProps> = ({
  currentUser,
  books,
  scannedItems,
  sub,
  onSubChange,
  onScanComplete,
  onDeleteScannedItem,
}) => {
  // LibraryHub 全屏子页（read/upload/edit）下需要让父级隐藏 TabBar
  const [libraryViewMode, setLibraryViewMode] = useState<'grid' | 'upload' | 'edit' | 'read'>('grid');
  const isLibraryFullScreen = sub === 'library' && libraryViewMode !== 'grid';

  // 错题本：内部锁定的 sub-tab（错题/归档），父级管理
  const [captureLockedTab, setCaptureLockedTab] = useState<'wrong_problems' | 'archived_docs'>('wrong_problems');

  const showHeaderArea = !isLibraryFullScreen;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* 欢迎条（与「智慧课堂」同款样式）+ 横向 TabBar（全屏子页下隐藏） */}
      {showHeaderArea && (
        <div className="flex flex-col gap-4">
          <div className="bg-cyber-surface/60 backdrop-blur-md rounded-2xl border border-cyber-border/60 p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-neon-blue/15 rounded-xl flex items-center justify-center shadow-glow-sm">
                <Library className="w-6 h-6 text-neon-blue" />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight bg-gradient-to-r from-neon-blue via-cyber-text to-neon-purple bg-clip-text text-transparent">
                  {currentUser.name} 的学习资料
                </h2>
                <div className="text-sm text-cyber-muted space-y-0.5">
                  <p>
                    <span className="text-neon-blue font-medium">我的书架</span> 上传并放置PDF教材
                  </p>
                  <p>
                    <span className="text-neon-amber font-medium">错题本</span> 上传试卷 / 作业图片，自动识别错题归档文件
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 横向 TabBar */}
          <div
            role="tablist"
            aria-label="学习资料子分类"
            className="flex items-center gap-1 p-1 bg-cyber-surface/50 backdrop-blur-md rounded-2xl border border-cyber-border/60 w-fit"
          >
            {SUB_TABS.map(t => {
              const Icon = t.icon;
              const active = sub === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSubChange(t.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300
                    ${active
                      ? 'bg-gradient-to-r from-neon-blue/25 to-neon-purple/20 text-neon-blue border border-neon-blue/40 shadow-glow-sm'
                      : 'text-cyber-muted hover:text-cyber-text hover:bg-white/5 border border-transparent'
                    }`}
                >
                  <Icon size={16} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 子页内容 */}
      {sub === 'library' && (
        <LibraryHub
          currentUserId={currentUser.id}
          hideHeader
          onViewModeChange={setLibraryViewMode}
        />
      )}
      {sub === 'capture' && (
        <CaptureModule
          currentUser={currentUser}
          scannedItems={scannedItems}
          onScanComplete={onScanComplete}
          onDeleteItem={onDeleteScannedItem as (id: string) => void}
          hideHeader
          lockedSubTab={captureLockedTab}
          onLockedSubTabChange={setCaptureLockedTab}
        />
      )}
    </div>
  );
};

export default ResourcesShell;
