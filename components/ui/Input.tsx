import React from 'react';
import { LucideIcon } from 'lucide-react';

interface InputProps {
  type?: 'text' | 'email' | 'password' | 'number' | 'search';
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  icon?: LucideIcon;
  className?: string;
  disabled?: boolean;
}

export const Input: React.FC<InputProps> = ({
  type = 'text',
  placeholder,
  value,
  onChange,
  icon: Icon,
  className = '',
  disabled = false,
}) => {
  return (
    <div className="relative">
      {Icon && (
        <Icon className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
      )}
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={`w-full h-11 ${Icon ? 'pl-12' : 'pl-4'} pr-4 rounded-lg border-2 border-gray-200
          focus:border-sky-500 focus:ring-4 focus:ring-sky-100
          transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed
          ${className}`}
      />
    </div>
  );
};
