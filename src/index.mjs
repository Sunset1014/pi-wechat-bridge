/**
 * pi-wechat-bridge 主入口 —— 把微信 ClawBot 桥接到 pi（RPC 子进程模式）。
 *
 * 架构：
 *   微信 ClawBot ⇄ 长轮询 ⇄ weixin-agent-sdk ⇄ PiPool ⇄ pi --mode rpc 子进程
 *
 * 环境变量（均可选）：
 *   PI_CWD             pi 的工作目录（默认：本目录）
 *   PI_APPROVE         信任项目本地文件，默认 1
 *   AUTO_CONFIRM       自动确认 pi 的危险命令确认框，默认 0（自动拒绝）
 *   IDLE_TIMEOUT_MIN   会话空闲回收分钟数，默认 30
 *   PROMPT_TIMEOUT_MIN 单次任务超时分钟数，默认 20
 *   REPLY_CHUNK        回复分片长度（字符），默认 1500，超长自动分多条发送
 *   DEBUG              打印更多日志，默认 0
 */
import { login, start, isLoggedIn } from "weixin-agent-sdk";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PiPool } from "./pi-rpc.mjs";

const DEFAULT_CWD = path.join(os.homedir(), "PersonalFiles", "Code");

const config = {
  cwd: process.env.PI_CWD ?? DEFAULT_CWD,
  approve: process.env.PI_APPROVE !== "0",
  autoConfirm: process.env.AUTO_CONFIRM === "1",
  idleMinutes: Number(process.env.IDLE_TIMEOUT_MIN ?? 30),
  promptTimeoutMs: Number(process.env.PROMPT_TIMEOUT_MIN ?? 20) * 60_000,
  chunk: Number(process.env.REPLY_CHUNK ?? 1500),
  debug: process.env.DEBUG === "1",
};

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ── 扫码登录 ──────────────────────────────────────────────
if (!isLoggedIn()) {
  log("未检测到微信登录态，开始扫码登录…");
  await login();
}
log("微信已连接");

const pool = new PiPool({
  cwd: config.cwd,
  approve: config.approve,
  autoConfirm: config.autoConfirm,
  idleMinutes: config.idleMinutes,
  promptTimeoutMs: config.promptTimeoutMs,
  onLog: (m) => log(m),
});

let bot = null; // start() 之后可用

/** 长回复拆成多条：先主动发送前 n-1 片，最后一片作为 chat 回复返回，
 *  保证微信里顺序正确。 */
async function splitReply(text) {
  const n = Math.ceil(text.length / config.chunk);
  if (n <= 1) return { text };
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(text.slice(i * config.chunk, (i + 1) * config.chunk));
  }
  for (let i = 0; i < n - 1; i++) {
    try {
      await bot.sendMessage(`〔${i + 1}/${n}〕\n${parts[i]}`);
    } catch (err) {
      // 主动发送失败时把剩余内容并入回复，保证不丢
      log("分片发送失败，并入回复:", err.message);
      return { text: parts.slice(i).join("\n") };
    }
  }
  return { text: `〔${n}/${n}〕\n${parts[n - 1]}` };
}

const agent = {
  async chat(req) {
    const conv = req.conversationId;
    const tag = `[${conv.slice(0, 10)}]`;
    const client = pool.get(conv);
    try {
      let text = req.text ?? "";
      let images;
      if (req.media) {
        if (req.media.type === "image") {
          const data = await readFile(req.media.filePath);
          images = [{
            type: "image",
            data: data.toString("base64"),
            mimeType: req.media.mimeType ?? "image/jpeg",
          }];
          log(tag, `收到图片 ${req.media.filePath}`);
        } else {
          text += `\n\n[收到附件: ${req.media.fileName ?? req.media.type}，已保存至 ${req.media.filePath}]`;
          log(tag, `收到附件 ${req.media.type}`);
        }
      }
      log(tag, `→ pi: ${text.slice(0, 120)}${text.length > 120 ? "…" : ""}`);
      try {
        await bot?.sendMessage("⏳ pi 处理中…");
      } catch { /* 进度提示失败不影响主流程 */ }

      const reply = await client.prompt(text, images);
      log(tag, `← pi: ${reply.length} 字`);
      if (!reply?.trim()) return { text: "✅ 任务已执行完成（无文字回复）" };
      return await splitReply(reply);
    } catch (err) {
      // 出错时销毁该会话的子进程，下次消息自动重建
      pool.remove(conv);
      log(tag, `❌ ${err.message}`);
      return { text: `❌ 出错了：${err.message}` };
    }
  },
};

// ── 启动消息循环 ──────────────────────────────────────────
bot = start(agent);
log(`Bot 已启动，pi 工作目录: ${config.cwd}`);
log("Ctrl+C 退出");

process.on("SIGINT", () => {
  log("正在退出…");
  pool.closeAll();
  process.exit(0);
});

try {
  await bot.wait();
  log("Bot 已停止");
  process.exit(0);
} catch (err) {
  log("Bot 异常退出:", err.message);
  process.exit(1);
}
