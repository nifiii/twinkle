# 英语听力适龄与复听：技术设计（Gate 4）

状态：已确认（Gate 4；专用可控语速适配器）

## 1. 背景

现有学习包只把章节标题和正文传给生成器；播放进度以 `completedPlays < 2` 作为禁播条件，TTS 缓存键只有包 ID 与片段序号。三处都不足以实现适龄语速与无限复听。

## 2. 目标

在不改变教材范围、家庭资料上下文和学习任务索引的前提下，为英语听力增加可审查年级档、受控音频速度档和首播解锁状态。

## 3. 方案

```text
books.grade + selected chapter excerpt
  -> grade profile resolver (1-2 / 3-4 / 5-6)
  -> original-listening generator (profile constrained JSON)
  -> learning_packages.contentJson (immutable profile + content + audio profiles)
  -> ControlledRateTtsAdapter (base audio + verified speed render + speed-specific cache)
  -> learning_package_progress (completed plays, firstCompletedAt, submittedAt)
  -> task detail / LearningPackage UI
```

### 模块与数据责任

| 模块 | 允许变化 | 保持不变 |
| --- | --- | --- |
| `learningPackageService` | 解析教材年级、建立档位、校验模型输出、无上限更新播放进度。 | 教材/章节可见性、英语学科校验、原创与正文最小长度要求。 |
| `tts` 路由 | 将英语听力的受控速度档交给 `ControlledRateTtsAdapter`，速度纳入缓存身份。 | 不暴露密钥、不接受客户端自定义任意倍率或供应商配置。 |
| `ControlledRateTtsAdapter` | 用标准母音频渲染、校验和缓存三档 MP3。 | 不生成脚本、不判断题目解锁、不改变课件朗读。 |
| `learning_package_progress` | 追加 `firstCompletedAt`；保留 `completedPlays` 作为分析计数。 | `ownerId + packageId` 唯一、`submittedAt` 幂等。 |
| `LearningPackage` | 服务端状态驱动解锁与速度切换。 | 不前端推导年级、答案或权限。 |

### 不变量与迁移

- `gradeProfile` 写进 `contentJson`，内容创建后不可修改。旧包读取时从 `books.grade` 解析回退档，无法解析则使用兼容的 `legacy` 标识和标准速度。
- `firstCompletedAt IS NOT NULL` 是题目与文本解锁唯一服务端条件。`completedPlays` 不再限制 `canPlay`，并允许递增。
- TTS 速度只接受 `slow`、`standard`、`fast` 三个枚举，分别映射 `0.75x`、`1.00x`、`1.10x`。`ControlledRateTtsAdapter` 先合成标准母音频，再用镜像内 FFmpeg `atempo` 渲染慢速/加快档；不得直接信任客户端传入倍率、音色或供应商参数。
- 缓存身份至少包含包 ID、脚本文本哈希、速度档、TTS 配置版本与片段号。速度不一致、脚本变化或配置升级均不能命中旧缓存。
- 模型结构必须返回 `script`、题目、答案、解析、评分点；再由服务端验证与档位限制一致。校验失败时事务回滚，不插入学习包或任务链接。

### 兼容、观测与回滚

- `GET` 仍返回既有 `content.listening.script/questions` 与 `playback.completedPlays/submittedAt/canPlay`；新增字段是可选扩展，`canPlay` 恒为 `true`。
- 记录脱敏的 `packageId`、年级档、速度档、缓存命中、首播解锁和 TTS 错误码；不记录教材正文、脚本全文、答案或密钥。
- 迁移先追加列，应用可读取新旧数据。回滚时旧应用仍能忽略新 `contentJson` 字段；已生成的速度缓存可保留并由数据目录清理策略处理。

## 4. 风险

### 已验证问题与解决设计

使用当前 `.env` 配置、同一段自造的 52 词英文、每档连续合成 3 次，探测 `audio_params.speed_ratio`。`0.75x`、`1.00x`、`1.10x` 的平均 MP3 时长依次为 `22.208s`、`22.008s`、`23.016s`，不呈从慢到快的单调关系。短句探测亦出现 `0.75x` 短于 `1.00x` 的结果。

结论：当前路由所使用的 TTS V3 参数不能证明可控制实际语速。该偏差已按 **5. 技术架构问题** 回到 Gate 4，并由 [专用可控语速 TTS 适配器 ADR](2026-08-05-controlled-rate-tts-adr.md) 给出替代设计：火山只生成标准母音频，服务端 FFmpeg `atempo` 生成并由 `ffprobe` 时长门禁验证三档文件。不得用仅前端标签、未知参数或未经验证的 `Audio.playbackRate` 替代。

本 Gate 确认后，T-EL-002 至 T-EL-004 才可恢复；T-EL-001 仍按原顺序先执行。
