# 英语听力适龄与复听：API 契约（Gate 4）

状态：已确认（Gate 4；2026-08-05）

## 1. 背景

接口要保留现有学习包消费方，同时让新页面可验证年级档、首播解锁与实际速度档。

## 2. 目标

定义新增字段与事件，不以 `ownerId` 宣称服务端安全隔离。

## 3. 方案

### 创建与读取

`POST /api/learning-packages` 的请求保持 `{ ownerId, bookId, chapterIds, kind: "english-listening" }`，客户端不得提交年级、脚本、速度或课程标准文本。

成功读取的听力包新增以下可选字段：

```json
{
  "content": {
    "original": true,
    "gradeProfile": { "id": "g3_4", "label": "发展档", "source": "textbook_grade_plus_curriculum_2022_general" },
    "listening": { "script": "...", "questions": [{ "id": "q1", "prompt": "...", "answer": "...", "explanation": "...", "rubricPoints": ["..."] }] },
    "audioProfiles": {
      "slow": { "label": "慢速", "request": { "text": "...", "coursewareId": "...", "chunkIdx": 0, "speed": "slow" } },
      "standard": { "label": "标准", "request": { "text": "...", "coursewareId": "...", "chunkIdx": 0, "speed": "standard" } },
      "fast": { "label": "加快", "request": { "text": "...", "coursewareId": "...", "chunkIdx": 0, "speed": "fast" } }
    }
  },
  "playback": { "completedPlays": 1, "firstCompletedAt": 1785899000000, "submittedAt": null, "answers": {}, "canPlay": true, "transcriptUnlocked": true, "questionsUnlocked": true }
}
```

### 播放与提交

`POST /api/learning-packages/:id/playback`

请求：`{ "ownerId": "child_1", "event": "completed" | "submit", "answers"?: { "q1": "B" } }`。

- `completed`：每次完整播放递增计数；首次写入 `firstCompletedAt`，永不因累计次数拒绝。
- `submit`：若尚未 `firstCompletedAt`，返回 `400`、`errorCode: "listening_not_played"`；否则校验 `answers` 的题目 ID 属于当前包，原子写入 `submittedAt` 与首个答案快照。重复提交保留原 `answers`，不覆盖学生已提交内容。
- 读取和返回 `canPlay: true`；不返回 `playsRemaining`。为兼容旧客户端可暂时返回 `playsRemaining: null`，新页面不得显示它。

`POST /api/tts`

请求新增受控字段 `speed: "slow" | "standard" | "fast"`。它们固定映射 `0.75x`、`1.00x`、`1.10x`；仅 `coursewareId` 属于英语听力包时进入 `ControlledRateTtsAdapter`。适配器返回经过服务器端渲染及 `ffprobe` 校验的 MP3；缺省时保留现有课件 TTS 的标准行为；非法枚举返回 `400`。响应可增加 `{ "speed": "slow", "renderer": "controlled-rate-v1", "cacheKeyVersion": 2 }`，不得返回供应商配置或密钥。

### 错误码

| HTTP | `errorCode` | 含义 |
| --- | --- | --- |
| 400 | `invalid_textbook_grade` | 选中英语教材没有可映射的 1-6 年级。 |
| 400 | `listening_not_played` | 首播尚未完成，不能提交。 |
| 400 | `invalid_audio_speed` | 非受控速度枚举。 |
| 422 | `invalid_listening_profile_output` | 模型输出不符合年级档或完整结构。 |
| 502 | `tts_speed_unavailable` | 当前速度档的 TTS 生成失败。 |

## 4. 风险

`ownerId` 仍仅是家庭单设备资料上下文，不构成认证或隔离承诺。旧客户端依赖 `playsRemaining` 时需要在任务 T-EL-003 中删除其显示后再移除字段。
