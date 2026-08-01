/** 自测：不经过微信，直接验证 pi RPC 协议链路（spawn → prompt → 取最终回复） */
import { PiRpcClient } from "../src/pi-rpc.mjs";

const client = new PiRpcClient({
  cwd: process.cwd(),
  sessionId: `selftest-${Date.now()}`,
  name: "selftest",
  approve: true,
  promptTimeoutMs: 120_000,
});
try {
  console.log("→ 发送测试 prompt…");
  const reply = await client.prompt("请只回复四个字：链路正常", []);
  console.log("← pi 回复:", JSON.stringify(reply));
  if (!reply) {
    console.error("✗ 未获得回复");
    process.exit(1);
  }
  console.log("✓ pi RPC 链路正常");
} catch (err) {
  console.error("✗ 自测失败:", err.message);
  process.exit(1);
} finally {
  client.close();
}
