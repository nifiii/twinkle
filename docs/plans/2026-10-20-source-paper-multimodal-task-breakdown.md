# 1. 背景

按最小垂直切片拆分多模态母卷扩展，保留AI内部实现自由度。

# 2. 目标

让每个任务拥有可独立验收的业务能力。

# 3. 方案

## T-MM-001 视觉证据服务

- Outcome：从安全原始 PDF 页面得到结构化分区、资源和缺失项证据。
- Inputs：业务需求、技术设计、API契约、验收1/2。
- Scope：`backend/src/services/sourcePaperVisionService.ts`、相关配置与测试。
- Non-goals：不持久化原图，不生成题目。
- Acceptance：路径校验、注入替身、JSON校验和阻断测试通过。
- Freedom：页面渲染库、提示词和临时目录实现可自行选择。
- Dependencies：无。

## T-MM-002 母卷服务与多选题契约

- Outcome：母卷生成可消费视觉证据并生成原创 `multi_choice`。
- Inputs：T-MM-001、API契约、验收2/3/4。
- Scope：`assessmentPaperService`、类型、测试。
- Non-goals：不复制母卷原题/原图，不支持无材料听力题。
- Acceptance：多选校验、听力原文分支、材料缺失阻断和旧题型回归通过。
- Freedom：证据摘要拼接、错误类层次和提示词组织可自行选择。
- Dependencies：T-MM-001。

## T-MM-003 作答、回顾与导出

- Outcome：多选题在网页、作答快照和PDF中可完成且答案不丢失。
- Inputs：T-MM-002、API契约、验收3/5。
- Scope：`PaperExam`、API类型、attempt/export服务与测试。
- Non-goals：不恢复被取消的系统批改逻辑，不新增复杂绘图输入。
- Acceptance：checkbox、数组答案、刷新回顾、A4试卷/答案卷构建通过。
- Freedom：组件样式和数组序列化细节可自行决定，但契约字段不可变。
- Dependencies：T-MM-002。

## T-MM-004 发布验证

- Outcome：完成回归测试、构建和三视口冒烟，形成证据。
- Inputs：T-MM-001~003、验收文档。
- Scope：测试脚本、文档证据，不改生产数据。
- Non-goals：不自动部署、不调用生产模型。
- Acceptance：后端测试和前端构建通过，失败项有分类和回滚说明。
- Freedom：测试命令和报告组织可自行选择。
- Dependencies：T-MM-003。

# 4. 风险

若真实模型不支持视觉输入或结构化 JSON，必须回到技术设计调整 provider，不用普通文本生成掩盖缺失。
