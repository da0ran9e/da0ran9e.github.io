# Trại Gà — chạy server + Cloudflare Tunnel ở cửa sổ này. Ctrl+C để dừng cả hai.
# Nếu tunnel đã cài thành Windows service (install-service) thì chỉ chạy server.
param([switch]$NoTunnel)
. "$PSScriptRoot\common.ps1"

if (-not (Test-Path $EnvFile)) { throw 'Chưa có server\.env — chạy setup.cmd trước.' }
$cfg = Read-DotEnv $EnvFile
$port = [int](Get-EnvValue $cfg 'PORT' '8787')
$node = Find-Node
if (-not $node) { throw 'Không thấy node.exe — chạy setup.cmd.' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$task = Get-ScheduledTask -TaskName 'TraiGa-Server' -ErrorAction SilentlyContinue
if ($task -and $task.State -eq 'Running') { throw 'Server đang chạy bằng Task Scheduler (TraiGa-Server). Dừng nó trước: Stop-ScheduledTask TraiGa-Server' }

$procs = @()
try {
  Write-Step "Khởi động server ở http://127.0.0.1:$port"
  $srv = Start-Process -FilePath $node -ArgumentList $NodeArgs -WorkingDirectory $ServerDir -NoNewWindow -PassThru `
    -RedirectStandardOutput (Join-Path $LogDir 'server.log') -RedirectStandardError (Join-Path $LogDir 'server.err.log')
  $procs += $srv
  if (-not (Wait-Hello $port 20)) { throw "Server không lên — xem $LogDir\server.err.log" }
  Write-Ok "Server chạy (pid $($srv.Id)). Mở thử: http://localhost:$port/"

  $token = Get-EnvValue $cfg 'CLOUDFLARE_TUNNEL_TOKEN' ''
  $svc = Get-Service -Name cloudflared -ErrorAction SilentlyContinue
  if ($NoTunnel) {
    Write-Warn2 'Bỏ qua tunnel (-NoTunnel).'
  } elseif ($svc -and $svc.Status -eq 'Running') {
    Write-Ok 'Tunnel đang chạy bằng Windows service "cloudflared".'
  } elseif (-not $token) {
    Write-Warn2 'Chưa có CLOUDFLARE_TUNNEL_TOKEN trong server\.env — chỉ chơi được trong máy này.'
  } else {
    $cf = Find-Cloudflared
    if (-not $cf) { throw 'Không thấy cloudflared.exe — chạy setup.cmd.' }
    Write-Step 'Mở Cloudflare Tunnel'
    $env:TUNNEL_TOKEN = $token # truyền qua biến môi trường, không lộ trên dòng lệnh
    $tun = Start-Process -FilePath $cf -ArgumentList @('tunnel', '--no-autoupdate', 'run') -NoNewWindow -PassThru `
      -RedirectStandardOutput (Join-Path $LogDir 'tunnel.log') -RedirectStandardError (Join-Path $LogDir 'tunnel.err.log')
    Remove-Item Env:\TUNNEL_TOKEN
    $procs += $tun
    Write-Ok "Tunnel chạy (pid $($tun.Id)). Log: $LogDir\tunnel.err.log"
  }
  Write-Host ''
  Write-Host 'Đang chạy. Ctrl+C để dừng. (Log ở server\logs\)' -ForegroundColor Green
  while ($true) {
    foreach ($p in $procs) {
      if ($p.HasExited) { throw "Tiến trình $($p.ProcessName) (pid $($p.Id)) đã dừng, mã $($p.ExitCode) — xem log." }
    }
    Start-Sleep -Seconds 2
  }
} finally {
  foreach ($p in $procs) {
    if (-not $p.HasExited) { Write-Host "Dừng $($p.ProcessName) (pid $($p.Id))"; Stop-Process -Id $p.Id -ErrorAction SilentlyContinue }
  }
}
