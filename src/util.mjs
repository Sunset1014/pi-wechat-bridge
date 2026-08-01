/** 小工具集（无副作用，便于单测） */
import { open } from "node:fs/promises";

/** 按文件头探测图片真实类型（微信侧传的 mimeType 固定是 "image/*"，多数模型 API 不认） */
export async function detectImageMime(filePath) {
  const fh = await open(filePath, "r");
  try {
    const head = Buffer.alloc(12);
    const { bytesRead } = await fh.read(head, 0, 12, 0);
    const b = head.subarray(0, bytesRead);
    if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
    if (b.length >= 6 && b.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
    if (b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
    if (b.length >= 2 && b.subarray(0, 2).toString("ascii") === "BM") return "image/bmp";
    return "image/jpeg";
  } finally {
    await fh.close();
  }
}
