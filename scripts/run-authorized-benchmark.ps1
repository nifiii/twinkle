[CmdletBinding()]
param(
  [ValidateSet('ocr', 'pdf', 'all')]
  [string]$Scenario = 'all',
  [string]$EnvFile = '.env',
  [int]$Port = 3107,
  [switch]$Execute,
  [switch]$KeepContainer
)

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$composeFile = Join-Path $projectRoot 'compose.benchmark.yml'
$resultsDir = Join-Path $projectRoot 'artifacts\benchmark'
$projectName = 'twinkle-benchmark'

# These hashes turn the user authorization into an enforceable file allowlist.
$approvedFixtures = @{
  ocr = @{
    Name = '162157_dadf07c1.jpg'
    Hash = '79CBE341D981EDFF0FB302C801C8B0BF5BFA670AE42A259A0EB72D0EC5DF8DB2'
  }
  pdf = @{
    Name = 'tiyu_origin.pdf'
    Hash = '6C5E8BF7DD7FD4E3E7854E28700FCC8A9ED86FA9967EA1E1A7EAB56DE7426F47'
  }
}

function Get-ApprovedFixture {
  param([ValidateSet('ocr', 'pdf')][string]$Kind)

  $fixture = $approvedFixtures[$Kind]
  $expectedPath = Join-Path $projectRoot $fixture.Name
  if (-not (Test-Path -LiteralPath $expectedPath -PathType Leaf)) {
    throw "Missing approved $Kind fixture: $fixture.Name"
  }

  $resolvedPath = (Resolve-Path -LiteralPath $expectedPath).Path
  $actualHash = (Get-FileHash -LiteralPath $resolvedPath -Algorithm SHA256).Hash
  if ($actualHash -ne $fixture.Hash) {
    throw "Refusing to use $fixture.Name because its SHA-256 does not match the approved fixture."
  }

  return Get-Item -LiteralPath $resolvedPath
}

function Get-ConfiguredEnvironmentNames {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Environment file not found: $Path"
  }

  $names = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$' -and $Matches[2].Trim('"', "'").Length -gt 0) {
      $names[$Matches[1]] = $true
    }
  }
  return $names
}

function Assert-BenchmarkConfiguration {
  param([string]$Path)

  $names = Get-ConfiguredEnvironmentNames -Path $Path
  if (-not $names.ContainsKey('ARK_API_KEY')) {
    throw 'Benchmark environment is missing ARK_API_KEY.'
  }
  if (-not $names.ContainsKey('ARK_MODEL_ID') -and -not $names.ContainsKey('ARK_VISION_MODEL_ID')) {
    throw 'Benchmark environment needs ARK_MODEL_ID or ARK_VISION_MODEL_ID.'
  }
}

function Wait-BenchmarkHealth {
  param([string]$BaseUrl)

  $deadline = (Get-Date).AddMinutes(3)
  do {
    try {
      $health = Invoke-RestMethod -Uri "$BaseUrl/api/health" -TimeoutSec 3
      if ($health.status -eq 'ok') { return }
    } catch {
      # The image can spend time compiling native dependencies on its first run.
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  throw 'Benchmark container did not become healthy within three minutes.'
}

function Wait-OcrResult {
  param([string]$BaseUrl, [string]$TaskId)

  $deadline = (Get-Date).AddMinutes(10)
  do {
    Start-Sleep -Seconds 2
    $result = Invoke-RestMethod -Uri "$BaseUrl/api/analyze-task/$TaskId" -TimeoutSec 15
    if ($result.data.status -ne 'pending' -and $result.data.status -ne 'processing') {
      return $result.data
    }
  } while ((Get-Date) -lt $deadline)

  throw "OCR task $TaskId timed out while still processing."
}

function Wait-BookResult {
  param([string]$BaseUrl, [string]$BookId)

  $deadline = (Get-Date).AddMinutes(15)
  do {
    Start-Sleep -Seconds 2
    $result = Invoke-RestMethod -Uri "$BaseUrl/api/books/$BookId" -TimeoutSec 15
    if ($result.data.status -ne 'processing' -and $result.data.status -ne 'pending') {
      return $result.data
    }
  } while ((Get-Date) -lt $deadline)

  throw "Book task $BookId timed out while still processing."
}

function Invoke-MultipartUpload {
  param([string]$Uri, [System.IO.FileInfo]$Fixture)

  # Why: Invoke-RestMethod -Form labels this stream as application/octet-stream,
  # but the production route deliberately accepts a PDF only when its MIME type
  # is application/pdf. Set the part header explicitly to exercise browser-like
  # uploads instead of weakening the server-side file filter for a benchmark.
  $client = [System.Net.Http.HttpClient]::new()
  $form = [System.Net.Http.MultipartFormDataContent]::new()
  $stream = [System.IO.File]::OpenRead($Fixture.FullName)
  $content = [System.Net.Http.StreamContent]::new($stream)
  $content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('application/pdf')
  $form.Add($content, 'file', $Fixture.Name)

  try {
    $response = $client.PostAsync($Uri, $form).GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) {
      throw "Upload failed with HTTP $([int]$response.StatusCode): $body"
    }
    return $body | ConvertFrom-Json
  } finally {
    $content.Dispose()
    $form.Dispose()
    $client.Dispose()
  }
}

function Invoke-OcrBenchmark {
  param([string]$BaseUrl, [System.IO.FileInfo]$Fixture)

  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  $imageBase64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($Fixture.FullName))
  $submitTimer = [System.Diagnostics.Stopwatch]::StartNew()
  $submitted = Invoke-RestMethod -Uri "$BaseUrl/api/analyze-image" -Method Post -ContentType 'application/json' -Body (@{
      base64Image = "data:image/jpeg;base64,$imageBase64"
      ownerId = 'child_1'
    } | ConvertTo-Json -Compress) -TimeoutSec 120
  $submitTimer.Stop()

  $result = Wait-OcrResult -BaseUrl $BaseUrl -TaskId $submitted.data.taskId
  $timer.Stop()
  $problemCount = @($result.result.meta.problems).Count

  return [ordered]@{
    scenario = 'ocr'
    terminalStatus = $result.status
    totalMs = $timer.ElapsedMilliseconds
    submitMs = $submitTimer.ElapsedMilliseconds
    resultSummary = @{ structuredProblemCount = $problemCount }
  }
}

