# Trại Gà — kiểm tra nhanh: server trong máy, số đo, tunnel, địa chỉ công khai.
param([string]$PublicUrl = 'https://game.vuducan.qzz.io')
. "$PSScriptRoot\common.ps1"
$ErrorActionPreference = 'Continue'
$cfg = Read-DotEnv $EnvFile
$port = [int](Get-EnvValue $cfg 'PORT' '8787')
$adminPort = [int](Get-EnvValue $cfg 'ADMIN_PORT' '8788')

try { $h = Invoke-RestMethod "http://127.0.0.1:$port/api/hello" -TimeoutSec 3; Write-Ok "Server trong máy: luật v$($h.rulesVersion)" }
catch { Write-Warn2 "Server trong máy không trả lời ở cổng $port" }

try { $m = Invoke-RestMethod "http://127.0.0.1:$adminPort/metrics" -TimeoutSec 3; $j = $m | ConvertTo-Json -Depth 2 -Compress; Write-Ok ("Số đo: " + $j.Substring(0, [Math]::Min(300, $j.Length))) }
catch { Write-Warn2 "Cổng quản trị $adminPort không trả lời" }

try { $r = Invoke-WebRequest "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 3; Write-Ok "Trang game trong máy: HTTP $($r.StatusCode)" }
catch { Write-Warn2 'Server không phục vụ trang game (SERVE_CLIENT=0?)' }

$task = Get-ScheduledTask -TaskName 'TraiGa-Server' -ErrorAction SilentlyContinue
if ($task) { Write-Ok "Task TraiGa-Server: $($task.State)" } else { Write-Host '  ..  Task TraiGa-Server: chưa cài (đang dùng start.cmd?)' }
$svc = Get-Service -Name cloudflared -ErrorAction SilentlyContinue
if ($svc) { Write-Ok "Service cloudflared: $($svc.Status)" } else { Write-Host '  ..  Service cloudflared: chưa cài' }

try { $p = Invoke-RestMethod "$PublicUrl/api/hello" -TimeoutSec 8; Write-Ok "Công khai $PublicUrl : luật v$($p.rulesVersion)" }
catch { Write-Warn2 "Chưa vào được $PublicUrl/api/hello — kiểm tra Public Hostname trong Cloudflare (trỏ về http://localhost:$port)" }
