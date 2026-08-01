/**
 * pi RPC 客户端 —— 以子进程方式驱动 `pi --mode rpc`，通过 JSONL over stdio 通信。
 * 协议细节见 pi 文档 docs/rpc.md。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { StringDecoder } from "node:string_decoder";

const IS_WIN = process.platform === "win32";

/** 解析 pi 可执行文件位置：env PI > pi-node 托管安装 > PATH */
export function resolvePi() {
  if (process.env.PI) return { file: process.env.PI, args: [], shell: false };
  if (IS_WIN && process.env.LOCALAPPDATA) {
    const root = path.join(process.env.LOCALAPPDATA, "pi-node", "current");
    const node = path.join(root, "node.exe");
    const cli = path.join(
      root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js",
    );
    if (existsSync(node) && existsSync(cli)) {
      return { file: node, args: [cli], shell: false };
    }
  }
  return { file: "pi", args: [], shell: IS_WIN };
}

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);
}

export class PiRpcClient {
  /**
   * @param {object} opts
   * @param {string} opts.cwd            pi 的工作目录
   * @param {string} opts.sessionId      会话 ID（隔离不同微信会话的记忆）
   * @param {string} opts.name           会话显示名
   * @param {boolean} [opts.approve]     信任项目本地文件（--approve）
   * @param {boolean} [opts.autoConfirm] 自动确认危险命令确认框（默认拒绝）
   * @param {number}  [opts.promptTimeoutMs] 单次 prompt 超时
   * @param {(msg:string)=>void} [opts.onLog]
   */
  constructor({ cwd, sessionId, name, approve = true, autoConfirm = false, promptTimeoutMs = 20 * 60_000, onLog = console.log }) {
    this.cwd = cwd;
    this.sessionId = sessionId;
    this.name = name;
    this.approve = approve;
    this.autoConfirm = autoConfirm;
    this.promptTimeoutMs = promptTimeoutMs;
    this.onLog = onLog;
    this.lastUsed = Date.now();
    this._seq = 0;
    this._pending = new Map();      // id -> {resolve, reject}
    this._settleWaiters = [];       // prompt 完成等待者
    this._proc = null;
    this._decoder = null;
    this._buffer = "";
    this._dead = true;
  }

  /** 启动/复用子进程（惰性启动） */
  _ensureRunning() {
    if (this._proc && this._proc.exitCode === null) return;
    const pi = resolvePi();
    const args = [
      ...pi.args,
      "--mode", "rpc",
      "--session-id", this.sessionId,
      "--name", `wechat-${this.name}`,
    ];
    if (this.approve) args.push("--approve");
    args.push(this.cwd);

    this.onLog(`[pi] 启动子进程 (${this.name}) cwd=${this.cwd}`);
    const proc = spawn(pi.file, args, { shell: pi.shell, cwd: this.cwd });
    this._proc = proc;
    this._dead = false;
    this._buffer = "";
    this._decoder = new StringDecoder("utf8");

    proc.stdout.on("data", (chunk) => {
      this._buffer += this._decoder.write(chunk);
      this._drain();
    });
    proc.stdout.on("end", () => {
      this._buffer += this._decoder.end();
      this._drain();
    });
    // 转发 stderr 到日志（启动失败等原因可直接看到）
    proc.stderr.setEncoding("utf8");
    let errBuf = "";
    proc.stderr.on("data", (chunk) => {
      errBuf += chunk;
      let idx;
      while ((idx = errBuf.indexOf("\n")) !== -1) {
        const line = errBuf.slice(0, idx).replace(/\r$/, "");
        errBuf = errBuf.slice(idx + 1);
        if (line.trim()) this.onLog(`[pi:stderr] ${line}`);
      }
    });
    proc.stderr.on("end", () => {
      if (errBuf.trim()) this.onLog(`[pi:stderr] ${errBuf.trim()}`);
    });
    proc.on("error", (err) => this._onExit(`启动失败: ${err.message}`));
    proc.on("exit", (code, signal) => {
      this._onExit(`进程退出 code=${code} signal=${signal ?? ""}`);
    });
  }

  _onExit(reason) {
    if (this._dead) return;
    this._dead = true;
    this.onLog(`[pi] ${reason}`);
    const err = new Error(`pi 子进程已退出（${reason}），会话记忆可能丢失`);
    for (const [, p] of this._pending) p.reject(err);
    this._pending.clear();
    for (const w of this._settleWaiters) w.reject(err);
    this._settleWaiters = [];
  }

  _drain() {
    let idx;
    while ((idx = this._buffer.indexOf("\n")) !== -1) {
      const line = this._buffer.slice(0, idx);
      this._buffer = this._buffer.slice(idx + 1);
      if (line.endsWith("\r")) this._handleLine(line.slice(0, -1));
      else this._handleLine(line);
    }
  }

