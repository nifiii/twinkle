[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$BenchmarkEnvFile,

  [Parameter(Mandatory)]
  [string]$SampleRoot,

  [ValidateRange(1, 5)]
  [int]$Cycles = 5,

  [ValidateRange(1024, 65535)]
  [int]$BenchmarkPort = 3107,

  [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $ProjectRoot 'compose.benchmark.yml'
$ResultRoot = Join-Path $ProjectRoot 'artifacts/benchmark'
$OwnerId = 'benchmark'
$PollIntervalMs = 500
$TimeoutMs = 600000
$AllowedSamples = @{
  '162157_dadf07c1.jpg' = '79CBE341D981EDFF0FB302C801C8B0BF5BFA670AE42A259A0EB72D0EC5DF8DB2'
  'tiyu_origin.pdf' = '6C5E8BF7DD7FD4E3E7854E28700FCC8A9ED86FA9967EA1E1A7EAB56DE7426F47'
}

function Get-SamplePath([string]$Name) {
  $path = Join-Path $SampleRoot $Name
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "缺少已授权样本: $path"
  }
  $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  if ($hash -ne $AllowedSamples[$Name]) {
    throw "样本哈希不在授权白名单中: $Name"
  }
  return (Resolve-Path -LiteralPath $path).Path
}

function Invoke-Compose([string[]]$Arguments) {
  & docker compose --project-name twinkle-benchmark --file $ComposeFile @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose 失败: $($Arguments -join ' ')" }
}

function Get-JsonFromResponse([System.Net.Http.HttpResponseMessage]$Response) {
  $body = $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  if (-not $Response.IsSuccessStatusCode) {
    throw "HTTP $([int]$Response.StatusCode): $body"
  }
  if ([string]::IsNullOrWhiteSpace($body)) { throw '服务返回了空响应' }
  return $body | ConvertFrom-Json
}

function Invoke-Json([System.Net.Http.HttpClient]$Client, [string]$Url, [object]$Body) {
  $json = $Body | ConvertTo-Json -Depth 20 -Compress
  $content = [System.Net.Http.StringContent]::new($json, [Text.Encoding]::UTF8, 'application/json')
  return Get-JsonFromResponse ($Client.PostAsync($Url, $content).GetAwaiter().GetResult())
}

function Get-Json([System.Net.Http.HttpClient]$Client, [string]$Url) {
  return Get-JsonFromResponse ($Client.GetAsync($Url).GetAwaiter().GetResult())
}

function Wait-ForHealth([System.Net.Http.HttpClient]$Client, [string]$BaseUrl) {
  $deadline = [Environment]::TickCount64 + 120000
  while ([Environment]::TickCount64 -lt $deadline) {
    try {
      $health = Get-Json $Client "$BaseUrl/api/health"
      if ($health.status -eq 'ok') { return }
    } catch { }
    Start-Sleep -Milliseconds 1000
  }
  throw '基准容器未在 120 秒内通过健康检查'
}

function Wait-ForJob(
  [System.Net.Http.HttpClient]$Client,
  [string]$Url,
  [ValidateSet('ocr', 'book', 'courseware')][string]$Kind,
  [Int64]$StartedAtMs
) {
  $deadline = [Environment]::TickCount64 + $TimeoutMs
  while ([Environment]::TickCount64 -lt $deadline) {
    $response = Get-Json $Client $Url
    $data = $response.data
    $terminal = if ($Kind -eq 'ocr') {
      $data.status -in @('success', 'failed')
    } else {
      $data.status -in @('completed', 'failed', 'cancelled')
    }
    if ($terminal) {
      $elapsed = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $StartedAtMs
      if ($Kind -eq 'ocr') {
        if ($data.status -ne 'success') { throw "OCR 任务失败: $($data.error)" }
      } elseif ($data.status -ne 'completed') {
        throw "$Kind 任务失败: $($data.error)"
      }
      return [pscustomobject]@{ Data = $data; TotalMs = $elapsed }
    }
    Start-Sleep -Milliseconds $PollIntervalMs
  }
  throw "$Kind 任务在 $TimeoutMs ms 内未完成"
}

function Get-JobStages([string]$JobId) {
  if ($JobId -notmatch '^[0-9a-fA-F-]{36}$') { throw '任务 ID 格式异常' }
  $node = @'
import Database from 'better-sqlite3';
const db = new Database('/opt/twinkle/benchmark-data/hlos.db', { readonly: true });
const row = db.prepare('SELECT status, createdAt, startedAt, completedAt, stageTimingsJson FROM jobs WHERE id = ?').get(process.argv[1]);
if (!row) process.exitCode = 2;
else console.log(JSON.stringify(row));
'@
  $output = & docker compose --project-name twinkle-benchmark --file $ComposeFile exec -T app node --input-type=module -e $node $JobId
  if ($LASTEXITCODE -ne 0) { throw "无法读取隔离任务阶段记录: $JobId" }
  $row = ($output | Out-String | ConvertFrom-Json)
  $timings = $row.stageTimingsJson | ConvertFrom-Json
  return [pscustomobject]@{
    Status = $row.status
    CreatedAt = $row.createdAt
    StartedAt = $row.startedAt
    CompletedAt = $row.completedAt
    Stages = $timings
  }
}

function Assert-OcrResult([object]$Data) {
  $problems = @($Data.result.meta.problems)
  if ($problems.Count -ne 9) { throw "OCR 结构化题目数异常: 期望 9，实际 $($problems.Count)" }
  foreach ($problem in $problems) {
    foreach ($field in @('questionNumber', 'content', 'studentAnswer', 'standardAnswer', 'teacherComment', 'knowledgePoints', 'status')) {
      if ($null -eq $problem.$field -or [string]::IsNullOrWhiteSpace([string]$problem.$field)) {
        throw "OCR 结构化结果缺少字段: $field"
      }
    }
  }
  return $problems
}

function Get-FirstChapter([object]$TableOfContents) {
  foreach ($item in @($TableOfContents)) {
    if ($item -is [string] -and -not [string]::IsNullOrWhiteSpace($item)) { return $item }
    foreach ($field in @('title', 'name', 'chapter')) {
      if ($null -ne $item.$field -and -not [string]::IsNullOrWhiteSpace([string]$item.$field)) { return [string]$item.$field }
    }
  }
  throw '图书解析结果没有可用目录第一章，不能构造已确认的课件夹具'
}

function Assert-CoreCourseware([object]$Data) {
  $result = $Data.result
  if ($result.phase -ne 'core') { throw '课件结果不是核心课件' }
  $slides = @($result.slides)
  if ($slides.Count -ne 5) { throw "核心课件节数异常: 期望 5，实际 $($slides.Count)" }
  foreach ($slide in $slides) {
    $length = ([string]$slide.content).Length
    if ($length -lt 120 -or $length -gt 180) { throw "核心课件正文长度异常: $length" }
  }
  return $result
}

function Get-ElapsedRecord([string]$Kind, [string]$TaskId, [object]$Completed, [object]$Validation) {
  $stages = Get-JobStages $TaskId
  return [ordered]@{
    kind = $Kind
    taskId = $TaskId
    totalMs = $Completed.TotalMs
    stageTimings = $stages.Stages
    validation = $Validation
  }
}

if (-not $Execute) {
  throw '此脚本会调用外部模型。请显式传入 -Execute 后执行。'
}
if (-not (Test-Path -LiteralPath $BenchmarkEnvFile -PathType Leaf)) { throw "未找到凭据文件: $BenchmarkEnvFile" }
if (-not (Test-Path -LiteralPath $ComposeFile -PathType Leaf)) { throw "未找到 Compose 文件: $ComposeFile" }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw '未找到 docker 命令' }

