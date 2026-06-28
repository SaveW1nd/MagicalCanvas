# MagicalCanvas — Windows 本机部署脚本(局域网访问)
# 用法:在「管理员 PowerShell」里执行。需提前装好 Node.js(>=18)和 Git。
#   Set-ExecutionPolicy -Scope Process Bypass -Force ; .\deploy-windows.ps1
#
# 这台机器同时跑 fp(fpbrowser2api,8002)。画布与 fp 同机,fp 走本机直连。
# 文字=DeepSeek、视觉=MiMo 都是外网 API,无需改动。

$ErrorActionPreference = 'Stop'

$Root   = 'E:\savewind\MagicalCanvas'
$Repo   = 'https://github.com/SaveW1nd/MagicalCanvas.git'
$Branch = 'feat/p0-auth'
$Port   = 3501

Write-Host '== 1/6 检查 Node / Git ==' -ForegroundColor Cyan
node -v
git --version

Write-Host '== 2/6 拉取代码 ==' -ForegroundColor Cyan
if (Test-Path $Root) {
    Set-Location $Root
    git fetch origin
    git checkout $Branch
    git pull
} else {
    git clone $Repo $Root
    Set-Location $Root
    git checkout $Branch
}

Write-Host '== 3/6 安装依赖(better-sqlite3 / sharp 预编译二进制 + ffmpeg-static)==' -ForegroundColor Cyan
npm install

Write-Host '== 4/6 构建前端(dist,由 Express 一并托管)==' -ForegroundColor Cyan
npm run build

Write-Host '== 5/6 检查密钥与数据文件(需从 Mac 复制,git 不含)==' -ForegroundColor Cyan
$missing = $false
if (-not (Test-Path "$Root\magicalcanvas.db"))      { Write-Warning 'magicalcanvas.db 缺失(含账号 + 模型注册表)。请从 Mac 复制到此目录。'; $missing = $true }
if (-not (Test-Path "$Root\twitcanva-config.json")) { Write-Warning 'twitcanva-config.json 缺失(含各模型 KEY)。请从 Mac 复制到此目录。'; $missing = $true }
if ($missing) {
    Write-Host '复制好上面两个文件后,重跑本脚本(或直接 `node server/index.js`)。' -ForegroundColor Yellow
    Write-Host '可选:若 fp 端口不是 8002,或想用 localhost,登录后台「模型配置」改 Flow(fp) 的接入网址即可。' -ForegroundColor Yellow
    exit 1
}

Write-Host '== 6/6 开放防火墙入站端口 ==' -ForegroundColor Cyan
New-NetFirewallRule -DisplayName "MagicalCanvas $Port" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -ErrorAction SilentlyContinue | Out-Null

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' -or $_.IPAddress -like '172.*' } |
       Select-Object -First 1).IPAddress

Write-Host ''
Write-Host "局域网访问地址:  http://$ip`:$Port" -ForegroundColor Green
Write-Host '管理员: admin / admin12345    普通用户: user001 / 12345678' -ForegroundColor Green
Write-Host '正在启动服务(Ctrl+C 停止)...' -ForegroundColor Green
Write-Host ''
node server/index.js
