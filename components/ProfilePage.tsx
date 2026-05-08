import React, { useState, useMemo } from 'react';
import { UserProfile } from '../types';
import { Save, User, ArrowLeft } from 'lucide-react';

interface ProfilePageProps {
  user: UserProfile;
  onSave: (updated: UserProfile) => void;
  onCancel: () => void;
}

const GRADE_OPTIONS = [
  '小学一年级', '小学二年级', '小学三年级',
  '小学四年级', '小学五年级', '小学六年级',
  '初中七年级（初一）', '初中八年级（初二）', '初中九年级（初三）',
  '高中十年级（高一）', '高中十一年级（高二）', '高中十二年级（高三）',
];

const schoolYearStart = (year: number, month: number): number => month >= 9 ? year : year - 1;

const currentSchoolYear = (): number => {
  const now = new Date();
  return schoolYearStart(now.getFullYear(), now.getMonth() + 1);
};

const computeGradeFromBirth = (birthDate: string): number => {
  const [y, m] = birthDate.split('-').map(Number);
  if (!y) return 1;
  const birthYear = schoolYearStart(y, m || 9);
  const grade = currentSchoolYear() - birthYear - 5;
  return Math.max(1, Math.min(12, grade));
};

const AVATAR_OPTIONS = ['👦', '👧', '🧑', '👨', '👩', '🧒', '👶', '🦊', '🐯', '🐱', '🐶', '🐼'];

const ProfilePage: React.FC<ProfilePageProps> = ({ user, onSave, onCancel }) => {
  const [name, setName] = useState(user.name || '');
  const [avatar, setAvatar] = useState(user.avatar || '👤');
  const [birthDate, setBirthDate] = useState(user.birthDate || '');
  const [baseGrade, setBaseGrade] = useState<number | ''>(user.baseGrade || '');
  const [useAutoGrade, setUseAutoGrade] = useState(!user.baseGrade);

  const previewGradeNum = useMemo(() => {
    if (!useAutoGrade && baseGrade) return baseGrade as number;
    if (birthDate) return computeGradeFromBirth(birthDate);
    return user.gradeNum || 1;
  }, [useAutoGrade, baseGrade, birthDate, user.gradeNum]);

  const previewGradeName = GRADE_OPTIONS[previewGradeNum - 1] || GRADE_OPTIONS[0];

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      ...user,
      name: name.trim(),
      avatar,
      birthDate: birthDate || undefined,
      baseGrade: useAutoGrade ? undefined : (baseGrade || undefined),
    } as UserProfile);
    onCancel();
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <div className="bg-cyber-surface/60 backdrop-blur-md rounded-2xl border border-cyber-border/60 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-neon-blue/15 rounded-xl flex items-center justify-center shadow-glow-sm">
              <User className="w-6 h-6 text-neon-blue" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight bg-gradient-to-r from-neon-blue via-cyber-text to-neon-purple bg-clip-text text-transparent">
                编辑个人资料
              </h2>
              <p className="text-sm text-cyber-muted">修改头像、姓名、年级等信息</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyber-surface/60 hover:bg-cyber-surface text-cyber-text border border-cyber-border/60 hover:border-neon-blue/50 hover:text-neon-blue text-sm font-medium transition-all flex-shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            返回
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-gray-200 overflow-hidden">
        <div className="px-6 py-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">头像</label>
            <div className="flex flex-wrap gap-2">
              {AVATAR_OPTIONS.map(a => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAvatar(a)}
                  className={`w-12 h-12 rounded-lg text-2xl flex items-center justify-center border-2 transition-all ${
                    avatar === a ? 'border-sky-500 bg-sky-50 scale-105' : 'border-gray-200 hover:border-sky-300'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">姓名</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={20}
              placeholder="请输入姓名"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">出生年月</label>
            <input
              type="month"
              value={birthDate}
              onChange={e => setBirthDate(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              年级
              <span className="text-xs text-gray-400 ml-2">每年 9 月自动升级</span>
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={useAutoGrade}
                  onChange={() => setUseAutoGrade(true)}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-700">根据出生年月自动推算（默认 6 岁入学）</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={!useAutoGrade}
                  onChange={() => setUseAutoGrade(false)}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-700">手动指定当前年级</span>
              </label>
              {!useAutoGrade && (
                <select
                  value={baseGrade}
                  onChange={e => setBaseGrade(e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white"
                >
                  <option value="">请选择年级</option>
                  <optgroup label="小学">
                    {GRADE_OPTIONS.slice(0, 6).map((g, i) => <option key={g} value={i + 1}>{g}</option>)}
                  </optgroup>
                  <optgroup label="初中">
                    {GRADE_OPTIONS.slice(6, 9).map((g, i) => <option key={g} value={i + 7}>{g}</option>)}
                  </optgroup>
                  <optgroup label="高中">
                    {GRADE_OPTIONS.slice(9).map((g, i) => <option key={g} value={i + 10}>{g}</option>)}
                  </optgroup>
                </select>
              )}
              <div className="px-3 py-2 bg-sky-50 rounded-lg text-xs text-sky-700">
                当前年级：<span className="font-semibold">{previewGradeName}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors text-sm font-medium"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-sky-500 text-white rounded-lg hover:bg-sky-600 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            <Save className="w-4 h-4" />保存
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
