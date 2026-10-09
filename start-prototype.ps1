[CmdletBinding()]
param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$appId = 'credit-settlement-system-prototype'
$ports = 8081..8090

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  $bundledNode = 'C:\Users\Zhu\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
  if (Test-Path -LiteralPath $bundledNode) {
    $nodeExe = $bundledNode
  } else {
    throw '未找到 Node.js。请先安装 Node.js，或直接双击 index.html。'
  }
} else {
  $nodeExe = $nodeCommand.Source
}

function Get-PrototypeHealth {
  param([int]$Port)
  try {
    $health = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/__health" -f $Port) -Method Get -TimeoutSec 1
    if ($health.ok -and $health.app -eq $appId) {
      $healthRoot = [IO.Path]::GetFullPath([string]$health.root).TrimEnd('\')
      if ($healthRoot -eq $projectRoot) {
        return $health
      }
    }
  } catch {
    return $null
  }
  return $null
}

$selectedPort = $null
$selectedPid = $null
foreach ($port in $ports) {
  $health = Get-PrototypeHealth -Port $port
  if ($health) {
    $selectedPort = $port
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($listener) { $selectedPid = $listener.OwningProcess }
    break
  }

  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($listener) { continue }

  [IO.File]::WriteAllText((Join-Path $projectRoot 'server.log'), '')
  [IO.File]::WriteAllText((Join-Path $projectRoot 'server-error.log'), '')
  $startParams = @{
    FilePath = $nodeExe
    ArgumentList = @('server.cjs', "--port=$port")
    WorkingDirectory = $projectRoot
    WindowStyle = 'Hidden'
    PassThru = $true
  }
  $process = Start-Process @startParams

  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 100
    $health = Get-PrototypeHealth -Port $port
    if ($health) {
      $selectedPort = $port
      $selectedPid = $process.Id
      break
    }
    if ($process.HasExited) { break }
  }
  if ($selectedPort) { break }
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
}

if (-not $selectedPort) {
  throw '8081—8090 端口均被占用，无法启动原型。'
}

[IO.File]::WriteAllText((Join-Path $projectRoot 'server.pid'), [string]$selectedPid)
[IO.File]::WriteAllText((Join-Path $projectRoot 'server.port'), [string]$selectedPort)

$url = "http://127.0.0.1:$selectedPort/#/dashboard?period=2026-04"
if (-not $NoBrowser) {
  Start-Process $url
}
Write-Output ("原型已就绪：{0}（PID {1}）" -f $url, $selectedPid)
