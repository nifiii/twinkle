# AI课堂功能实现计划

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agent/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** 将自习室生成的课件(PPT分页格式)和测验持久化到服务器，并新建"AI课堂"页面用于课程学习和在线考试。

**Architecture:**
- 后端新增 `classroom_items` 表存储课件/测验，新增 TTS 代理接口
- 课件改为 JSON 分页幻灯片格式（豆包生成），测验改为结构化 JSON 题目
- "AI导师"页面改名为"AI课堂"，含课程学习列表和课程测验列表
- 豆包 TTS（火山引擎语音技术）为课件每页语音朗读

**Tech Stack:** TypeScript, Express, better-sqlite3, React, Doubao ARK API, 火山引擎 TTS HTTP API

---

## Task 1: DB迁移 — 新增 classroom_items 表

**Files:**
- Modify: `backend/src/services/databaseService.ts`

**Step 1:** 在 `initDatabase()` 末尾追加建表语句

```typescript
db.exec(`
  CREATE TABLE IF NOT EXISTS classroom_items (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,        -- 'courseware' | 'quiz'
    bookTitle TEXT NOT NULL,
    chapter TEXT NOT NULL,
    subject TEXT NOT NULL,
    ownerId TEXT NOT NULL,
    userName TEXT,
    contentJson TEXT NOT NULL, -- JSON string: slides[] or questions[]
    slideCount INTEGER,        -- courseware 用
    questionCount INTEGER,     -- quiz 用
    createdAt INTEGER NOT NULL
  )
`);
```

**Step 2:** 添加迁移检查（如表已存在字段缺失则补齐）

**Step 3:** Commit
```bash
git add backend/src/services/databaseService.ts
git commit -m "feat(db): add classroom_items table"
```

---

## Task 2: 后端 — 修改课件生成接口，切换豆包+持久化

**Files:**
- Modify: `backend/src/routes/courseware.ts`

**Step 1:** 修改 `/api/generate-courseware` — 将 Gemini 换成豆包 ARK，输出 JSON slides

Prompt 要求 AI 返回如下 JSON 数组（不是 Markdown）：
```json
[
  {"index":1,"title":"导入","content":"正文内容...","notes":"讲解词..."},
  {"index":2,"title":"知识点一","content":"...","notes":"..."}
]
```

关键代码骨架：
```typescript
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import db from '../services/databaseService.js';

const getDoubaoClient = () => {
  const apiKey = process.env.ARK_API_KEY;
  const model = process.env.ARK_MODEL_ID;
  if (!apiKey || !model) throw new Error('ARK_API_KEY or ARK_MODEL_ID not set');
  return { client: new OpenAI({ apiKey, baseURL: 'https://ark.cn-beijing.volces.com/api/v3' }), model };
};

router.post('/generate-courseware', async (req, res, next) => {
  const { bookTitle, chapter, studentName, subject, teachingStyle, wrongProblems } = req.body;
  // 1. 调用豆包生成 slides JSON
  // 2. 解析 JSON
  // 3. 持久化到 classroom_items
  // 4. 返回 { success, data: slides[], id }
});
```

**Step 2:** 持久化逻辑

```typescript
const id = uuidv4();
db.prepare(`INSERT INTO classroom_items (id,type,bookTitle,chapter,subject,ownerId,userName,contentJson,slideCount,createdAt)
  VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .run(id,'courseware',bookTitle,chapter,subject,ownerId||'shared',studentName,JSON.stringify(slides),slides.length,Date.now());
```

**Step 3:** Commit
```bash
git commit -m "feat(api): courseware uses Doubao+persist to DB"
```

---

## Task 3: 后端 — 修改测验生成接口，切换豆包+持久化+结构化JSON

**Files:**
- Modify: `backend/src/routes/assessment.ts`

**Step 1:** 输出格式改为 JSON 题目数组

```json
[
  {
    "id":"q1","type":"choice","question":"题目...","options":["A.","B.","C.","D."],
    "answer":"A","explanation":"解析..."
  },
  {
    "id":"q2","type":"fill","question":"填空...","answer":"答案","explanation":"..."
  },
  {
    "id":"q3","type":"essay","question":"解答...","answer":"参考答案","explanation":"..."
  }
]
```

**Step 2:** 持久化到 `classroom_items`（type='quiz'）

**Step 3:** Commit

---

## Task 4: 后端 — 新增课堂列表查询路由

**Files:**
- Create: `backend/src/routes/classroom.ts`
- Modify: `backend/src/index.ts`

**Step 1:** 实现路由

```typescript
import { Router } from 'express';
import db from '../services/databaseService.js';

