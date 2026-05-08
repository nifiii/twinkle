import React, { useState, useRef, useEffect } from 'react';
import { UserProfile } from '../types';
import { Pencil, Plus, Trash2 } from 'lucide-react';

interface UserSwitcherProps {
  currentUser: UserProfile;
  availableUsers: UserProfile[];
  onUserSwitch: (userId: string) => void;
  onEditProfile: (user: UserProfile) => void;
  onCreateUser: (payload: { name: string; avatar?: string; birthDate?: string; baseGrade?: number }) => Promise<UserProfile>;
  onDeleteUser: (id: string) => void;
}

const AVATARS = ['👦', '👧', '🧑', '👨', '👩', '🧒', '👶', '🦊', '🐯', '🐱', '🐶', '🐼'];

const UserSwitcher: React.FC<UserSwitcherProps> = ({
  currentUser, availableUsers, onUserSwitch, onEditProfile, onCreateUser, onDeleteUser
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAvatar, setNewAvatar] = useState(AVATARS[0]);
  const [creating, setCreating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSwitch = (userId: string) => {
    if (userId !== currentUser.id) {
      onUserSwitch(userId);
      setIsOpen(false);
    }
  };

  const handleEdit = (e: React.MouseEvent, user: UserProfile) => {
    e.stopPropagation();
    setIsOpen(false);
    onEditProfile(user);
  };

  const handleDelete = (e: React.MouseEvent, user: UserProfile) => {
    e.stopPropagation();
    if (window.confirm(`确认删除用户「${user.name}」吗？该操作不可撤销。`)) {
      onDeleteUser(user.id);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await onCreateUser({ name, avatar: newAvatar });
      setNewName('');
      setNewAvatar(AVATARS[0]);
      setShowCreate(false);
    } catch {
      // 错误由父组件处理
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/70 backdrop-blur-sm hover:bg-white/90 border border-gray-200/60 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md"
          style={{ height: '40px' }}
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-400 to-neon-blue flex items-center justify-center text-white font-medium text-sm shadow-sm">
            {currentUser.avatar}
          </div>
          <span className="text-sm font-semibold text-gray-700 hidden sm:inline">
            {currentUser.name}
          </span>
        </button>

        {isOpen && (
          <div className="absolute right-0 mt-2 w-72 bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-100/50 overflow-hidden z-50">
            <div className="max-h-80 overflow-y-auto py-1.5">
              {availableUsers.map((user) => {
                const isCurrent = user.id === currentUser.id;
                return (
                  <div
                    key={user.id}
                    className={`flex items-center gap-3 px-4 py-3 mx-1.5 rounded-xl transition-all duration-150 cursor-pointer ${
                      isCurrent ? 'bg-sky-50/80 text-sky-700' : 'text-gray-700 hover:bg-gray-50/80'
                    }`}
                    onClick={() => handleSwitch(user.id)}
                  >
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 to-neon-blue flex items-center justify-center text-white font-medium text-base flex-shrink-0 shadow-sm">
                      {user.avatar}
                    </div>
                    <div className="flex flex-col items-start flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{user.name}</span>
                        {isCurrent && <span className="text-sky-500 text-xs font-bold">✓</span>}
                      </div>
                      <span className="text-[11px] text-gray-400 truncate">{user.grade}</span>
                    </div>
                    <button
                      onClick={(e) => handleEdit(e, user)}
                      className="p-1.5 rounded-lg hover:bg-gray-200/60 text-gray-300 hover:text-gray-500 transition-colors flex-shrink-0"
                      title="编辑资料"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {!isCurrent && availableUsers.length > 1 && (
                      <button
                        onClick={(e) => handleDelete(e, user)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                        title="删除用户"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="border-t border-gray-100 px-3 py-2.5 bg-gray-50/60">
              {!showCreate ? (
                <button
                  onClick={() => setShowCreate(true)}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-white hover:bg-sky-50 text-sky-600 text-sm font-medium border border-sky-100 transition-colors"
                >
                  <Plus className="w-4 h-4" /> 添加用户
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <select
                      value={newAvatar}
                      onChange={e => setNewAvatar(e.target.value)}
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-base bg-white"
                    >
                      {AVATARS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                    <input
                      type="text"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      placeholder="用户姓名"
                      maxLength={20}
                      className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                      onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                      autoFocus
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowCreate(false); setNewName(''); }}
                      className="flex-1 py-1.5 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-100 text-sm"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={creating || !newName.trim()}
                      className="flex-1 py-1.5 bg-sky-500 text-white rounded-lg hover:bg-sky-600 disabled:opacity-50 text-sm"
                    >
                      {creating ? '创建中...' : '确认'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
    </div>
  );
};

export default UserSwitcher;
