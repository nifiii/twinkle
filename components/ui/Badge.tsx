import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'outline';
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  className = '',
}) => {
  const variants = {
    default: 'bg-gray-50 text-gray-600 border border-gray-100',
    success: 'bg-mint-100/50 text-green-600 border border-green-100/50',
    warning: 'bg-sunset-400/10 text-orange-600 border border-orange-100/50',
    error: 'bg-red-50 text-red-600 border border-red-100/50',
    info: 'bg-sky-50 text-sky-600 border border-sky-100/50',
    outline: 'bg-white/60 backdrop-blur-sm border border-gray-200/60 text-gray-500',
  };

  const sizes = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1 text-sm',
  };

  return (
    <span className={`rounded-full font-medium ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </span>
  );
};
