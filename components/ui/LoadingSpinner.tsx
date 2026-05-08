import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  size?: number;
  className?: string;
  text?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 32,
  className = '',
  text,
}) => {
  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <div className="relative" style={{ width: size * 4, height: size * 4 }}>
        {/* 外层脉冲圆环 */}
        <div className="absolute inset-0 border-4 border-sky-500 rounded-full animate-ping opacity-75" />
        {/* 内层固定圆环 */}
        <div className="absolute inset-0 border-4 border-sky-500 rounded-full" />
        {/* 旋转加载图标 */}
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="text-sky-500 animate-spin" size={size * 1.5} />
        </div>
      </div>
      {text && (
        <p className="mt-4 text-gray-600 font-medium">{text}</p>
      )}
    </div>
  );
};
