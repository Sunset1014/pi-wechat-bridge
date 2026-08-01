# NOTES

## 2025-08-02 任务：把 pi 接入微信 ClawBot

- 项目：pi-wechat-bridge —— 微信 ClawBot ⇄ weixin-agent-sdk ⇄ pi --mode rpc
- 已完成：
  - `src/index.mjs` 主入口（扫码登录 + 消息循环 + 长回复分片）
  - `src/pi-rpc.mjs` pi RPC 客户端（子进程池、多轮记忆、危险命令自动拒绝、空闲回收）
  - `scripts/login.mjs` / `scripts/selftest.mjs`
  - 自测通过：RPC 链路 ✓、多轮记忆 ✓
  - 已推送 GitHub 公开仓库：https://github.com/Sunset1014/pi-wechat-bridge（main，2 commits）
- 待办：
  - 用户扫码登录微信（npm run login）后真机验证

## 2025-08-02 追加

- 修复事故：全局扩展 kit-backup.ts 缺 lib 文件导致 pi 无法启动（已补 ~/.pi/agent/lib/kit-backup-core.ts）；桥加了 stderr 转发 + 防 unhandled rejection 崩溃
- 审查改进：会话白名单 ALLOWED_CONVERSATIONS、超时自动 abort、孤儿进程清理、图片 mimeType 文件头探测
- 已推送 GitHub：当前 main 已同步（98f3555）
- 确认无需改动：消息排队语义 SDK 已有（getUpdates 串行逐条处理）；ClawBot 是官方账号，别人加的是官方 AI，不会触发本桥；群聊可能推送（SDK 无过滤），用白名单防护
- 用法：`npm start`（环境变量见 README，如 PI_CWD 指定 pi 工作目录）
