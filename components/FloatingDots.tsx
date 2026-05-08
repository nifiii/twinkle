import React from 'react';

// 全局赛博风背景装饰：6 个浮游光点 + 弱网格
// 纯装饰、不可交互；fixed 定位在 Layout 根节点之下、内容之上之外
const FloatingDots: React.FC = () => {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* 极弱光斑（豆沙底用绿/橄榄做近色调装饰） */}
      <div className="absolute top-[10%] right-[12%] w-72 h-72 rounded-full bg-neon-green/[0.05] blur-3xl" />
      <div className="absolute bottom-[15%] left-[8%] w-60 h-60 rounded-full bg-emerald-700/[0.04] blur-3xl" />
    </div>
  );
};

export default FloatingDots;