  _handleLine(line) {
    if (!line.trim()) return;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      this.onLog(`[pi] 非 JSON 输出: ${line.slice(0, 200)}`);
      return;
    }
    switch (ev.type) {
      case "response": {
        const p = this._pending.get(ev.id);
        if (!p) return;
        this._pending.delete(ev.id);
        if (ev.success) p.resolve(ev);
        else p.reject(new Error(ev.error || "命令执行失败"));
        return;
      }
      case "agent_settled": {
        for (const w of this._settleWaiters) w.resolve();
        this._settleWaiters = [];
        return;
      }
      case "extension_ui_request":
        this._handleUiRequest(ev);
        return;
      case "extension_error":
        this.onLog(`[pi] 扩展错误: ${ev.error}`);
        return;
      case "auto_retry_start":
        this.onLog(`[pi] 自动重试 (${ev.attempt}/${ev.maxAttempts}): ${ev.errorMessage}`);
        return;
      default:
        return; // 其余事件（message_update 等）本桥不需要
    }
  }

  /** 处理 pi 的交互请求（危险命令确认等）。无人在线确认，按策略自动应答，避免挂起。 */
  _handleUiRequest(ev) {
    const m = ev.method;
    const title = ev.title ?? "";
    if (m === "confirm") {
      if (this.autoConfirm) {
        this._write({ type: "extension_ui_response", id: ev.id, confirmed: true });
        this.onLog(`[pi] ⚠️ AUTO_CONFIRM 已自动确认: ${title}`);
      } else {
        this._write({ type: "extension_ui_response", id: ev.id, cancelled: true });
        this.onLog(`[pi] 🔒 已自动拒绝确认: ${title}${ev.message ? ` — ${ev.message}` : ""}`);
      }
    } else if (m === "select" || m === "input" || m === "editor") {
      this._write({ type: "extension_ui_response", id: ev.id, cancelled: true });
      this.onLog(`[pi] 🔒 已取消 UI 请求: ${m} ${title}`);
    } else {
      this.onLog(`[pi] UI 通知: ${m} ${title}`);
    }
  }

  _write(obj) {
    if (this._dead || !this._proc?.stdin) return;
    try {
      this._proc.stdin.write(JSON.stringify(obj) + "\n");
    } catch (err) {
      this._onExit(`stdin 写入失败: ${err.message}`);
    }
  }

  /** 发送一条 RPC 命令并等待响应 */
  command(cmd) {
    this._ensureRunning();
    const id = cmd.id ?? `c-${++this._seq}`;
    return new Promise((resolve, reject) => {
      if (this._dead) return reject(new Error("pi 子进程未运行"));
      this._pending.set(id, { resolve, reject });
      this._write({ ...cmd, id });
    });
  }

  /**
   * 发送 prompt 并等待 agent 完全结束，返回最终回复文本。
   * @param {string} text
   * @param {Array<{type:"image",data:string,mimeType:string}>} [images]
   */
  async prompt(text, images) {
    this.lastUsed = Date.now();
    this._ensureRunning();

    const settled = new Promise((resolve, reject) => {
      this._settleWaiters.push({ resolve, reject });
    });
    // 防止子进程退出时 settled 被 reject 但无人 await，变成 unhandled rejection 打崩进程
    settled.catch(() => {});
    const cmd = { type: "prompt", message: text, streamingBehavior: "followUp" };
    if (images?.length) cmd.images = images;

    const resp = await this.command(cmd);
    if (!resp.success) throw new Error(resp.error || "prompt 被拒绝");

    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`pi 处理超时（>${Math.round(this.promptTimeoutMs / 60000)} 分钟）`)),
        this.promptTimeoutMs,
      );
    });
    timeout.catch(() => {});
    try {
      await Promise.race([settled, timeout]);
    } catch (err) {
      // 超时：主动 abort，避免残留任务阻塞后续消息
      if (String(err.message).includes("超时")) {
        this.onLog("[pi] 任务超时，发送 abort 取消…");
        await this.command({ type: "abort" }).catch(() => {});
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const last = await this.command({ type: "get_last_assistant_text" });
    return last.data?.text ?? "";
  }

  close() {
    if (!this._proc) return;
    try {
      this._proc.kill();
    } catch { /* 忽略 */ }
    this._proc = null;
  }
}

/** 每个微信会话一个 pi 子进程（保留多轮记忆），空闲自动回收 */
export class PiPool {
  constructor({ cwd, approve, autoConfirm, idleMinutes = 30, promptTimeoutMs, onLog = console.log }) {
    this.opts = { cwd, approve, autoConfirm, promptTimeoutMs, onLog };
    this.idleMinutes = idleMinutes;
    this.onLog = onLog;
    this.clients = new Map();
    if (idleMinutes > 0) {
      setInterval(() => this._reap(), 5 * 60_000).unref();
    }
  }

  get(conversationId) {
    const key = sha1(conversationId);
    let client = this.clients.get(key);
    if (!client) {
      client = new PiRpcClient({
        ...this.opts,
        sessionId: `wechat-${key}`,
        name: key,
      });
      this.clients.set(key, client);
    }
    return client;
  }

  remove(conversationId) {
    const key = sha1(conversationId);
    const client = this.clients.get(key);
    if (client) {
      client.close();
      this.clients.delete(key);
    }
  }

  _reap() {
    const now = Date.now();
    for (const [key, client] of this.clients) {
      if (now - client.lastUsed > this.idleMinutes * 60_000) {
        this.onLog?.(`[pool] 回收空闲会话 ${client.name}`);
        client.close();
        this.clients.delete(key);
      }
    }
  }

  closeAll() {
    for (const client of this.clients.values()) client.close();
    this.clients.clear();
  }
}
