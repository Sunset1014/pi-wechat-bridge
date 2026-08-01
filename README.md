# pi-wechat-bridge

把 [pi](https://github.com/earendil-works/pi-coding-agent) 编码代理接入**微信 ClawBot**：在微信里给 pi 发消息，让它在你电脑上执行任务（读文件、改代码、跑命令……）。

## 架构

```
微信 ClawBot 聊天
      ⇅ 长轮询（无需公网服务器）
weixin-agent-sdk（本项目的微信侧桥接）
      ⇅ JSONL over stdio
pi --mode rpc（每个微信会话一个 pi 子进程，保留多轮记忆）
```

- 微信侧：社区开源 SDK [`weixin-agent-sdk`](https://github.com/wong2/weixin-agent-sdk)（基于腾讯官方 openclaw-weixin 协议），扫码登录、长轮询收消息。
- pi 侧：官方 RPC 模式（`pi --mode rpc`），发送 `prompt` 命令并等待 `agent_settled` 后取最终回复。
- 一个微信会话对应一个 pi 子进程（独立 session 记忆），空闲 30 分钟自动回收。

## 要求

- Node.js ≥ 22
- 已安装 pi（本机已装）
- 微信账号可用 ClawBot（iLink AI 助手）

## 使用

```bash
npm install

# 1. 扫码登录微信（登录态持久化，之后无需重复）
npm run login

# 2. 启动桥接
npm start
```

然后打开微信，找到你的 ClawBot 对话，直接发消息即可。支持：
- 文本、图片（pi 可看图）、语音（微信侧已转文字）、文件
- 多轮对话（每会话独立记忆）
- 长回复自动分片（默认 1500 字/条）

常用命令：
- `npm run selftest` — 不连微信，单独验证 pi RPC 链路
- `npm run login` — 重新扫码（换账号/登录态过期时）

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PI_CWD` | `~/PersonalFiles/Code` | pi 的工作目录（要 pi 操作哪个项目就设成哪个目录） |
| `PI_APPROVE` | `1` | 信任项目本地文件（AGENTS.md 等） |
| `AUTO_CONFIRM` | `0` | 自动确认 pi 的危险命令确认框。默认自动**拒绝**，遇到被拒可手动告诉 pi 换个安全做法 |
| `IDLE_TIMEOUT_MIN` | `30` | 会话空闲回收（分钟） |
| `PROMPT_TIMEOUT_MIN` | `20` | 单次任务超时（分钟） |
| `REPLY_CHUNK` | `1500` | 回复分片长度（字符） |
| `ALLOWED_CONVERSATIONS` | 空 | 会话 ID 白名单（逗号分隔，ID 见启动日志 `[xxxx…]` 部分）。**建议设置**：留空 = 任何会话都能命令 pi |
| `DEBUG` | `0` | 详细日志 |

示例：让 pi 在 `~/Code/my-project` 下工作

```bash
PI_CWD=/c/Users/Eternity/PersonalFiles/Code/my-project npm start
```

## 安全须知

- pi 拥有本机完整 shell 权限，微信消息 = 远程命令执行。**务必设置 `ALLOWED_CONVERSATIONS` 白名单**（启动日志里 `[o9cq802Kto…]` 那段就是会话 ID），防止群聊/陌生人触发你的 pi。
- 危险命令默认自动拒绝（`AUTO_CONFIRM=1` 可改为自动确认，风险自负）。
- 会话文件保存在 pi 的默认 session 目录（`~/.pi/agent/sessions/`），含对话内容，注意隐私。

## 已知限制

- 多个会话的消息**串行处理**（SDK 层限制）：A 会话任务未完成时，B 会话消息会排队等待
- 内置斜杠命令 `/echo`、`/toggle-debug` 被 SDK 占用，pi 收不到；`/kit-backup` 等其他斜杠命令正常透传
- 主动发送进度提示（"⏳ pi 处理中…"）依赖微信下发的 `context_token`，需至少收到过一条消息，且 token 约 24 小时过期（收到新消息自动续）
- 语音回复、视频回复暂不支持（文本回复为主）

## License

MIT
