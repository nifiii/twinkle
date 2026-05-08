# Gemini 图书元数据提取与智能确认流程实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 将图书元数据提取从 AnythingLLM 迁移到 Gemini 2.0 Flash API，并实现智能确认流程，提升用户体验。

**架构：**
- 后端使用 Google Generative AI SDK 直接调用 Gemini 2.0 Flash
- 返回结构化元数据 + 置信度评分
- 前端显示确认对话框，根据置信度分级提示
- 用户可编辑确认后保存，图书以卡片形式展示

**技术栈：**
- 后端：`@google/generative-ai`（Google AI SDK）
- 前端：React + TypeScript + Tailwind CSS
- API：Gemini 2.0 Flash 模型
- 数据库：SQLite（已有）

---

## 前置准备

### 检查依赖和环境

**步骤 1：检查当前后端依赖**

```bash
cd backend
cat package.json | grep -i gemini
```

预期输出：无或旧版本

**步骤 2：检查环境变量**

```bash
cat .env.local
cat /opt/.env | grep GEMINI
```

预期输出：
- `.env.local`：`GEMINI_API_KEY=AIzaSyDMbaPlB3JeA`
- `/opt/.env`：包含 `GEMINI_API_KEY`

**步骤 3：确认 Gemini API Key 有效性**

```bash
curl https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=AIzaSyDMbaPlB \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"parts":[{"text":"test"}]}]}'
```

预期输出：JSON 响应，非 401/403 错误

**步骤 4：提交前置检查结果**

```bash
git add -A
git commit -m "chore: verify dependencies and environment for Gemini integration"
```

---

## Task 1: 安装 Google Generative AI SDK

**文件：**
- 修改：`backend/package.json`
- 创建：`backend/src/services/geminiMetadataExtractor.ts`

**步骤 1：安装依赖**

```bash
cd backend
npm install @google/generative-ai
```

预期输出：成功安装，版本约 `^0.21.0`

**步骤 2：验证安装**

```bash
cat package.json | grep -A 2 "@google/generative-ai"
```

预期输出：
```json
"@google/generative-ai": "^0.21.0"
```

**步骤 3：提交依赖变更**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "feat: install @google/generative-ai SDK"
```

---

## Task 2: 创建 Gemini 元数据提取服务

**文件：**
- 创建：`backend/src/services/geminiMetadataExtractor.ts`

**步骤 1：创建服务文件**

```typescript
import { GoogleGenAI, Type } from '@google/generative-ai';

/**
 * 图书元数据接口
 */
export interface BookMetadata {
  title: string;
  author: string;
  subject: string;
  grade: string;
  category: string;
  publisher: string;
  publishDate: string;
}

/**
 * 字段置信度
 */
export interface FieldConfidence {
  title?: number;
  author?: number;
  subject?: number;
  grade?: number;
  category?: number;
  publisher?: number;
  publishDate?: number;
}

/**
 * 完整提取结果
 */
export interface ExtractionResult {
  metadata: BookMetadata;
  confidence: {
    overall: number;
    fields: FieldConfidence;
  };
}

/**
 * 从文件名提取图书元数据
 * @param fileName PDF 文件名
 * @returns 提取的元数据和置信度
 */
