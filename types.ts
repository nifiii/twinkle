
// Data types for the learning system

export enum DocType {
  TEXTBOOK = 'textbook', 
  NOTE = 'note',         
  WRONG_PROBLEM = 'wrong_problem', 
  EXAM_PAPER = 'exam_paper', 
  COURSEWARE = '学习完成的课件', 
  KNOWLEDGE_CARD = '知识卡片', 
  MOCK_EXAM = '模拟考试',
  HOMEWORK = '作业',
  PRACTICE_PAPER = '练习题',
  TUTOR_SESSION = '辅导记录',
  UNKNOWN = 'unknown'
}

export enum KnowledgeStatus {
  MASTERED = '已经掌握的知识',
  UNMASTERED = '未掌握的知识',
  STRENGTHEN = '需加强的知识点'
}

export enum ProcessingStatus {
  IDLE = 'idle',
  SCANNING = 'scanning',
  PROCESSED = 'processed',
  ERROR = 'error',
  INDEXING = 'indexing',
  ARCHIVED = 'archived'
}

export interface UploadProgress {
  loaded: number;          // 已上传字节数
  total: number;           // 文件总字节数
  percentage: number;      // 上传进度百分比 (0-100)
  chunkIndex: number;      // 当前分片索引 (从 0 开始)
  totalChunks: number;     // 总分片数
}

export enum ProblemStatus {
  CORRECT = 'correct',
  WRONG = 'wrong',
  CORRECTED = 'corrected' // 订正过的
}

export interface ProblemUnit {
  id: string;
  questionNumber: string;
  content: string;
  studentAnswer: string;
  standardAnswer?: string; // 标准答案 (AI 生成)
  teacherComment: string;
  correction?: string;
  knowledgePoints?: string[]; // 涉及知识点
  status: ProblemStatus;
}

export interface UserProfile {
  id: string;
  name: string;
  avatar: string;
  grade: string;       // 由后端基于 birthDate / baseGrade 推算的中文年级
  birthDate?: string;  // 出生年月，格式 YYYY-MM
  baseGrade?: number;  // 1-12，手动覆写时存储
  baseGradeSetAt?: string; // YYYY-MM
  gradeNum?: number;   // 1-12 数字年级
  nickname?: string;   // 兼容旧代码：保留可选字段，新代码不再使用
}

export enum IndexStatus {
  PENDING = 'pending',
  INDEXING = 'indexing',
  INDEXED = 'indexed',
  FAILED = 'failed'
}

export interface ChapterNode {
  id: string;
  title: string;
  level: number;  // 1=章, 2=节, 3=小节
  pageRange?: { start: number; end: number };
  children: ChapterNode[];
}

export interface EBook {
  id: string;
  title: string;
  author?: string;
  coverUrl?: string;  // 封面图（PDF第一页截图或自动生成）
  fileFormat: 'pdf' | 'epub' | 'txt';
  fileSize: number;  // 字节
  uploadedAt: number;
  ownerId: string;  // 可以是 'shared' 表示家庭共享
  filePath?: string; // 原始文件路径

  // AI 自动提取的元数据（用户可编辑）
  subject: string;  // 数学/物理/英语
  category: string;  // 教材/教辅/竞赛资料/考试真题
  grade: string;  // 小学/初中/高中
  tags: string[];  // ['奥数', '几何', '代数']
  publisher?: string;  // 出版社
  publishDate?: string;  // 出版时间

  // AI 提取相关字段
  aiConfidence?: number;  // 整体置信度 (0-1)
  fieldConfidence?: {  // 字段级置信度
    title?: number;
    author?: number;
    subject?: number;
    grade?: number;
    category?: number;
    publisher?: number;
    publishDate?: number;
  };
  extractionMethod?: 'doubao' | 'manual' | 'gemini' | 'anythingllm';  // 提取方式（gemini/anythingllm 为历史兼容值）

  // 章节目录（AI提取）
  tableOfContents: ChapterNode[];

  // 书籍索引状态（兼容字段，当前 RAG 功能未启用；indexStatus 仍用于前端 UI 展示）
  indexStatus: IndexStatus;
  anythingLlmDocId?: string;  // 历史兼容字段，当前未使用
  fileHash?: string;  // 文件哈希值 (用于查重)
  mdPath?: string;    // Markdown 文件路径
}

export interface StructuredMetaData {
  type: DocType;
  subject: string;
  chapter_hint?: string;
  knowledge_status?: KnowledgeStatus;
  frontmatter?: string; // Obsidian 元数据
  problems?: ProblemUnit[]; // 解析出的题目单元
}

export interface ScannedItem {
  id: string;
  ownerId: string;
  userName?: string;
  timestamp: number;
  imageUrl: string;
  rawMarkdown: string;
  meta: StructuredMetaData;
  status: ProcessingStatus;
  parentExamId?: string;    // 父试卷 ID (用于多页试卷关联)
  pageNumber?: number;      // 当前页码 (从 1 开始)
  totalPages?: number;      // 总页数
  multiPageSource?: boolean; // 是否来自多页试卷
  fileHash?: string;        // 文件哈希值 (用于查重)
  originalImages?: string[]; // (仅前端) 多图合并时的原始 Base64 数组
  allImagesJson?: string;    // (仅后端/数据库) 存储所有图片的 JSON 字符串
}

export interface ExamRequest {
  subject: string;
  chapter: string;
  difficulty: 'easy' | 'medium' | 'hard';
  type: 'unit' | 'midterm' | 'final' | 'mock';
}

export interface ExamPaper {
  id: string;
  ownerId: string;
  title: string;
  content: string; 
  createdAt: number;
  subject: string;
}
