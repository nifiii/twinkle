import './src/index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

// 渲染应用主入口
try {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (error) {
  console.error('React 应用渲染失败:', error);
  // 即使渲染失败也要隐藏加载层，让用户看到错误
  if (typeof (window as any).hideAppLoader === 'function') {
    (window as any).hideAppLoader();
  }
}

// 确保 DOM 挂载后再执行隐藏逻辑
// 使用 setTimeout 确保在下一个事件循环执行，避免被 React 错误中断
setTimeout(() => {
  if (typeof (window as any).hideAppLoader === 'function') {
    (window as any).hideAppLoader();
    console.log('✅ 加载层已隐藏');
  } else {
    console.error('❌ hideAppLoader 函数未找到');
  }
}, 100);

// 额外保障：2秒后强制隐藏加载层
setTimeout(() => {
  const loader = document.getElementById('loading-overlay');
  if (loader && loader.style.display !== 'none') {
    console.warn('⚠️ 强制隐藏加载层');
    loader.remove();
  }
}, 2000);