const router = Router();

// GET /api/classroom?type=courseware&ownerId=xxx
router.get('/classroom', (req, res) => {
  const { type, ownerId } = req.query;
  const rows = db.prepare(
    `SELECT id,type,bookTitle,chapter,subject,ownerId,userName,slideCount,questionCount,createdAt
     FROM classroom_items WHERE type=? AND (ownerId=? OR ownerId='shared')
     ORDER BY createdAt DESC`
  ).all(type, ownerId);
  res.json({ success: true, data: rows });
});

// GET /api/classroom/:id
router.get('/classroom/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM classroom_items WHERE id=?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({ success: true, data: { ...row, contentJson: JSON.parse(row.contentJson) } });
});

export default router;
```

**Step 2:** 在 index.ts 注册
```typescript
import classroomRouter from './routes/classroom.js';
app.use('/api', classroomRouter);
```

**Step 3:** Commit

---

## Task 5: 后端 — 新增 TTS 代理接口

**Files:**
- Create: `backend/src/routes/tts.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/.env` (文档说明，实际 key 由用户填写)

**Step 1:** `.env` 新增占位配置（用户填入真实值）

```
# 火山引擎语音技术 TTS
VOLCANO_TTS_APP_ID=your_app_id_here
VOLCANO_TTS_ACCESS_TOKEN=your_access_token_here
VOLCANO_TTS_CLUSTER=volcano_tts
VOLCANO_TTS_VOICE_TYPE=BV001_streaming
```

**Step 2:** 实现 TTS 代理（HTTP POST 转发到火山引擎）

```typescript
import { Router } from 'express';
import axios from 'axios';

const router = Router();

