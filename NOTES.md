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
- 用法：`npm start`（环境变量见 README，如 PI_CWD 指定 pi 工作目录）
