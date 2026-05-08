import React from 'react';
import { CheckCircle, AlertCircle, AlertTriangle } from 'lucide-react';

export interface ConfidenceBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
}

export const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = ({
  score,
  size = 'md',
  showText = true
}) => {
  // 根据置信度确定级别
  const getLevel = () => {
    if (score >= 0.8) return 'success';
    if (score >= 0.5) return 'warning';
    return 'error';
  };

  const level = getLevel();

  // 根据级别返回图标和文本
  const config = {
    success: {
      icon: CheckCircle,
      text: '提取成功',
      colorClass: 'text-green-600',
      bgClass: 'bg-green-50 border-green-200'
    },
    warning: {
      icon: AlertCircle,
      text: '建议确认',
      colorClass: 'text-yellow-600',
      bgClass: 'bg-yellow-50 border-yellow-200'
    },
    error: {
      icon: AlertTriangle,
      text: '请人工核对',
      colorClass: 'text-red-600',
      bgClass: 'bg-red-50 border-red-200'
    }
  }[level];

  const Icon = config.icon;

  const sizeClasses = {
    sm: 'px-2 py-1 text-xs gap-1',
    md: 'px-3 py-1.5 text-sm gap-1.5',
    lg: 'px-4 py-2 text-base gap-2'
  }[size];

  return (
    <div className={`
      inline-flex items-center
      border rounded-full
      ${config.bgClass}
      ${config.colorClass}
      ${sizeClasses}
    `}>
      <Icon className="w-4 h-4" />
      {showText && <span className="font-medium">{config.text}</span>}
    </div>
  );
};

export default ConfidenceBadge;