function Invoke-PdfBenchmark {
  param([string]$BaseUrl, [System.IO.FileInfo]$Fixture)

  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  $uploadTimer = [System.Diagnostics.Stopwatch]::StartNew()
  $upload = Invoke-MultipartUpload -Uri "$BaseUrl/api/upload-book" -Fixture $Fixture
  $uploadTimer.Stop()

  $parseTimer = [System.Diagnostics.Stopwatch]::StartNew()
  $parsed = Invoke-RestMethod -Uri "$BaseUrl/api/upload-book/parse" -Method Post -ContentType 'application/json' -Body (@{
      filePath = $upload.data.tempFilePath
      fileName = $upload.data.fileName
    } | ConvertTo-Json -Compress) -TimeoutSec 300
  $parseTimer.Stop()

  $saveTimer = [System.Diagnostics.Stopwatch]::StartNew()
  $saved = Invoke-RestMethod -Uri "$BaseUrl/api/save-book" -Method Post -ContentType 'application/x-www-form-urlencoded' -Body @{
      metadata = ($parsed.data.metadata | ConvertTo-Json -Compress -Depth 16)
      coverImage = $parsed.data.metadata.coverImage
      tempFilePath = $upload.data.tempFilePath
      ownerId = 'child_1'
    } -TimeoutSec 120
  $saveTimer.Stop()

  $book = Wait-BookResult -BaseUrl $BaseUrl -BookId $saved.data.id
  $timer.Stop()

  return [ordered]@{
    scenario = 'pdf'
    terminalStatus = $book.status
    totalMs = $timer.ElapsedMilliseconds
    uploadMs = $uploadTimer.ElapsedMilliseconds
    parseMs = $parseTimer.ElapsedMilliseconds
    saveAcknowledgementMs = $saveTimer.ElapsedMilliseconds
    resultSummary = @{ pageCount = $parsed.data.pageCount }
  }
}

$envPath = (Resolve-Path -LiteralPath (Join-Path $projectRoot $EnvFile)).Path
$requestedKinds = if ($Scenario -eq 'all') { @('ocr', 'pdf') } else { @($Scenario) }
$fixtures = @{}
foreach ($kind in $requestedKinds) {
  $fixtures[$kind] = Get-ApprovedFixture -Kind $kind
}
Assert-BenchmarkConfiguration -Path $envPath

Write-Output "Validated approved fixture(s): $($requestedKinds -join ', '). No data was sent."
if (-not $Execute) {
  Write-Output 'Pass -Execute to start the isolated container and run the authorized benchmark.'
  exit 0
}

$previousEnvFile = $env:BENCHMARK_ENV_FILE
$previousPort = $env:BENCHMARK_PORT
$env:BENCHMARK_ENV_FILE = $envPath
$env:BENCHMARK_PORT = "$Port"
$baseUrl = "http://127.0.0.1:$Port"

try {
  & docker compose -p $projectName -f $composeFile up --build --detach | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Benchmark container build or startup failed (docker compose exit code $LASTEXITCODE)."
  }
  Wait-BenchmarkHealth -BaseUrl $baseUrl

  $records = @()
  foreach ($kind in $requestedKinds) {
    $record = if ($kind -eq 'ocr') {
      Invoke-OcrBenchmark -BaseUrl $baseUrl -Fixture $fixtures[$kind]
    } else {
      Invoke-PdfBenchmark -BaseUrl $baseUrl -Fixture $fixtures[$kind]
    }
    $records += $record
  }

  New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null
  $resultPath = Join-Path $resultsDir ("benchmark-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  [ordered]@{
    measuredAt = (Get-Date).ToString('o')
    target = $baseUrl
    samples = $records
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding utf8
  Write-Output "Benchmark results written to $resultPath"
} finally {
  if (-not $KeepContainer) {
    & docker compose -p $projectName -f $composeFile down --volumes --remove-orphans | Out-Host
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Benchmark cleanup failed (docker compose exit code $LASTEXITCODE)."
    }
  }
  $env:BENCHMARK_ENV_FILE = $previousEnvFile
  $env:BENCHMARK_PORT = $previousPort
}