router.post('/tts', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ success: false, error: 'text required' });

  const appId = process.env.VOLCANO_TTS_APP_ID;
  const token = process.env.VOLCANO_TTS_ACCESS_TOKEN;
  const cluster = process.env.VOLCANO_TTS_CLUSTER || 'volcano_tts';
  const voiceType = process.env.VOLCANO_TTS_VOICE_TYPE || 'BV001_streaming';

  if (!appId || !token) {
    return res.status(503).json({ success: false, error: 'TTS未配置，请联系管理员' });
  }

  try {
    const payload = {
      app: { appid: appId, token, cluster },
      user: { uid: 'hlos_user' },
      audio: { voice_type: voiceType, encoding: 'mp3', speed_ratio: 1.0 },
      request: { reqid: Date.now().toString(), text, text_type: 'plain', operation: 'query' }
    };

    const resp = await axios.post(
      'https://openspeech.bytedance.com/api/v1/tts',
      payload,
      { headers: { Authorization: `Bearer;${token}` }, responseType: 'json', timeout: 30000 }
    );

    if (resp.data?.data) {
      // 返回 base64 audio
      res.json({ success: true, audio: resp.data.data, encoding: 'mp3' });
    } else {
      res.status(500).json({ success: false, error: 'TTS返回数据异常' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
```

**Step 3:** 注册路由，Commit

---

## Task 6: 前端 — 修改 CoursewareGenerator，生成后自动存档

**Files:**
- Modify: `components/CoursewareGenerator.tsx`

**Step 1:** 修改 state，`courseware` 由 `string` 改为 `Slide[]`

```typescript
interface Slide { index: number; title: string; content: string; notes: string; }
const [slides, setSlides] = useState<Slide[]>([]);
const [savedId, setSavedId] = useState<string>('');
```

**Step 2:** API 返回解析

```typescript
const result = await response.json();
if (result.success) {
  setSlides(result.data);    // slides array
  setSavedId(result.id);     // saved DB id
}
```

**Step 3:** UI 展示改为幻灯片预览（简版，点击"在AI课堂查看"跳转）

- 显示幻灯片数量、保存成功提示
- "已保存到AI课堂 ✅" toast

**Step 4:** Commit

---

## Task 7: 前端 — 修改 QuizGenerator，生成后自动存档+跳转

**Files:**
- Modify: `components/QuizGenerator.tsx`

**Step 1:** state 改为 `questions[]`，类型定义

```typescript
interface Question {
  id: string; type: 'choice'|'fill'|'essay';
  question: string; options?: string[];
  answer: string; explanation: string;
}
const [questions, setQuestions] = useState<Question[]>([]);
const [savedId, setSavedId] = useState<string>('');
```

**Step 2:** 生成后显示题目预览（题目数量）+ "已保存到AI课堂"

**Step 3:** Commit

---

## Task 8: 前端 — 新建 SlideViewer 组件（幻灯片+TTS讲解）

**Files:**
- Create: `components/SlideViewer.tsx`

**Step 1:** 组件 props

```typescript
interface SlideViewerProps {
  itemId: string;  // classroom_items.id，用于加载完整内容
  onClose?: () => void;
}
```

**Step 2:** 加载数据（`GET /api/classroom/:id`），展示幻灯片

功能：
- 上一页/下一页
- 当前页/总页数指示
- 语音朗读按钮（调 `/api/tts`，返回 base64 mp3，用 Audio 播放）
- 自动朗读切换

**Step 3:** 语音播放核心逻辑

```typescript
const playTTS = async (text: string) => {
  setTtsLoading(true);
  const res = await fetch('/api/tts', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ text })
  });
  const data = await res.json();
  if (data.success && data.audio) {
    const audio = new Audio(`data:audio/mp3;base64,${data.audio}`);
    audio.play();
  }
  setTtsLoading(false);
};
```

**Step 4:** Commit

---

## Task 9: 前端 — 新建 QuizExam 组件（在线考试+AI批改）

**Files:**
- Create: `components/QuizExam.tsx`

**Step 1:** 三阶段状态机：`'exam' | 'grading' | 'result'`

**Step 2:** 考试阶段 UI

- 显示题目（选择题渲染选项，填空/解答渲染 textarea）
- 学生提交答案记录到 `answers: Record<string, string>`
- "提交试卷"按钮

**Step 3:** 批改逻辑（前端直接对比/调 AI）

选择题直接对比 `answer === questions[i].answer`；
填空/解答题调豆包 API（前端调用 `/api/grade-quiz`）

**Step 4:** 新增批改路由 `POST /api/grade-quiz`

```typescript
// backend/src/routes/classroom.ts 追加
router.post('/grade-quiz', async (req, res) => {
  const { questions, answers } = req.body;
  // 对选择/填空题直接判断
  // 对解答题用豆包评判
  // 返回: { score, total, results[], suggestions }
});
```

**Step 5:** 结果页 UI

- 得分：X/Y 题正确
- 错题列表 + explanation
- AI 学习建议（豆包生成）

**Step 6:** Commit

---

## Task 10: 前端 — 新建 AIClassroom 组件（替换原 LiveTutor 入口页）

**Files:**
- Create: `components/AIClassroom.tsx`
- Modify: `components/Layout.tsx`（改名）
- Modify: `App.tsx`（改 case）

**Step 1:** Layout.tsx 修改

```typescript
// 原: { id: 'tutor', label: 'AI 导师', icon: Mic, color: '#FB7185' }
// 改:
{ id: 'tutor', label: 'AI 课堂', icon: GraduationCap, color: '#FB7185' }
```

**Step 2:** AIClassroom.tsx 结构

- 两个 Tab：`课程学习` / `课程测验`
- 课程学习列表：从 `/api/classroom?type=courseware&ownerId=xxx` 加载，每项显示书名-章节-生成时间
- 课程测验列表：从 `/api/classroom?type=quiz&ownerId=xxx` 加载
- 点击课件 → 打开 SlideViewer
- 点击测验 → 打开 QuizExam

**Step 3:** App.tsx 中 `case 'tutor'` 改为渲染 `<AIClassroom />`（保留 LiveTutor 弹窗功能，在 AIClassroom 内部提供入口）

**Step 4:** Commit

---

## Task 11: 部署验证

**Files:**
- Read: `d:\devops\HL-os\.agent\skills\deploying-hlos\SKILL.md`

**Step 1:** 读取部署技能，执行部署

**Step 2:** 验证核查清单：
- [ ] 自习室生成课件 → AI课堂课程学习列表出现记录
- [ ] 点击课件记录 → 幻灯片播放器打开，可翻页
- [ ] 语音朗读按钮（需配置 TTS key）
- [ ] 自习室生成测验 → AI课堂课程测验列表出现记录
- [ ] 点击测验 → 在线考试页面，可作答
- [ ] 提交试卷 → 显示得分和错题解析
- [ ] 导航栏显示"AI课堂"

---

## 风险与说明

| 风险 | 处理方式 |
|---|---|
| TTS key 未配置 | 接口返回 503 提示，UI 降级到按钮 disabled + 提示文字 |
| 豆包返回非 JSON | 增加 JSON 解析 try-catch，失败时返回 error |
| 现有课件/测验生成不变 | 原有 API 路径不变，仅修改内部实现和增加持久化 |
| 迁移旧数据 | classroom_items 是全新表，无历史数据迁移需求 |
