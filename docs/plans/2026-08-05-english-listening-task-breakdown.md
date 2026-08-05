# 英语听力适龄与复听：任务分解（Gate 5）

状态：已确认（Gate 5；2026-08-05）

## 1. 背景

本变更替换历史听力的“两次播放限制”，不改变教材来源、原创边界、学习任务索引或其他学习内容。

## 2. 目标

按教材年级生成适龄原创英语听力，支持真实的慢速/标准/加快音频、首播后文本辅助和无限复听。

## 3. 方案

### T-EL-001 年级能力档与原创听力生成

Outcome：后端从当前可见上传英语教材的 1-6 年级解析能力档，把通用课程标准规则传给模型，并拒绝不完整或不合档的原创输出。

Inputs：BR-EL-001 至 BR-EL-003；`2026-08-05-english-listening-prd.md`；AC-EL-001 至 AC-EL-003；`2026-08-05-english-listening-api-contract.md`。

Scope：`learningPackageService`、对应服务测试、英语听力内容 JSON 验证；必要的本地迁移只可追加字段。

Non-goals：不接入广州外部资料，不修改其他学科、教材解析、学习任务索引或前端。

Acceptance：三档夹具分别产生正确 `gradeProfile`；模型输入不含外部资料；无年级、非英语、无章节正文和结构不合格时不持久化半成品。

Freedom：可选择档位解析函数、提示词结构、JSON schema 校验和测试夹具；不得修改档位边界、内容来源、原创限制或错误语义。

Dependencies：无。

### T-EL-002 受控语速 TTS 与无限播放进度

Outcome：每个听力包可提供慢速 `0.75x`、标准 `1.00x`、加快 `1.10x` 三份受控音频请求，缓存不串档；学生任意次数完整播放均可用，首次完成状态持久化。

Inputs：BR-EL-004 至 BR-EL-008；技术设计与 API 契约；AC-EL-004、AC-EL-006 至 AC-EL-008。

Scope：`learningPackageService` 播放进度、`learningDomain` 迁移、`tts` 路由、`ControlledRateTtsAdapter`、Dockerfile 的 FFmpeg 运行依赖和后端/API 测试。

Non-goals：不改变课件朗读的缺省音色或速度，不接受任意速度值，不发送密钥或教材正文到客户端。

Acceptance：`completedPlays` 超过 2 仍返回 `canPlay=true`；首次完成后 `firstCompletedAt` 保持；三档请求/缓存身份不同；在当前 `.env` TTS 配置中确认 `0.75x`、`1.00x`、`1.10x` 实际 MP3 时长符合母音频倍率 ±8%；课件缺省 TTS 回归不变。

Freedom：可选择迁移形态、适配器内部函数、缓存目录与临时文件布局；不得更换火山母音频供应商、以纯前端标签或未验证 `playbackRate` 代替服务端速度档。

Dependencies：T-EL-001；[专用可控语速 TTS 适配器 ADR](../architecture/2026-08-05-controlled-rate-tts-adr.md) 的 Gate 4 确认。

### T-EL-003 听力任务详情与可访问播放体验

Outcome：学生在智慧课堂打开听力任务后，可以慢速/标准/加快播放、无限重播，首播后展开文本并作答，提交后回顾答案与解析。

Inputs：BR-EL-004 至 BR-EL-008；三份 Gate 3 设计文档；API 契约；AC-EL-005 至 AC-EL-010。

Scope：`LearningPackage`、学习包 API 客户端、必要的任务详情适配与前端测试。

Non-goals：不重新生成内容、不前端推导年级、不展示提交前答案/解析、不恢复视频功能或旧 `#learn/*` 路由。

Acceptance：首播前题目/文本不在 DOM；首播后题目和折叠文本出现；提交前答案/解析隐藏；三视口和键盘完整通过；切换速度不改变题目与进度。

Freedom：可拆分播放器/文本/题组组件，选择局部状态和音频资源清理方式；不得改变状态门控、设计令牌、接口字段或无限复听规则。

Dependencies：T-EL-002。

### T-EL-004 回归、发布与回滚证据

Outcome：形成能证明本次变更没有破坏既有课件 TTS、历史听力读取、教材范围和课堂任务入口的发布证据。

Inputs：AC-EL-001 至 AC-EL-010；T-EL-001 至 T-EL-003；现有后端测试与学习任务回归路径。

Scope：自动化测试、浏览器三视口/键盘检查、脱敏 API 证据、发布说明与回滚步骤。

Non-goals：不做生产数据删除、重建历史听力音频、改变学习任务或教材数据。

Acceptance：后端测试、前端构建与浏览器验收均通过；旧听力包可读且不再受两次限制；课件 TTS 缺省请求与缓存行为回归通过；`detect_changes()` 只含本任务允许的流程与文件。

Freedom：可选择既有测试框架、夹具和证据格式；不得放宽任何 AC 或以手工口头结论代替可复核证据。

Dependencies：T-EL-003。

## 4. 风险

| 风险 | 控制 |
| --- | --- |
| TTS 服务没有可验证语速参数 | 已用当前 `.env` 连续探测 `audio_params.speed_ratio`：三档平均时长不单调。专用适配器改为标准母音频加 FFmpeg `atempo`，以 `ffprobe` 时长门禁验证。 |
| 历史客户端仍显示剩余次数 | T-EL-003 与 T-EL-004 覆盖所有入口，确认没有 UI 消费该字段后再移除。 |
| 模型生成看似成功但不适龄 | T-EL-001 用结构和档位校验阻止写入；保留脱敏错误码供重试。 |
