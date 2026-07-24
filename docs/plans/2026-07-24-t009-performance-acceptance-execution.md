# T-009 性能验收执行说明

## 1. 背景

`master` 保留了 `compose.benchmark.yml`，但没有文档中引用的受控执行器，无法在不接触生产数据的前提下重复执行 3 并发、5 轮端到端验收。用户已确认仅使用本地白名单样本及现有豆包账户。

## 2. 目标

恢复可审计的 T-009 验收入口，严格按以下门禁判定：OCR 不超过 60 秒、图书 PDF 不超过 180 秒、核心课件不超过 60 秒。每轮并发提交 OCR、PDF、课件各一个，共 5 轮，取每类任务最慢值。

## 3. 方案

执行器为 `scripts/run-authorized-benchmark.ps1`：

- 仅接受 `162157_dadf07c1.jpg` 与 `tiyu_origin.pdf` 的固定 SHA-256；其他文件不上传。
- 仅在显式传入 `-Execute` 后启动隔离 Docker Compose；通过 `BENCHMARK_ENV_FILE` 运行时注入凭据，不写入仓库或结果文件。
- 先在隔离环境准备固定 OCR 9 题和 PDF 目录第一章，此准备阶段不计入样本；每个测量轮次都并发提交 OCR、PDF 与核心课件。
- 轮询至 API 可用终态，并从隔离 SQLite 只读获取阶段耗时；结果仅含状态、耗时、页数、题数和幻灯片数。
- 前置准备或任意样本失败时，同一结果目录会落盘仅含阶段、样本完成数和失败状态的脱敏记录；不会保存错误正文、题目、Base64 或密钥。
- 每轮核心课件的扩展任务完成后再开始下一轮，避免上轮异步任务污染下一轮的三任务负载。扩展耗时不计入核心课件 60 秒门禁。

示例：

```powershell
pwsh -NoProfile -File .\scripts\run-authorized-benchmark.ps1 `
  -BenchmarkEnvFile D:\devops\twinkle\.env `
  -SampleRoot D:\devops\twinkle `
  -Cycles 5 -Execute
```

## 4. 风险

- 验收会消耗豆包模型额度。脚本不重试失败样本，失败结果应直接阻断发布。
- 此隔离环境验证 API 达到结果可用终态；当前 Docker Compose 不包含前端浏览器渲染，因此结果记录的 `totalMs` 以用户提交到轮询观察到可用结果为准。生产端前端轮询和页面展示仍需另行人工复核，不能据此伪造前端渲染耗时。
- 灰度开关、监控仪表盘、回滚演练已由用户明确从本次 T-009 范围移除，未实现。

## 5. 回滚

脚本总是在 `finally` 中执行 `docker compose down --volumes --remove-orphans`，仅删除名为 `twinkle-benchmark` 的隔离容器和卷。它不引用生产 Compose、生产容器或生产数据卷。移除脚本即可回到当前应用行为，业务代码无须回滚。

## 6. FAQ

### 为什么不删除 `compose.benchmark.yml`？

它被执行器用于隔离卷、独立端口和运行时凭据注入，是当前验收的必要组成，不是无用历史文件。

### 为什么没有删除 `run-authorized-benchmark.ps1`？

该文件此前不在 `master`，但基线文档和 T-001 交付均要求其承担白名单与脱敏职责。恢复它能补齐验收缺口；删除会使 Compose 无法形成可重复的端到端证据。