$jpgPath = Get-SamplePath '162157_dadf07c1.jpg'
$pdfPath = Get-SamplePath 'tiyu_origin.pdf'
$jpgDataUrl = "data:image/jpeg;base64,$([Convert]::ToBase64String([IO.File]::ReadAllBytes($jpgPath)))"
$baseUrl = "http://127.0.0.1:$BenchmarkPort"
$previousEnv = @{
  BENCHMARK_ENV_FILE = $env:BENCHMARK_ENV_FILE
  BENCHMARK_PORT = $env:BENCHMARK_PORT
}
$env:BENCHMARK_ENV_FILE = (Resolve-Path -LiteralPath $BenchmarkEnvFile).Path
$env:BENCHMARK_PORT = [string]$BenchmarkPort
$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromMinutes(11)
$records = [System.Collections.Generic.List[object]]::new()
$phase = 'startup'
$resultPath = Join-Path $ResultRoot ("t009-mixed-3x$Cycles-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')

try {
  New-Item -ItemType Directory -Force -Path $ResultRoot | Out-Null
  Invoke-Compose @('up', '--build', '--detach')
  Wait-ForHealth $client $baseUrl

  # Why: courseware must use this exact OCR/PDF context, but setup is excluded
  # from measured cycles so it cannot hide any user-facing task latency.
  $phase = 'prepare_ocr'
  $setupOcrStart = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $setupOcr = Invoke-Json $client "$baseUrl/api/analyze-image" @{ base64Image = $jpgDataUrl; ownerId = $OwnerId }
  if (-not $setupOcr.success -or -not $setupOcr.data.taskId) { throw 'OCR 夹具提交失败' }
  $setupOcrDone = Wait-ForJob $client "$baseUrl/api/analyze-task/$($setupOcr.data.taskId)" 'ocr' $setupOcrStart
  $fixedProblems = Assert-OcrResult $setupOcrDone.Data

  $phase = 'prepare_book'
  $setupBookStart = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $setupForm = [System.Net.Http.MultipartFormDataContent]::new()
  $setupStream = [System.Net.Http.StreamContent]::new([IO.File]::OpenRead($pdfPath))
  $setupStream.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('application/pdf')
  $setupForm.Add($setupStream, 'file', 'tiyu_origin.pdf')
  $setupForm.Add([System.Net.Http.StringContent]::new($OwnerId), 'ownerId')
  $setupBook = Get-JsonFromResponse ($client.PostAsync("$baseUrl/api/upload-book", $setupForm).GetAwaiter().GetResult())
  $setupForm.Dispose()
  if (-not $setupBook.success -or -not $setupBook.data.taskId) { throw '图书夹具提交失败' }
  $setupBookDone = Wait-ForJob $client "$baseUrl/api/upload-book/task/$($setupBook.data.taskId)?ownerId=$OwnerId" 'book' $setupBookStart
  $bookResult = $setupBookDone.Data.result
  if ($bookResult.pageCount -ne 50) { throw "图书页数异常: 期望 50，实际 $($bookResult.pageCount)" }
  $chapter = Get-FirstChapter $bookResult.metadata.tableOfContents
  $coursewareInput = @{
    bookTitle = [string]$bookResult.metadata.title
    chapter = $chapter
    chapters = @($chapter)
    studentName = '性能验收学生'
    subject = [string]$bookResult.metadata.subject
    teachingStyle = 'rigorous'
    wrongProblems = @(@{ meta = @{ problems = $fixedProblems } })
    ownerId = $OwnerId
  }

  for ($cycle = 1; $cycle -le $Cycles; $cycle++) {
    $phase = "cycle_$cycle"
    $submittedAt = @{}
    $submittedAt.ocr = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $ocrContent = [System.Net.Http.StringContent]::new((@{ base64Image = $jpgDataUrl; ownerId = $OwnerId } | ConvertTo-Json -Compress), [Text.Encoding]::UTF8, 'application/json')
    $ocrRequest = $client.PostAsync("$baseUrl/api/analyze-image", $ocrContent)

    $submittedAt.courseware = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $coursewareContent = [System.Net.Http.StringContent]::new(($coursewareInput | ConvertTo-Json -Depth 20 -Compress), [Text.Encoding]::UTF8, 'application/json')
    $coursewareRequest = $client.PostAsync("$baseUrl/api/generate-courseware", $coursewareContent)

    $submittedAt.book = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $bookForm = [System.Net.Http.MultipartFormDataContent]::new()
    $bookStream = [System.Net.Http.StreamContent]::new([IO.File]::OpenRead($pdfPath))
    $bookStream.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('application/pdf')
    $bookForm.Add($bookStream, 'file', 'tiyu_origin.pdf')
    $bookForm.Add([System.Net.Http.StringContent]::new($OwnerId), 'ownerId')
    $bookRequest = $client.PostAsync("$baseUrl/api/upload-book", $bookForm)

    $ocrSubmission = Get-JsonFromResponse ($ocrRequest.GetAwaiter().GetResult())
    $coursewareSubmission = Get-JsonFromResponse ($coursewareRequest.GetAwaiter().GetResult())
    $bookSubmission = Get-JsonFromResponse ($bookRequest.GetAwaiter().GetResult())
    $bookForm.Dispose()
    $spreadMs = ($submittedAt.Values | Measure-Object -Maximum).Maximum - ($submittedAt.Values | Measure-Object -Minimum).Minimum
    if ($spreadMs -gt 2000) { throw "第 $cycle 轮提交窗口超过 2 秒: $spreadMs ms" }
    if (-not $ocrSubmission.success -or -not $coursewareSubmission.success -or -not $bookSubmission.success) { throw "第 $cycle 轮存在未接受的任务" }

    $ocrDone = Wait-ForJob $client "$baseUrl/api/analyze-task/$($ocrSubmission.data.taskId)" 'ocr' $submittedAt.ocr
    $coursewareDone = Wait-ForJob $client "$baseUrl/api/generate-courseware/task/$($coursewareSubmission.data.taskId)?ownerId=$OwnerId" 'courseware' $submittedAt.courseware
    $bookDone = Wait-ForJob $client "$baseUrl/api/upload-book/task/$($bookSubmission.data.taskId)?ownerId=$OwnerId" 'book' $submittedAt.book
    $cycleRecord = [ordered]@{
      cycle = $cycle
      submissionSpreadMs = $spreadMs
      ocr = Get-ElapsedRecord 'ocr' $ocrSubmission.data.taskId $ocrDone @{ problemCount = (Assert-OcrResult $ocrDone.Data).Count; saveable = $true }
      courseware = Get-ElapsedRecord 'courseware' $coursewareSubmission.data.taskId $coursewareDone @{ slideCount = (Assert-CoreCourseware $coursewareDone.Data).slides.Count; coreSaved = $true }
      book = Get-ElapsedRecord 'book' $bookSubmission.data.taskId $bookDone @{ pageCount = $bookDone.Data.result.pageCount; available = $true }
    }
    $records.Add($cycleRecord)

    $extensionJobId = (Assert-CoreCourseware $coursewareDone.Data).extensionJobId
    if ($extensionJobId) {
      $null = Wait-ForJob $client "$baseUrl/api/generate-courseware/task/$extensionJobId?ownerId=$OwnerId" 'courseware' ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    }
  }

  $phase = 'evaluate'
  $summary = [ordered]@{
    generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    environment = 'isolated-docker-compose'
    cycles = $Cycles
    thresholdsMs = @{ ocr = 60000; book = 180000; coursewareCore = 60000 }
    worstMs = @{
      ocr = ($records | ForEach-Object { $_.ocr.totalMs } | Measure-Object -Maximum).Maximum
      book = ($records | ForEach-Object { $_.book.totalMs } | Measure-Object -Maximum).Maximum
      coursewareCore = ($records | ForEach-Object { $_.courseware.totalMs } | Measure-Object -Maximum).Maximum
    }
    samples = $records
  }
  $summary.passed = $summary.worstMs.ocr -le $summary.thresholdsMs.ocr -and $summary.worstMs.book -le $summary.thresholdsMs.book -and $summary.worstMs.coursewareCore -le $summary.thresholdsMs.coursewareCore
  $summary | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $resultPath -Encoding utf8
  Write-Host "验收结果: $resultPath"
  if (-not $summary.passed) { throw 'T-009 性能门禁未通过；结果已保存，不应发布。' }
} catch {
  # Why: a failed gate is evidence, not a reason to retain credentials, payloads,
  # or the disposable container. The result deliberately omits the raw error.
  $failure = [ordered]@{
    generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    environment = 'isolated-docker-compose'
    cycles = $Cycles
    status = 'failed'
    phase = $phase
    samplesCompleted = $records.Count
  }
  New-Item -ItemType Directory -Force -Path $ResultRoot | Out-Null
  $failure | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $resultPath -Encoding utf8
  Write-Host "失败验收记录: $resultPath"
  throw
} finally {
  $client.Dispose()
  try { Invoke-Compose @('down', '--volumes', '--remove-orphans') } catch { Write-Warning $_ }
  $env:BENCHMARK_ENV_FILE = $previousEnv.BENCHMARK_ENV_FILE
  $env:BENCHMARK_PORT = $previousEnv.BENCHMARK_PORT
}
