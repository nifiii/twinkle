
import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import ResourcesShell, { ResourcesSub } from './components/ResourcesShell';
import { AIClassroom } from './components/AIClassroom';
import ProfilePage from './components/ProfilePage';
import LearningAssistant from './components/LearningAssistant';
import { ScannedItem, UserProfile, EBook, KnowledgeStatus, ProcessingStatus } from './types';
import { fetchBooks, fetchScannedItems, deleteScannedItem } from './services/apiService';
import { fetchUsers, updateUser, createUser, deleteUser } from './services/userService';

const FALLBACK_PROFILE: UserProfile = {
  id: 'child_1', name: '大宝', avatar: '👦', grade: '小学一年级',
};

const LAST_USED_USER_KEY = 'lastUsedUserId';

// LocalStorage 辅助函数（带错误处理）
const saveLastUsedUser = (userId: string) => {
  try {
    localStorage.setItem(LAST_USED_USER_KEY, userId);
  } catch (error) {
    console.warn('无法保存用户选择到 localStorage:', error);
  }
};

const getLastUsedUser = (): string | null => {
  try {
    return localStorage.getItem(LAST_USED_USER_KEY);
  } catch (error) {
    console.warn('无法从 localStorage 读取用户选择:', error);
    return null;
  }
};

const SUBJECT_MAP: Record<string, string> = {
  'Math': '数学',
  'Mathematics': '数学',
  'Chinese': '语文',
  'English': '英语',
  'Science': '科学',
  'Physics': '物理',
  'Chemistry': '化学',
  'Biology': '生物',
  'History': '历史',
  'Geography': '地理',
  'Politics': '政治',
  'Art': '美术',
  'Music': '音乐',
  'PE': '体育',
  'Physical Education': '体育',
};

const normalizeSubject = (subject: string): string => {
  if (!subject) return '综合';
  const trimmed = subject.trim();
  return SUBJECT_MAP[trimmed] || trimmed;
};

const VALID_TABS = new Set(['dashboard', 'resources', 'assistant', 'tutor']);
const VALID_RESOURCES_SUBS = new Set(['library', 'capture']);

// Hash 协议：
//   #dashboard
//   #resources/<library|capture>   ← 资源页子 Tab
//   #tutor/<courseware|wrong|quiz|history>/<...>   ← AI 课堂深链
const parseHash = (): { tab: string; resourcesSub: string; tutorSubPath: string } => {
  const raw = window.location.hash.slice(1);
  const [first, ...rest] = raw.split('/');
  const tab = first === 'learn' ? 'decommissioned' : (VALID_TABS.has(first) ? first : 'dashboard');
  let resourcesSub = '';
  let tutorSubPath = '';
  if (tab === 'resources') {
    const sub = rest[0] || 'library';
    resourcesSub = VALID_RESOURCES_SUBS.has(sub) ? sub : 'library';
  } else if (tab === 'tutor') {
    tutorSubPath = rest.join('/');
  }
  return { tab, resourcesSub, tutorSubPath };
};