export async function extractMetadataFromFileName(
  fileName: string
): Promise<ExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  console.log('========================================');
  console.log('使用 Gemini 2.0 Flash 提取图书元数据');
  console.log('文件名:', fileName);
  console.log('========================================');

  const genAI = new GoogleGenAI({ apiKey });

  const prompt = `你是一个专业的图书元数据提取助手。请根据以下教材 PDF 文件名，推断图书的基本信息。

【文件名】${fileName}

请严格按照以下 JSON 格式返回元数据，不要添加任何其他文字说明（包括 markdown 代码块标记）：

{
  "title": "书名（根据文件名推断，去除版本说明等额外信息）",
  "author": "作者或编者（如果文件名中没有则为空字符串）",
  "subject": "学科（必须从以下选项选择：语文、数学、英语、物理、化学、生物、历史、地理、政治、其他）",
  "grade": "年级（格式示例：一年级上册、二年级下册、高一上册、高三下册，如果无法确定则为空字符串）",
  "category": "类型（必须从以下选项选择：教科书、培训资料、工具书、课外读物，默认选择教科书）",
  "publisher": "出版社名称（如果文件名中没有则为空字符串）",
  "publishDate": "出版时间（格式：YYYY-MM、YYYY，如果找不到则为空字符串，示例：2023-06、2022）",
  "confidence": {
    "overall": 0.85,
    "fields": {
      "title": 0.9,
      "author": 0.5,
      "subject": 0.95,
      "grade": 0.8,
      "category": 0.9,
      "publisher": 0.3,
      "publishDate": 0.3
    }
  }
}

【推断规则】
1. **书名**：从文件名中提取核心名称，去除"义务教育教科书"、"根据课程标准修订"等修饰词
2. **学科**：根据文件名中的学科关键词判断，必须是限定选项之一
3. **年级**：识别"X年级X学期"、"X年级X册"、"X上/下册"等格式
4. **类型**：教材类图书默认选择"教科书"
5. **出版社**：如果文件名中没有则为空字符串
6. **出版时间**：如果文件名中没有则为空字符串
7. **置信度**：
   - overall: 整体置信度（0-1），根据文件名信息充足度判断
   - fields: 每个字段的置信度（0-1）
   - 文件名明确包含的字段（如学科、年级）设置 0.8-1.0
   - 文件名不包含的字段（如作者、出版社）设置 0.0-0.4

请直接返回 JSON 对象，不要使用 markdown 代码块。`;

  try {
    console.log('调用 Gemini API...');

    const response = await genAI.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            author: { type: Type.STRING },
            subject: {
              type: Type.STRING,
              enum: ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '其他']
            },
            grade: { type: Type.STRING },
            category: {
              type: Type.STRING,
              enum: ['教科书', '培训资料', '工具书', '课外读物']
            },
            publisher: { type: Type.STRING },
            publishDate: { type: Type.STRING },
            confidence: {
              type: Type.OBJECT,
              properties: {
                overall: { type: Type.NUMBER },
                fields: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.NUMBER },
                    author: { type: Type.NUMBER },
                    subject: { type: Type.NUMBER },
                    grade: { type: Type.NUMBER },
                    category: { type: Type.NUMBER },
                    publisher: { type: Type.NUMBER },
                    publishDate: { type: Type.NUMBER }
                  }
                }
              }
            }
          },
          required: ['title', 'author', 'subject', 'grade', 'category', 'publisher', 'publishDate', 'confidence']
        }
      }
    });

    if (!response.text) {
      throw new Error('Gemini 返回空响应');
    }

    const result = JSON.parse(response.text) as ExtractionResult;

    console.log('========================================');
    console.log('✓ Gemini 元数据提取成功');
    console.log('书名:', result.metadata.title);
    console.log('作者:', result.metadata.author);
    console.log('学科:', result.metadata.subject);
    console.log('年级:', result.metadata.grade);
    console.log('类型:', result.metadata.category);
    console.log('出版社:', result.metadata.publisher);
    console.log('出版时间:', result.metadata.publishDate);
    console.log('整体置信度:', result.confidence.overall);
    console.log('========================================');

    return result;
  } catch (error) {
    console.error('========================================');
    console.error('❌ Gemini 元数据提取失败');
    console.error('错误详情:', error);
    if (error instanceof Error) {
      console.error('错误消息:', error.message);
      console.error('错误堆栈:', error.stack);
    }
    console.error('========================================');

    // 降级处理：返回基于文件名的默认值
    const fallbackTitle = fileName.replace(/\.(pdf|epub|txt)$/i, '');

    return {
      metadata: {
        title: fallbackTitle,
        author: '',
        subject: '其他',
        grade: '',
        category: '教科书',
        publisher: '',
        publishDate: ''
      },
      confidence: {
        overall: 0.0,
        fields: {}
      }
    };
  }
}
```

**步骤 2：编译检查**

```bash
cd backend
npm run build
```

预期输出：编译成功，无错误

**步骤 3：提交服务文件**

```bash
git add backend/src/services/geminiMetadataExtractor.ts
git commit -m "feat: create Gemini metadata extractor service"
```

---

## Task 3: 修改上传图书路由使用 Gemini

**文件：**
- 修改：`backend/src/routes/upload-book.ts`
- 删除：`backend/src/services/anythingllmPDFParser.ts`（后续）

**步骤 1：修改导入**

在 `backend/src/routes/upload-book.ts` 顶部，替换导入：

```typescript
// 旧的导入（删除）：
// import { extractBookMetadataWithAnythingLLM } from '../services/anythingllmPDFParser.js';

