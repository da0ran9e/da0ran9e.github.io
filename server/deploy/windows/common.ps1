# Dùng chung cho các script Windows của Trại Gà (dot-source: . "$PSScriptRoot\common.ps1")
$ErrorActionPreference = 'Stop'
$ServerDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvFile = Join-Path $ServerDir '.env'
$EnvExample = Join-Path $ServerDir '.env.example'
$LogDir = Join-Path $ServerDir 'logs'
$NodeArgs = @('--env-file-if-exists=.env', '--disable-warning=ExperimentalWarning', 'src/main.mjs')

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "  !!  $msg" -ForegroundColor Yellow }

# Đọc file .env thành hashtable (bỏ dòng trống / dòng #)
function Read-DotEnv([string]$Path) {
  $h = @{}
  if (-not (Test-Path $Path)) { return $h }
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { continue }
    $h[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim().Trim('"')
  }
  return $h
}

# Ghi KEY=value vào .env (thay dòng cũ nếu có, không thì thêm cuối file). Giữ UTF-8 không BOM cho Node.
function Set-DotEnvValue([string]$Path, [string]$Key, [string]$Value) {
  $lines = @()
  if (Test-Path $Path) { $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8) }
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^\s*$([regex]::Escape($Key))\s*=") { $lines[$i] = "$Key=$Value"; $found = $true }
  }
  if (-not $found) { $lines += "$Key=$Value" }
  [IO.File]::WriteAllLines($Path, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
}

function Get-EnvValue($cfg, [string]$Key, [string]$Default) {
  if ($cfg.ContainsKey($Key) -and $cfg[$Key] -ne '') { return $cfg[$Key] }
  return $Default
}

function Find-Node {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe")) { if (Test-Path $p) { return $p } }
  return $null
}

function Find-Cloudflared {
  $c = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $cands = @(
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
    "$env:ProgramFiles\cloudflared\cloudflared.exe",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe",
    (Join-Path $PSScriptRoot 'cloudflared.exe')
  )
  foreach ($p in $cands) { if ($p -and (Test-Path $p)) { return $p } }
  return $null
}

function Get-NodeMajor([string]$node) {
  $v = (& $node -v) -replace '^v', ''
  return [int]($v.Split('.')[0])
}

# Đợi server trả lời /api/hello (trả về $true nếu kịp)
function Wait-Hello([int]$Port, [int]$Seconds = 20) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/hello" -TimeoutSec 2
      if ($r.ok) { return $true }
    } catch { }
    Start-Sleep -Milliseconds 500
  }
  return $false
}
