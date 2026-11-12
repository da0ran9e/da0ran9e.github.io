# Trại Gà — chạy nền tự động khi bật máy (cần quyền Administrator).
#   - Server: Task Scheduler "TraiGa-Server" (lúc khởi động, chạy bằng tài khoản đang cài — KHÔNG phải
#     SYSTEM — kiểu S4U: không lưu mật khẩu, quyền thường; tự chạy lại nếu chết)
#   - Tunnel: Windows service "cloudflared" (cách chính thức của Cloudflare)
# Gỡ: install-service.ps1 -Uninstall
param([switch]$Uninstall)
. "$PSScriptRoot\common.ps1"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Cần chạy bằng quyền Administrator (chuột phải install-service.cmd -> Run as administrator).' }
$TaskName = 'TraiGa-Server'
$cf = Find-Cloudflared

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Ok "Đã gỡ task $TaskName"
  }
  if ($cf -and (Get-Service -Name cloudflared -ErrorAction SilentlyContinue)) { & $cf service uninstall; Write-Ok 'Đã gỡ service cloudflared' }
  return
}

if (-not (Test-Path $EnvFile)) { throw 'Chưa có server\.env — chạy setup.cmd trước.' }
$cfg = Read-DotEnv $EnvFile
$port = [int](Get-EnvValue $cfg 'PORT' '8787')
$node = Find-Node
if (-not $node) { throw 'Không thấy node.exe — chạy setup.cmd.' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Server: cmd /c để ghi log ra file
Write-Step "Đăng ký task $TaskName"
$cmdLine = "/c `"`"$node`" $($NodeArgs -join ' ') >> logs\server.log 2>> logs\server.err.log`""
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmdLine -WorkingDirectory $ServerDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
# Không dùng SYSTEM: mã server (src\*.mjs, .env) nằm trong thư mục người dùng tự ghi được → chạy bằng
# SYSTEM nghĩa là phần mềm nào sửa được file đó sẽ có quyền SYSTEM; và nếu server (mở ra Internet) bị
# khai thác thì kẻ tấn công có luôn toàn quyền máy. S4U = chạy khi chưa đăng nhập, không lưu mật khẩu.
$runAs = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $runAs -LogonType S4U -RunLevel Limited
Write-Ok "Task chạy bằng tài khoản $runAs (quyền thường, không phải SYSTEM)"
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
if (Wait-Hello $port 20) { Write-Ok "Server chạy nền ở http://127.0.0.1:$port" } else { Write-Warn2 "Server chưa trả lời — xem $LogDir\server.err.log" }

# Tunnel
$token = Get-EnvValue $cfg 'CLOUDFLARE_TUNNEL_TOKEN' ''
if (-not $token) { Write-Warn2 'Chưa có CLOUDFLARE_TUNNEL_TOKEN trong server\.env — bỏ qua tunnel.'; return }
if (-not $cf) { throw 'Không thấy cloudflared.exe — chạy setup.cmd.' }
if (Get-Service -Name cloudflared -ErrorAction SilentlyContinue) {
  Write-Ok 'Service cloudflared đã có (muốn đổi token: chạy -Uninstall rồi cài lại).'
} else {
  Write-Step 'Cài service cloudflared'
  & $cf service install $token
  Write-Ok 'Service cloudflared đã cài và tự chạy khi bật máy.'
}
Write-Host ''
Write-Host 'Xong. Kiểm tra bằng check.cmd' -ForegroundColor Green
