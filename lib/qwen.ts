import OpenAI from "openai";

export const QWEN_MODEL = process.env.QWEN_MODEL || "qwen-max";
export const QWEN_BASE_URL =
  process.env.QWEN_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

// Returns an OpenAI-compatible client pointed at Qwen Cloud, or null if no key is set
// (so the app still runs on a deterministic fallback before the hackathon credits land).
export function qwenClient(): OpenAI | null {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: QWEN_BASE_URL });
}
