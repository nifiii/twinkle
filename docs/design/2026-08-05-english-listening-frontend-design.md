# 英语听力适龄与复听：前端契约（Gate 3）

状态：已确认并实施（2026-08-05）

## 1. 背景

现有 `LearningPackage` 把“剩余播放次数”作为主状态，且仅在提交后显示脚本。新的页面由服务端返回的年级档、播放进度和音频速度契约驱动。

## 2. 目标

前端只消费后端确认的内容与进度，不自行推断年级或题目解锁条件；慢速/标准操作不重新创建学习包。

## 3. 方案

| 组件 | 输入 | 责任 | 不负责 |
| --- | --- | --- | --- |
| `LearningPackage` | 学习包、`playback`、`audioProfiles` | 页面状态、三档速度选择、题目/文本门控、提交反馈 | 推导年级档、组装模型提示词、计算答案。 |
| `ListeningPlayer` | 当前速度档、音频请求、播放状态 | 播放/暂停/重播、切换 0.75x/1.00x/1.10x、首播结束回调与音频错误 | 直接访问 TTS 密钥或本地缓存文件。 |
| `ListeningTranscript` | `transcriptUnlocked`、脚本 | 首播后折叠阅读 | 提交前渲染答案或解析。 |
| `ListeningQuestionSet` | `questionsUnlocked`、`submittedAt`、答案快照、题目 | 作答与提交后的学生答案/参考答案/解析/评分点回顾 | 按字符串自行判分或覆盖已提交快照。 |

前端状态：`loading`、`audio_loading`、`ready_before_first_play`、`ready_to_answer`、`submitting`、`submitted`、`audio_failed`、`task_load_failed`。首播的 `ended` 回调仅发送一次 `event=completed`；后续完整播放仍可记录次数，但不得关闭任何控制或题目。

学习小助手的内容创建统一增加 `creating_content` 与 `creating_timeout` 状态。前者以模态遮罩锁定当前页面，显示服务端请求已提交、正在生成和从请求开始计时的已等待时间；该同步 API 没有模型阶段事件，因此前端不得显示不真实的百分比或内部阶段。满 5 分钟进入 `creating_timeout`，解除遮罩、保留“原请求仍可能完成”的提示并维持当前创建按钮不可重复提交；最终响应仍可把页面更新为成功或失败。

路由保持现有任务详情入口。请求 `POST /api/tts` 时仅由服务端给出的 `audioProfiles[slow|standard].request` 发起；切换时停止并释放旧 `Audio` 对象，成功加载新速度后从 0 秒开始播放。

## 4. 风险

浏览器侧 `Audio.playbackRate` 不能证明源音频为受控语速，也会与缓存身份冲突；前端不能以此代替后端速度档。网络重试不得重复把一次播放结束计为多次首播。
