# Trại Gà — cài đặt lần đầu trên Windows. Chạy: setup.cmd (nhấp đúp) hoặc
#   powershell -ExecutionPolicy Bypass -File server\deploy\windows\setup.ps1
# Việc làm: kiểm tra Node 24+ và cloudflared (thiếu thì đề nghị cài bằng winget), tạo server\.env,
# sinh SERVER_SECRET, hỏi Cloudflare tunnel token, chạy test.
param([switch]$SkipTests, [string]$Token)
. "$PSScriptRoot\common.ps1"

Write-Step "Thư mục server: $ServerDir"

# 1) Node.js 24+
$node = Find-Node
if (-not $node -or (Get-NodeMajor $node) -lt 24) {
  Write-Warn2 'Cần Node.js 24 trở lên (server dùng node:sqlite).'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    if ((Read-Host 'Cài Node.js LTS bằng winget? (Y/n)') -notmatch '^[nN]') {
      winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
      $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
      $node = Find-Node
    }
  }
  if (-not $node -or (Get-NodeMajor $node) -lt 24) { throw 'Chưa có Node.js 24+. Tải ở https://nodejs.org rồi chạy lại setup.' }
}
Write-Ok "Node $(& $node -v) ($node)"

# 2) cloudflared
$cf = Find-Cloudflared
if (-not $cf) {
  Write-Warn2 'Chưa có cloudflared (Cloudflare Tunnel).'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    if ((Read-Host 'Cài cloudflared bằng winget? (Y/n)') -notmatch '^[nN]') {
      winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
      $cf = Find-Cloudflared
    }
  }
  if (-not $cf) { Write-Warn2 'Bỏ qua: vẫn chạy được server trên máy, nhưng chưa ra Internet. Cài cloudflared rồi chạy lại setup.' }
}
if ($cf) {
  $ver = try { (& $cf --version | Select-Object -First 1) } catch { 'không rõ phiên bản' }
  Write-Ok "cloudflared: $ver ($cf)"
}

# 3) .env
if (-not (Test-Path $EnvFile)) {
  Copy-Item $EnvExample $EnvFile
  Write-Ok 'Đã tạo server\.env từ .env.example'
}
$cfg = Read-DotEnv $EnvFile
if (-not $cfg['SERVER_SECRET']) {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  Set-DotEnvValue $EnvFile 'SERVER_SECRET' (-join ($bytes | ForEach-Object { $_.ToString('x2') }))
  Write-Ok 'Đã sinh SERVER_SECRET (giữ nguyên file .env này; sao lưu cùng data\)'
} else { Write-Ok 'SERVER_SECRET đã có' }

if ($Token) {
  Set-DotEnvValue $EnvFile 'CLOUDFLARE_TUNNEL_TOKEN' $Token.Trim()
} elseif (-not $cfg['CLOUDFLARE_TUNNEL_TOKEN']) {
  Write-Host ''
  Write-Host 'Cloudflare tunnel token: Zero Trust -> Networks -> Tunnels -> (tunnel của bạn) -> Install connector,'
  Write-Host 'copy chuỗi dài sau "--token". Bỏ trống để điền sau vào server\.env.'
  $t = Read-Host 'Dán token'
  if ($t.Trim()) { Set-DotEnvValue $EnvFile 'CLOUDFLARE_TUNNEL_TOKEN' $t.Trim(); Write-Ok 'Đã lưu token vào server\.env' }
  else { Write-Warn2 'Chưa có token — server chỉ chạy trong máy.' }
} else { Write-Ok 'CLOUDFLARE_TUNNEL_TOKEN đã có' }

New-Item -ItemType Directory -Force -Path (Join-Path $ServerDir 'data'), $LogDir | Out-Null

# 4) test
if (-not $SkipTests) {
  Write-Step 'Chạy test server'
  Push-Location $ServerDir
  try {
    & $node --disable-warning=ExperimentalWarning --test test/
    if ($LASTEXITCODE -ne 0) { throw 'Test lỗi — xem kết quả phía trên.' }
  } finally { Pop-Location }
  Write-Ok 'Test qua hết'
}

Write-Host ''
Write-Step 'Xong. Bước tiếp:'
Write-Host '  - Chạy thử:            start.cmd   (Ctrl+C để dừng)'
Write-Host '  - Kiểm tra:            check.cmd'
Write-Host '  - Tự chạy khi bật máy: install-service.cmd  (chuột phải -> Run as administrator)'
