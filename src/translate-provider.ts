/**
 * =====================================================================
 * 🌐 Translate Provider — Gemini / Ollama 雙 provider，共用 prompt SSOT
 * =====================================================================
 * 整併自 music-release-agent 的 src/lyrics-translator.js（Gemini）與
 * lyrics-service.js 內嵌的 translateWithOllama。
 * Ollama 的「主模型 → fallback 模型」鏈結構參考
 * ../youtube-podcast-translator/src/services/ai.service.js。
 * =====================================================================
 */
import { GoogleGenAI } from '@google/genai';
import { SYSTEM_INSTRUCTION, buildLyricsPrompt } from './lyrics-prompt.js';

/** Gemini provider（需 GEMINI_API_KEY） */
export async function translateWithGemini(artistName, trackName, sourceLyrics) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY in environment variables');
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    contents: [{ text: buildLyricsPrompt(artistName, trackName, sourceLyrics) }],
    config: { systemInstruction: SYSTEM_INSTRUCTION }
  });

  return response.text;
}

/** 對單一 Ollama 模型發出翻譯請求 */
async function ollamaGenerate(baseUrl, model, artistName, trackName, sourceLyrics) {
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      system: SYSTEM_INSTRUCTION,
      prompt: buildLyricsPrompt(artistName, trackName, sourceLyrics),
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama 回應異常 (${response.status})：請確認本機 Ollama 已啟動且已 pull ${model}`);
  }

  const data = await response.json();
  if (!data.response) {
    throw new Error('Ollama 回應中沒有翻譯內容');
  }
  return data.response;
}

/**
 * Ollama provider：本地模型，零 API 費用（需本機跑 Ollama）。
 * 主模型失敗且設有 OLLAMA_FALLBACK_MODEL 時，自動嘗試 fallback 模型。
 */
export async function translateWithOllama(artistName, trackName, sourceLyrics) {
  const baseUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
  const fallbackModel = process.env.OLLAMA_FALLBACK_MODEL;

  try {
    return await ollamaGenerate(baseUrl, model, artistName, trackName, sourceLyrics);
  } catch (err) {
    if (!fallbackModel || fallbackModel === model) throw err;
    console.warn(`[TranslateProvider] ⚠️ Ollama 主模型 ${model} 失敗 (${err.message})，改用 fallback 模型 ${fallbackModel}`);
    return ollamaGenerate(baseUrl, fallbackModel, artistName, trackName, sourceLyrics);
  }
}