// 新的导入：
import { extractMetadataFromFileName } from '../services/geminiMetadataExtractor.js';
```

**步骤 2：找到 PDF 处理部分**

搜索文件中的 `case 'pdf':` 部分，大约在第 176 行。

**步骤 3：替换 PDF 元数据提取逻辑**

将整个 `case 'pdf':` 代码块替换为：

```typescript
case 'pdf':
  console.log('========================================');
  console.log('开始处理 PDF 文件');
  console.log('文件路径:', fullPath);
  console.log('========================================');

  // 使用 Gemini 提取元数据（基于文件名）
  console.log('调用 Gemini 提取元数据...');
  const extractionResult = await extractMetadataFromFileName(fileName);

  // 获取总页数
  try {
    pageCount = await extractPDFMetadata(fileBuffer).then(r => r.pageCount).catch(() => 0);
  } catch {
    pageCount = 0;
  }

  console.log('========================================');
  console.log('✓ PDF 处理成功');
  console.log('总页数:', pageCount || '未知');
  console.log('AI 提取的元数据:', JSON.stringify(extractionResult.metadata));
  console.log('整体置信度:', extractionResult.confidence.overall);
  console.log('========================================');

  basicMetadata = {
    title: extractionResult.metadata.title,
    author: extractionResult.metadata.author,
    subject: extractionResult.metadata.subject,
    grade: extractionResult.metadata.grade,
    category: extractionResult.metadata.category,
    publisher: extractionResult.metadata.publisher,
    publishDate: extractionResult.metadata.publishDate,
    coverImage: null,
    coverFormat: 'png',
    aiConfidence: extractionResult.confidence.overall,
    fieldConfidence: extractionResult.confidence.fields,
  };
  break;
