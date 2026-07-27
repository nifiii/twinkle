[CmdletBinding()]
param(
  [ValidateSet('doubao-1.5-vision-lite-250315', 'doubao-seed-1-6-vision-250815', 'doubao-seed-2-0-mini-260428', 'doubao-seed-2-0-lite-260428')]
  [string]$Model = 'doubao-seed-2-0-mini-260428',
  [ValidateRange(1000, 8000)]
  [int]$MaxOutputTokens = 4000,
  [string]$EnvFile = '.env',
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fixturePath = Join-Path $projectRoot '162157_dadf07c1.jpg'
$fixtureHash = '79CBE341D981EDFF0FB302C801C8B0BF5BFA670AE42A259A0EB72D0EC5DF8DB2'
$resultsDir = Join-Path $projectRoot 'artifacts\benchmark'

function Get-EnvValue {
  param([string]$Path, [string]$Name)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Environment file not found: $Path"
  }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match "^\s*$Name\s*=\s*(.+?)\s*$") {
      return $Matches[1].Trim('"', "'")
    }
  }
  throw "$Name is missing from the benchmark environment."
}

function Get-ResponsesText {
  param($Response)

  if ($Response.output_text) { return [string]$Response.output_text }
  $parts = @()
  foreach ($item in @($Response.output)) {
    foreach ($content in @($item.content)) {
      if ($content.text) { $parts += [string]$content.text }
    }
  }
  return $parts -join ''
}

function Assert-StructuredResult {
  param($Result)

  $requiredTopLevel = @('type', 'subject', 'chapter_hint', 'content_markdown', 'problems')
  foreach ($field in $requiredTopLevel) {
    if ($null -eq $Result.$field) { throw "Missing top-level field: $field" }
  }
  if (@($Result.problems).Count -ne 9) {
    throw "Expected 9 structured problems for the fixed sample, got $(@($Result.problems).Count)."
  }
  $requiredProblemFields = @('questionNumber', 'content', 'studentAnswer', 'standardAnswer', 'teacherComment', 'knowledgePoints', 'status')
  foreach ($problem in @($Result.problems)) {
    foreach ($field in $requiredProblemFields) {
      if ($null -eq $problem.$field) { throw "Problem $($problem.questionNumber) is missing $field" }
    }
    if ([string]::IsNullOrWhiteSpace([string]$problem.content)) {
      throw "Problem $($problem.questionNumber) has no self-contained content."
    }
  }
}

if (-not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) {
  throw 'The approved OCR fixture is missing.'
}
if ((Get-FileHash -LiteralPath $fixturePath -Algorithm SHA256).Hash -ne $fixtureHash) {
  throw 'Refusing to send a fixture whose SHA-256 does not match the approved OCR sample.'
}

$envPath = (Resolve-Path -LiteralPath (Join-Path $projectRoot $EnvFile)).Path
$apiKey = Get-EnvValue -Path $envPath -Name 'ARK_API_KEY'
Write-Output "Validated approved OCR fixture for model $Model. No data was sent."
if (-not $Execute) {
  Write-Output 'Pass -Execute to send the approved JPG to the selected account model.'
  exit 0
}

# Why: this contract keeps every field required by save-scanned-item while
# eliminating duplicated page furniture and non-actionable visual narration.
$instruction = @'
将这张试卷转为一个合法 JSON 对象，不要 Markdown 围栏或解释。目标是可保存的试卷和错题，不是逐字数字孪生。
顶层必须为：type, subject, chapter_hint, content_markdown, problems。
problems 必须正好逐题输出。每题必须有 questionNumber、content、studentAnswer、standardAnswer、teacherComment、knowledgePoints、status。
每个字段都必须出现；没有内容时显式输出空字符串或空数组，绝不省略字段。content 必须自包含解题需要的共同材料、题干和选项；除非共同材料不可省略，否则每题不超过 120 个汉字。不要重复页眉、页码、装饰、非必要插图描述或同一指导语。studentAnswer 和 teacherComment 仅保留图片中真实可见内容，无则空字符串，批注不超过 20 个汉字。standardAnswer 只给结论，不超过 20 个汉字；knowledgePoints 只保留一个最关键点。status 仅为 correct、wrong 或 corrected。content_markdown 只列题号，绝不重复 problems 的题干。所有字符串使用中文 Markdown，不使用 HTML。
'@

$imageData = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($fixturePath))
$payload = @{
  model = $Model
  input = @(
    @{ role = 'system'; content = @(@{ type = 'input_text'; text = $instruction }) },
    @{ role = 'user'; content = @(
      @{ type = 'input_image'; image_url = "data:image/jpeg;base64,$imageData" },
      @{ type = 'input_text'; text = '严格输出紧凑 JSON。' }
    ) }
  )
  temperature = 0
  max_output_tokens = $MaxOutputTokens
}

$timer = [System.Diagnostics.Stopwatch]::StartNew()
$client = [System.Net.Http.HttpClient]::new()
try {
  $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, 'https://ark.cn-beijing.volces.com/api/v3/responses')
  $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $apiKey)
  $request.Content = [System.Net.Http.StringContent]::new(($payload | ConvertTo-Json -Depth 12 -Compress), [System.Text.Encoding]::UTF8, 'application/json')
  $response = $client.Send($request)
  $raw = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  $timer.Stop()
  if (-not $response.IsSuccessStatusCode) {
    throw "Model probe failed with HTTP $([int]$response.StatusCode): $raw"
  }

  $apiResponse = $raw | ConvertFrom-Json
  $text = Get-ResponsesText -Response $apiResponse
  $validationError = $null
  $json = $null
  try {
    $json = $text.Trim().Replace('```json', '').Replace('```', '') | ConvertFrom-Json
    Assert-StructuredResult -Result $json
  } catch {
    $validationError = $_.Exception.Message
  }

  New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null
  $resultPath = Join-Path $resultsDir ("ocr-model-probe-{0}-{1}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'), [guid]::NewGuid().ToString('N').Substring(0, 8))
  [ordered]@{
    measuredAt = (Get-Date).ToString('o')
    model = $Model
    maxOutputTokens = $MaxOutputTokens
    totalMs = $timer.ElapsedMilliseconds
    inputTokens = $apiResponse.usage.input_tokens
    outputTokens = $apiResponse.usage.output_tokens
    structuredProblemCount = if ($json) { @($json.problems).Count } else { $null }
    valid = $null -eq $validationError
    validationError = $validationError
  } | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding utf8
  Write-Output "Model probe result written to $resultPath"
  if ($validationError) { throw $validationError }
} finally {
  $client.Dispose()
}