const getTabFromHash = (): string => parseHash().tab;

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState(getTabFromHash);
  const [tutorSubPath, setTutorSubPath] = useState<string>(() => parseHash().tutorSubPath);
  const [resourcesSub, setResourcesSub] = useState<string>(() => parseHash().resourcesSub || 'library');
  const [profiles, setProfiles] = useState<UserProfile[]>([FALLBACK_PROFILE]);
  const [currentUser, setCurrentUser] = useState<UserProfile>(FALLBACK_PROFILE);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [books, setBooks] = useState<EBook[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [switchToast, setSwitchToast] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<UserProfile | null>(null);

  // 第二参数 subPath 用于直接深链到 Tab 内部
  // - tab='tutor': subPath = 'courseware/<id>' / 'wrong/<id>' / 'quiz/<id>' / 'history'
  // - tab='resources': subPath = 'library' / 'capture'
  const handleTabChange = (tab: string, subPath?: string) => {
    setActiveTab(tab);
    if (tab === 'tutor' && subPath) {
      setTutorSubPath(subPath);
      setResourcesSub('library');
      window.history.pushState(null, '', `#${tab}/${subPath}`);
    } else if (tab === 'resources') {
      const sub = (subPath && VALID_RESOURCES_SUBS.has(subPath)) ? subPath : 'library';
      setResourcesSub(sub);
      setTutorSubPath('');
      window.history.pushState(null, '', `#${tab}/${sub}`);
    } else {
      setTutorSubPath('');
      setResourcesSub('library');
      window.history.pushState(null, '', `#${tab}`);
    }
  };

  // 浏览器前进/后退按钮 + hashchange → 同步 activeTab + subPath
  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, '', '#dashboard');
    }

    const onHashSync = () => {
      const { tab, resourcesSub: rs, tutorSubPath: ts } = parseHash();
      setActiveTab(tab);
      setTutorSubPath(ts);
      setResourcesSub(rs || 'library');
    };
    window.addEventListener('popstate', onHashSync);
    window.addEventListener('hashchange', onHashSync);
    return () => {
      window.removeEventListener('popstate', onHashSync);
      window.removeEventListener('hashchange', onHashSync);
    };
  }, []);

  // 启动加载用户列表（替代 localStorage）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchUsers();
        if (cancelled || list.length === 0) return;
        setProfiles(list);
        const lastId = getLastUsedUser();
        const initial = (lastId && list.find(u => u.id === lastId)) || list[0];
        setCurrentUser(initial);
      } catch (e: any) {
        console.error('加载用户失败:', e);
        setErrorMsg('从服务器加载用户失败，使用默认账户');
      } finally {
        if (!cancelled) setProfilesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 自动清除切换提示 Toast
  useEffect(() => {
    if (switchToast) {
      const timer = setTimeout(() => setSwitchToast(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [switchToast]);

  // 加载图书数据（从服务器）
  useEffect(() => {
    const loadBooks = async () => {
      try {
        const allBooks = await fetchBooks({ ownerId: currentUser.id });
        setBooks(allBooks);
      } catch (error) {
        console.error('加载图书失败:', error);
        setErrorMsg('从服务器加载图书失败，请检查网络连接');
      }
    };
    loadBooks();
  }, [currentUser.id]);

  // 加载扫描项数据（从服务器）
  useEffect(() => {
    const loadScannedItems = async () => {
      try {
        const items = await fetchScannedItems({ ownerId: currentUser.id });
        // 转换为 ScannedItem 格式
        const scannedItemData: ScannedItem[] = items.map((item: any) => ({
          id: item.id,
          ownerId: item.ownerId,
          userName: item.userName,
          timestamp: item.timestamp,
          imageUrl: item.imagePath,
          rawMarkdown: item.markdown || '',
          meta: {
            type: item.meta.type as any,
            subject: normalizeSubject(item.meta.subject),
            chapter_hint: item.meta.chapter_hint,
            knowledge_status: KnowledgeStatus.UNMASTERED,
            problems: item.problemsJson ? JSON.parse(item.problemsJson) : [],
          },
          status: ProcessingStatus.PROCESSED,
        }));
        setScannedItems(scannedItemData);
      } catch (error) {
        console.error('加载扫描项失败:', error);
        // 不显示错误提示，静默失败
      }
    };
    loadScannedItems();
  }, [currentUser.id]);

  // 切换标签页时刷新数据（确保数据同步）
  useEffect(() => {
    const refreshDataOnTabSwitch = async () => {
      // 书架页依赖最新教材列表，切换时刷新以避免显示已删除或未完成的资料。
      if (activeTab === 'resources') {
        try {
          const allBooks = await fetchBooks({ ownerId: currentUser.id });
          setBooks(allBooks);
        } catch (error) {
          console.error('重新加载图书失败:', error);
        }
      }
    };
    refreshDataOnTabSwitch();
  }, [activeTab, currentUser.id]);

  // 自动清除错误消息
  useEffect(() => {
    if (errorMsg) {
      const timer = setTimeout(() => setErrorMsg(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [errorMsg]);

  const filteredItems = useMemo(() => {
    return scannedItems.filter(item =>
      item.ownerId === currentUser.id || item.ownerId === 'shared'
    );
  }, [scannedItems, currentUser.id]);

  const filteredBooks = useMemo(() => {
    return books.filter(book =>
      book.ownerId === currentUser.id || book.ownerId === 'shared'
    );
  }, [books, currentUser.id]);

  const handleScanComplete = (item: ScannedItem) => {
    const normalizedItem = {
      ...item,
      meta: {
        ...item.meta,
        subject: normalizeSubject(item.meta.subject)
      }
    };
    setScannedItems(prev => [normalizedItem, ...prev]);
  };

  const handleDeleteScannedItem = async (id: string) => {
    try {
      await deleteScannedItem(id);
      setScannedItems(prev => prev.filter(item => item.id !== id));
      setSwitchToast('✅ 资料已成功删除');
    } catch (error: any) {
      console.error('删除失败:', error);
      setErrorMsg(`删除失败: ${error.message || '未知错误'}`);
    }
  };

  const handleUserSwitch = (userId: string) => {
    const user = profiles.find(u => u.id === userId);
    if (user) {
      setCurrentUser(user);
      saveLastUsedUser(userId);
      setSwitchToast(`✅ 已切换到${user.name}的视图`);
    }
  };

  // 更新用户资料（姓名、出生年月、baseGrade）→ 服务端持久化
  const handleUpdateProfile = async (updated: UserProfile) => {
    try {
      const saved = await updateUser(updated.id, {
        name: updated.name,
        avatar: updated.avatar,
        birthDate: updated.birthDate,
        baseGrade: updated.baseGrade,
      });
      setProfiles(prev => prev.map(p => p.id === saved.id ? saved : p));
      if (currentUser.id === saved.id) setCurrentUser(saved);
      setSwitchToast('✅ 个人资料已保存');
    } catch (e: any) {
      console.error('保存个人资料失败:', e);
      setErrorMsg(`保存失败: ${e.message || '未知错误'}`);
    }
  };

  // 新增用户
  const handleCreateUser = async (payload: { name: string; avatar?: string; birthDate?: string; baseGrade?: number }) => {
    try {
      const created = await createUser(payload);
      setProfiles(prev => [...prev, created]);
      setSwitchToast(`✅ 已添加用户 ${created.name}`);
      return created;
    } catch (e: any) {
      console.error('添加用户失败:', e);
      setErrorMsg(`添加失败: ${e.message || '未知错误'}`);
      throw e;
    }
  };

  // 删除用户
  const handleDeleteUser = async (id: string) => {
    if (id === currentUser.id) {
      setErrorMsg('无法删除当前正在使用的用户，请先切换到其他用户');
      return;
    }
    try {
      await deleteUser(id);
      setProfiles(prev => prev.filter(p => p.id !== id));
      setSwitchToast('✅ 用户已删除');
    } catch (e: any) {
      console.error('删除用户失败:', e);
      setErrorMsg(`删除失败: ${e.message || '未知错误'}`);
    }
  };

  // 全局错误提示 UI
  const ErrorToast = () => errorMsg ? (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-red-600 text-white px-6 py-3 rounded-2xl shadow-2xl animate-slide-up flex items-center space-x-3 border-2 border-red-400">
      <i className="fa-solid fa-triangle-exclamation"></i>
      <span className="font-bold text-sm">{errorMsg}</span>
      <button onClick={() => setErrorMsg(null)} className="ml-2 opacity-70 hover:opacity-100">
        <i className="fa-solid fa-xmark"></i>
      </button>
    </div>
  ) : null;

  // 用户切换提示 Toast
  const SwitchToast = () => switchToast ? (
    <motion.div
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed top-5 left-1/2 -translate-x-1/2 z-[100] bg-gradient-to-r from-sky-400 to-mint-400 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-2"
    >
      <span className="text-sm font-bold">{switchToast}</span>
    </motion.div>
  ) : null;

  // 页面切换动画配置
  const pageVariants = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 }
  };

  const pageTransition = {
    type: 'tween',
    ease: 'easeInOut',
    duration: 0.3
  };

  const renderContent = () => {
    try {
      switch (activeTab) {
        case 'dashboard':
          return <Dashboard currentUser={currentUser} onTabChange={handleTabChange} />;
        case 'resources':
          return (
            <ResourcesShell
              currentUser={currentUser}
              books={filteredBooks}
              scannedItems={filteredItems}
              sub={resourcesSub as ResourcesSub}
              onSubChange={(s) => handleTabChange('resources', s)}
              onScanComplete={handleScanComplete}
              onDeleteScannedItem={handleDeleteScannedItem}
            />
          );
        case 'tutor':
          return <AIClassroom currentUser={currentUser} subPath={tutorSubPath} />;
        case 'assistant':
          return <LearningAssistant currentUser={currentUser} onOpenClassroom={() => handleTabChange('tutor')} />;
        case 'decommissioned':
          return <section aria-labelledby="decommissioned-title" className="mx-auto max-w-3xl py-16 text-center"><h1 id="decommissioned-title" className="text-2xl font-semibold text-cyber-text">页面已下线</h1><div className="mt-8 flex flex-wrap justify-center gap-3"><button type="button" onClick={() => handleTabChange('assistant')} className="min-h-11 border border-neon-blue/50 px-4 text-sm font-medium text-neon-blue focus:outline-none focus:ring-2 focus:ring-neon-blue">学习小助手</button><button type="button" onClick={() => handleTabChange('tutor')} className="min-h-11 border border-cyber-border px-4 text-sm font-medium text-cyber-text focus:outline-none focus:ring-2 focus:ring-neon-blue">智慧课堂</button></div></section>;
        default:
          return <Dashboard currentUser={currentUser} onTabChange={handleTabChange} />;
      }
    } catch (e: any) {
      setErrorMsg(e.message || "应用运行出错");
      return <Dashboard currentUser={currentUser} onTabChange={handleTabChange} />;
    }
  };

  return (
    <Layout
      activeTab={activeTab}
      onTabChange={handleTabChange}
      currentUser={currentUser}
      availableUsers={profiles}
      onSwitchUser={handleUserSwitch}
      onEditProfile={(u) => setEditingProfile(u)}
      onCreateUser={handleCreateUser}
      onDeleteUser={handleDeleteUser}
    >
      <ErrorToast />
      <SwitchToast />
      <AnimatePresence mode="wait">
        {editingProfile ? (
          <motion.div
            key="profile-edit"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={pageTransition}
          >
            <ProfilePage
              user={editingProfile}
              onSave={handleUpdateProfile}
              onCancel={() => setEditingProfile(null)}
            />
          </motion.div>
        ) : (
          <motion.div
            key={activeTab}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={pageTransition}
          >
            {renderContent()}
          </motion.div>
        )}
      </AnimatePresence>
    </Layout>
  );
};

export default App;