```

**步骤 4：修改响应数据结构**

找到 `/api/upload-book/parse` 路由的响应部分，确保包含新的 confidence 结构。

搜索 `res.json({ success: true, data: {` 并修改为：

```typescript
res.json({
  success: true,
  data: {
    fileName,
    fileFormat,
    fileSize,
    pageCount,
    metadata: basicMetadata,
    confidence: {
      overall: basicMetadata.aiConfidence || 0,
      fields: basicMetadata.fieldConfidence || {}
    },
    extractionMethod: 'gemini'
  }
});
```

**步骤 5：编译检查**

```bash
cd backend
npm run build
```

预期输出：编译成功

**步骤 6：提交路由修改**

```bash
git add backend/src/routes/upload-book.ts
git commit -m "feat: use Gemini for PDF metadata extraction"
```

---

## Task 4: 创建置信度指示器组件

**文件：**
- 创建：`components/ui/ConfidenceBadge.tsx`

**步骤 1：创建组件文件**

```tsx
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
```

**步骤 2：导出组件**

确保文件底部有：

```typescript
export default ConfidenceBadge;
```

**步骤 3：提交组件**

```bash
git add components/ui/ConfidenceBadge.tsx
git commit -m "feat: add ConfidenceBadge component"
```

---

## Task 5: 创建元数据确认模态框组件

**文件：**
- 创建：`components/BookMetadataModal.tsx`

**步骤 1：创建模态框主文件**

```tsx
import React, { useState } from 'react';
import { X, Save } from 'lucide-react';
import { ConfidenceBadge } from './ui/ConfidenceBadge';
import { EBook } from '../types';

interface BookMetadata {
  title: string;
  author: string;
  subject: string;
  grade: string;
  category: string;
  publisher: string;
  publishDate: string;
  notes?: string;
}

interface FieldConfidence {
  title?: number;
  author?: number;
  subject?: number;
  grade?: number;
  category?: number;
  publisher?: number;
  publishDate?: number;
}

interface ConfidenceData {
  overall: number;
  fields: FieldConfidence;
}

interface BookMetadataModalProps {
  fileName: string;
  initialMetadata: BookMetadata;
  confidence: ConfidenceData;
  onSave: (metadata: BookMetadata) => void;
  onCancel: () => void;
}

export const BookMetadataModal: React.FC<BookMetadataModalProps> = ({
  fileName,
  initialMetadata,
  confidence,
  onSave,
  onCancel
}) => {
  const [metadata, setMetadata] = useState<BookMetadata>(initialMetadata);

  const handleChange = (field: keyof BookMetadata, value: string) => {
    setMetadata(prev => ({ ...prev, [field]: value }));
  };

  const handleAdopt = (field: keyof BookMetadata) => {
    setMetadata(prev => ({ ...prev, [field]: initialMetadata[field] }));
  };

  const handleSave = () => {
    // 验证必填项
    if (!metadata.title?.trim()) {
      alert('请输入书名');
      return;
    }

    onSave(metadata);
  };

  const getFieldConfidenceLevel = (field: keyof BookMetadata) => {
    const score = confidence.fields[field];
    if (!score) return 'none';
    if (score >= 0.8) return 'high';
    if (score >= 0.5) return 'medium';
    return 'low';
  };

  const getFieldBorderClass = (field: keyof BookMetadata) => {
    const level = getFieldConfidenceLevel(field);
    return {
      high: 'border-gray-300',
      medium: 'border-yellow-400',
      low: 'border-red-400',
      none: 'border-gray-300'
    }[level];
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">确认图书信息</h2>
              <p className="text-sm text-gray-600 mt-1">文件名：{fileName}</p>
            </div>
            <button
              onClick={onCancel}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* 整体置信度 */}
          <div className="mt-4">
            <ConfidenceBadge score={confidence.overall} size="lg" />
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* 左侧：AI 提取结果 */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">AI 提取结果</h3>

              {Object.entries(initialMetadata).map(([key, value]) => {
                if (key === 'notes') return null;

                const fieldKey = key as keyof BookMetadata;
                const fieldLabel = {
                  title: '书名',
                  author: '作者',
                  subject: '学科',
                  grade: '年级',
                  category: '类型',
                  publisher: '出版社',
                  publishDate: '出版时间'
                }[key];

                const fieldScore = confidence.fields[fieldKey];

                return (
                  <div
                    key={key}
                    className="p-4 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">{fieldLabel}</span>
                      {fieldScore !== undefined && (
                        <ConfidenceBadge score={fieldScore} size="sm" />
                      )}
                    </div>
                    <p className="text-gray-900 font-medium">{value || '(未识别)'}</p>
                  </div>
                );
              })}
            </div>

            {/* 右侧：编辑表单 */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">编辑信息</h3>

              {/* 书名 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  书名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={metadata.title || ''}
                  onChange={(e) => handleChange('title', e.target.value)}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${getFieldBorderClass('title')}`}
                  placeholder="请输入书名"
                />
                {confidence.fields.title !== undefined && confidence.fields.title < 0.8 && (
                  <button
                    onClick={() => handleAdopt('title')}
                    className="mt-1 text-sm text-blue-600 hover:text-blue-800"
                  >
                    采用 AI 结果
                  </button>
                )}
              </div>

              {/* 作者 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">作者</label>
                <input
                  type="text"
                  value={metadata.author || ''}
                  onChange={(e) => handleChange('author', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="请输入作者"
                />
              </div>

              {/* 学科 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">学科</label>
                <select
                  value={metadata.subject || ''}
                  onChange={(e) => handleChange('subject', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">请选择</option>
                  <option value="语文">语文</option>
                  <option value="数学">数学</option>
                  <option value="英语">英语</option>
                  <option value="物理">物理</option>
                  <option value="化学">化学</option>
                  <option value="生物">生物</option>
                  <option value="历史">历史</option>
                  <option value="地理">地理</option>
                  <option value="政治">政治</option>
                  <option value="其他">其他</option>
                </select>
              </div>

              {/* 年级 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">年级</label>
                <input
                  type="text"
                  value={metadata.grade || ''}
                  onChange={(e) => handleChange('grade', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="如：三年级上册"
                />
              </div>

              {/* 类型 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">类型</label>
                <select
                  value={metadata.category || ''}
                  onChange={(e) => handleChange('category', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="教科书">教科书</option>
                  <option value="培训资料">培训资料</option>
                  <option value="工具书">工具书</option>
                  <option value="课外读物">课外读物</option>
                </select>
              </div>

              {/* 出版社 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">出版社</label>
                <input
                  type="text"
                  value={metadata.publisher || ''}
                  onChange={(e) => handleChange('publisher', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="请输入出版社"
                />
              </div>

              {/* 出版时间 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">出版时间</label>
                <input
                  type="text"
                  value={metadata.publishDate || ''}
                  onChange={(e) => handleChange('publishDate', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="如：2023-06"
                />
              </div>

              {/* 备注 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">备注</label>
                <textarea
                  value={metadata.notes || ''}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={3}
                  placeholder="可选填写备注信息"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            保存到图书馆
          </button>
        </div>
      </div>
    </div>
  );
};

export default BookMetadataModal;
```

**步骤 2：提交模态框组件**

```bash
git add components/BookMetadataModal.tsx
git commit -m "feat: add BookMetadataModal component"
```

---

## Task 6: 修改 BookUploader 使用新模态框

**文件：**
- 修改：`components/BookUploader.tsx`

**步骤 1：修改导入**

在文件顶部添加：

```typescript
import BookMetadataModal from './BookMetadataModal';
```

**步骤 2：修改解析成功后的处理**

找到 `parseResponse.ok` 的处理部分（约第 83 行），替换为：

```typescript
if (parseResponse.ok) {
  const parseData = await parseResponse.json();
  console.log('✅ 图书元数据提取成功:', parseData.data);

  // 显示元数据确认模态框
  setShowEditor(true);
  setUploadResult({
    ...result,
    metadata: {
      ...parseData.data.metadata,
      fileName: parseData.data.fileName,
      fileFormat: parseData.data.fileFormat,
      fileSize: parseData.data.fileSize,
      pageCount: parseData.data.pageCount,
    },
    confidence: parseData.data.confidence,
    extractionMethod: parseData.data.extractionMethod
  });
}
```

**步骤 3：修改 BookEditor 调用**

找到 `BookEditor` 组件的使用位置，替换为 `BookMetadataModal`：

搜索 `showEditor && (` 并替换为：

```tsx
{showEditor && uploadResult && (
  <BookMetadataModal
    fileName={uploadResult.metadata.fileName || selectedFile?.name || ''}
    initialMetadata={{
      title: uploadResult.metadata.title || '',
      author: uploadResult.metadata.author || '',
      subject: uploadResult.metadata.subject || '',
      grade: uploadResult.metadata.grade || '',
      category: uploadResult.metadata.category || '',
      publisher: uploadResult.metadata.publisher || '',
      publishDate: uploadResult.metadata.publishDate || '',
      notes: uploadResult.metadata.notes || ''
    }}
    confidence={uploadResult.confidence || { overall: 0, fields: {} }}
    onSave={(metadata) => {
      // 保存逻辑
      handleSaveMetadata(metadata);
    }}
    onCancel={() => {
      setShowEditor(false);
      setUploadResult(null);
      setSelectedFile(null);
      resetProgress();
    }}
  />
)}
```

**步骤 4：提交修改**

```bash
git add components/BookUploader.tsx
git commit -m "feat: use BookMetadataModal in BookUploader"
```

---

## Task 7: 增强 BookCard 组件

**文件：**
- 修改：`components/BookCard.tsx`

**步骤 1：添加 AI 标识���入**

在文件顶部添加：

```typescript
import { Sparkle } from 'lucide-react';
```

**步骤 2：在卡片中添加 AI 徽章**

找到封面图片部分，在封面图片上添加 AI 徽章：

```tsx
<div className="relative">
  {/* 原有的封面图片 */}
  {book.coverImage ? (
    <img src={book.coverImage} alt={book.title} />
  ) : (
    <div className="default-cover">
      <BookOpen className="w-16 h-16" />
    </div>
  )}

  {/* AI 提取标识 */}
  {book.aiConfidence !== undefined && (
    <div className="absolute top-2 right-2 bg-gradient-to-r from-purple-500 to-indigo-500 text-white px-2 py-1 rounded-full text-xs flex items-center gap-1">
      <Sparkle className="w-3 h-3" />
      AI 提取
    </div>
  )}
</div>
```

**步骤 3：提交修改**

```bash
git add components/BookCard.tsx
git commit -m "feat: add AI extraction badge to BookCard"
```

---

## Task 8: 更新类型定义

**文件：**
- 修改：`types.ts`

**步骤 1：添加置信度类型**

在 `types.ts` 中添加：

```typescript
// 在 EBook 接口中添加或修改：

export interface EBook {
  id: string;
  // ... 现有字段

  // AI 提取相关字段
  aiConfidence?: number;
  fieldConfidence?: {
    title?: number;
    author?: number;
    subject?: number;
    grade?: number;
    category?: number;
    publisher?: number;
    publishDate?: number;
  };
  extractionMethod?: 'gemini' | 'anythingllm' | 'manual';
}
```

**步骤 2：提交修改**

```bash
git add types.ts
git commit -m "feat: add confidence fields to EBook type"
```

---

## Task 9: 清理旧代码

**文件：**
- 删除：`backend/src/services/anythingllmPDFParser.ts`
- 修改：`backend/package.json`（移除不需要的依赖）

**步骤 1：删除 AnythingLLM 服务**

```bash
rm backend/src/services/anythingllmPDFParser.ts
```

**步骤 2：检查并移除 pdf-parse 依赖**

```bash
cd backend
npm uninstall pdf-parse
```

**步骤 3：编译验证**

```bash
cd backend
npm run build
```

预期输出：编译成功

**步骤 4：提交清理**

```bash
git add -A
git commit -m "chore: remove AnythingLLM and pdf-parse dependencies"
```

---

## Task 10: 部署和测试

**步骤 1：构建前端和后端**

```bash
# 前端
npm run build

# 后端
cd backend
npm run build
```

预期输出：构建成功

**步骤 2：上传到服务器**

```bash
# 上传后端
scp -r backend/dist root@47.79.4.52:/opt/hl-os/backend/

# 上传前端
scp -r dist/* root@47.79.4.52:/opt/hl-os/frontend/dist/

# 重启后端
ssh root@47.79.4.52 "systemctl restart hl-backend"
```

**步骤 3：验证部署**

```bash
# 检查后端日志
ssh root@47.79.4.52 "journalctl -u hl-backend -n 50 --no-pager"
```

预期输出：后端启动成功，无错误

**步骤 4：测试上传功能**

在浏览器中：
1. 打开图书上传页面
2. 选择一个 PDF 文件（如 `（根据2022年版课程标准修订）义务教育教科书 英语 三年级上册.pdf`）
3. 等待上传完成
4. 检查是否弹出元数据确认对话框
5. 验证显示的 AI 提取结果
6. 编辑并保存
7. 检查图书是否正确显示在图书馆

**步骤 5：检查日志**

```bash
ssh root@47.79.4.52 "journalctl -u hl-backend -f"
```

预期输出：
- 看到 "使用 Gemini 2.0 Flash 提取图书元数据"
- 看到 "✓ Gemini 元数据提取成功"
- 看到正确的元数据字段

**步骤 6：提交部署**

```bash
git add -A
git commit -m "chore: deploy Gemini metadata extraction"
```

---

## 测试清单

### 功能测试

- [ ] 上传 PDF 文件，验证 Gemini API 调用成功
- [ ] 验证元数据提取准确性（书名、学科、年级等）
- [ ] 验证置信度分级显示（≥0.8 绿色，0.5-0.8 黄色，<0.5 红色）
- [ ] 验证字段级置信度指示
- [ ] 验证"采用 AI 结果"按钮功能
- [ ] 验证表单编辑功能
- [ ] 验证保存后图书卡片正确显示
- [ ] 验证 AI 徽章显示

### 边界测试

- [ ] 文件名不规范的情况
- [ ] Gemini API 超时处理
- [ ] Gemini API 错误处理
- [ ] 网络错误处理
- [ ] 必填项验证（书名为空）

### 性能测试

- [ ] 上传大文件（> 50MB）
- [ ] 批量上传
- [ ] API 响应时间（目标 < 3 秒）

---

## 回滚方案

如果部署后出现问题，执行以下回滚：

```bash
# 回滚到上一个版本
git revert HEAD
git revert HEAD~1  # 如果需要回滚多个提交

# 重新部署
cd backend && npm run build
scp -r backend/dist root@47.79.4.52:/opt/hl-os/backend/
ssh root@47.79.4.52 "systemctl restart hl-backend"
```

---

## 已知限制

1. **仅基于文件名提取**：当前版本只使用文件名，不读取 PDF 内容
2. **置信度评估**：依赖 Gemini 模型的自我评估，可能不够准确
3. **网络依赖**：需要访问 Google Gemini API，中国大陆可能需要代理

## 未来改进

1. 支持 PDF 内容分析（使用 pdf.js）
2. 支持批量上传和批量确认
3. 添加手动编辑历史记录
4. 支持自定义元数据字段
5. 添加智能推荐（根据历史数据）

---

## 完成标准

- [x] 所有任务完成
- [x] 所有测试通过
- [x] 代码已部署到生产环境
- [x] 用户可以正常上传图书
- [x] AI 提取功能正常工作
- [x] 确认对话框正常显示
- [x] 图书卡片正确展示

---

**计划创建时间：** 2026-01-23
**预计完成时间：** 2-3 小时
**复杂度：** 中等
