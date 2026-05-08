import React from 'react';
import { LucideIcon } from 'lucide-react';

interface ButtonProps {
  children?: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'success' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  type?: 'button' | 'submit' | 'reset';
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  onClick,
  disabled = false,
  className = '',
  title,
  type = 'button',
}) => {
  const baseStyles = 'font-medium rounded-xl transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed';

  const variants = {
    primary: 'bg-gradient-to-r from-sky-500 to-sky-400 text-white shadow-lg shadow-sky-500/25 hover:shadow-xl hover:shadow-sky-500/30 hover:-translate-y-0.5',
    secondary: 'bg-transparent border-2 border-sky-400 text-sky-500 hover:bg-sky-50/80',
    success: 'bg-gradient-to-r from-mint-400 to-mint-500 text-white shadow-lg shadow-mint-400/25 hover:shadow-xl hover:shadow-mint-400/30 hover:-translate-y-0.5',
    outline: 'bg-white/80 backdrop-blur-sm border-2 border-gray-200 text-gray-700 hover:border-sky-300 hover:text-sky-600',
  };

  const sizes = {
    sm: 'h-8 px-4 text-sm',
    md: 'h-10 px-6 text-base',
    lg: 'h-12 px-8 text-lg',
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {Icon && <Icon size={size === 'sm' ? 16 : size === 'lg' ? 24 : 20} />}
      {children}
    </button>
  );
};
