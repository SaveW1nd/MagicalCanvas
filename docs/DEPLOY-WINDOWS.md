# MagicalCanvas — Windows 本机部署(局域网访问)

画布与 fp(fpbrowser2api)同机部署在这台 Windows 上,用户连**同一 Wi-Fi/局域网**访问。
生成(fp/指纹浏览器)与访问都在本机/内网,**不走任何隧道,最快**。

## 拓扑(已确认)
- **画布** Express,端口 **3501**,同时托管前端 + API + 媒体(`/library`)。
- **fp(fpbrowser2api)** 已在本机 **8002**(注册表里 Flow(fp) = `http://192.168.43.131:8002/v1`,即本机 LAN IP,本机直连)。
- **文字 = DeepSeek(api.deepseek.com)**、**视觉 = MiMo(axiomcode.dev)**:外网 API,不用动。

## 前置
- Node.js ≥ 18(`node -v`)
- Git
- 无需手动装 ffmpeg(用 `ffmpeg-static`);`better-sqlite3` / `sharp` 走预编译二进制,一般不需要编译器。

## 步骤
1. **拿两个密钥/数据文件**(git 不含,需从 Mac 复制到 `E:\savewind\MagicalCanvas\`):
   - `magicalcanvas.db` —— 账号 + 模型注册表(provider/KEY)
   - `twitcanva-config.json` —— 各模型 KEY
   - (可选)`library\` 整个目录 —— 已有的素材/工作流/历史。不复制则从空开始。
   > 同一局域网,最简单:Mac 上 `scp` 或共享文件夹拖过去;也可 U 盘。

2. **管理员 PowerShell** 跑一键脚本:
   ```powershell
   cd E:\savewind
   git clone https://github.com/SaveW1nd/MagicalCanvas.git
   cd MagicalCanvas
   git checkout feat/p0-auth
   Set-ExecutionPolicy -Scope Process Bypass -Force
   .\deploy-windows.ps1
   ```
   脚本会:拉代码 → `npm install` → `npm run build` → 检查密钥文件 → 开防火墙 3501 → 打印局域网地址 → 启动。

3. **访问**:同 Wi-Fi 设备开 `http://<Windows局域网IP>:3501`(脚本结尾会打印)。

## 固定 IP(建议)
路由器里给这台 Windows 做 DHCP 绑定,IP 不变,访问地址才稳定。

## 备注
- fp 端口若不是 8002,或想改 `localhost`:登录后台「模型配置」→ 改 Flow(fp) 接入网址。
- 长期运行可后续做成 Windows 服务 / nssm / pm2-windows(本脚本是前台启动,关窗口即停)。
