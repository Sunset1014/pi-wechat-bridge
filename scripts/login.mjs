/** 单独执行微信扫码登录（登录态持久化，之后可复用） */
import { login } from "weixin-agent-sdk";

await login();
console.log("登录完成");
