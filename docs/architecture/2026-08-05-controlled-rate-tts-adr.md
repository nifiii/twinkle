# ADR：专用可控语速 TTS 适配器

状态：已确认（Gate 4；2026-08-05）

## 1. 背景

当前火山 TTS V3 的 `audio_params.speed_ratio` 在真实重复探测中无法稳定改变音频时长，因此不能作为学生听力三档语速的技术基础。继续猜测供应商参数会使页面显示的速度与实际音频不一致。

## 2. 目标

为英语听力生成可证明为 `0.75x`、`1.00x`、`1.10x` 的服务端音频文件，同时不改变现有课件朗读的音色、请求或缓存行为。

## 3. 方案

采用 `ControlledRateTtsAdapter`，只服务 `english-listening`：

```text
学习包脚本 + 听力包 ID + speed enum
  -> VolcanoBaseTtsAdapter（只合成 1.00x 母音频）
  -> ControlledRateTtsAdapter
       standard: 原样复用母音频
       slow:     FFmpeg atempo=0.75
       fast:     FFmpeg atempo=1.10
  -> FFprobe 时长校验
  -> 速度隔离缓存 MP3
```

### 固定契约

| 项目 | 决策 |
| --- | --- |
| 适用范围 | 仅 `english-listening` 有 `speed` 时进入适配器；现有课件请求未携带 `speed`，保持原 `tts.ts` 路径。 |
| 速度枚举 | `slow=0.75`、`standard=1.00`、`fast=1.10`。客户端不能传任意倍率。 |
| 母音频 | 始终用火山当前配置合成一次标准 MP3；不再向火山传未验证的速度参数。 |
| 转码 | 仅使用 `atempo`，三个倍率均在单次滤镜的安全区间 `0.5-2.0` 内。 |
| 质量门禁 | 用 `ffprobe` 读取实际时长。慢速必须落在 `standard / 0.75` 的 ±8%，加快必须落在 `standard / 1.10` 的 ±8%；失败不写入速度缓存。 |
| 缓存身份 | `packageId + scriptSha256 + voiceProfileFingerprint + rendererVersion + speed`。`voiceProfileFingerprint` 只哈希资源 ID、集群、音色和非密钥版本标识。 |
| 失败 | 母音频失败返回既有 TTS 错误；转码/校验失败返回 `tts_speed_unavailable`，不回退到错误速度或浏览器变速。 |
| 镜像 | 后端运行镜像安装 `ffmpeg`，启动/健康自检确认 `ffmpeg`、`ffprobe` 与 `atempo` 可用。 |

### 数据流与恢复

1. 首次任一速度请求先读取或生成标准母音频。
2. `standard` 直接以母音频建立标准速度缓存记录；`slow`、`fast` 在临时目录转码并校验后原子落盘。
3. 同一缓存键并发请求使用内存 Promise 去重，防止重复调用火山或同时写相同文件。
4. 完整播放只更新学习包进度，与音频生成、转码或缓存无事务耦合。
5. 清理速度缓存只删除可再生文件，不影响学习包、题目、作答或教材。

### 不采用的方案

- 不继续猜测火山 TTS V3 的未验证语速字段。
- 不以浏览器 `Audio.playbackRate` 当作生成音频的速度实现。
- 不把适配器泛化为多供应商平台；当前只有一个真实供应商和一个速度变化需求，单个深模块更易验证和维护。

## 4. 风险

- 镜像增加 FFmpeg 体积和 CVE 维护面；构建必须固定基础镜像版本，并在发布扫描中纳入该系统包。
- `atempo` 会改变语音韵律，尤其慢速档；发布验收包含三名人工听感抽样，但不以主观抽样替代时长门禁。
- 高并发下转码耗 CPU；家庭单设备范围内设每个请求 30 秒超时、每包单飞，超时后只失败当前音频请求。
