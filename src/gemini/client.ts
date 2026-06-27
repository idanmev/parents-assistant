import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODEL = 'gemini-2.5-flash';
const CHAT_MAX_OUTPUT_TOKENS = 4096;
const MORNING_BRIEF_MAX_OUTPUT_TOKENS = 2048;

export async function askGemini(
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string
): Promise<string> {
  const contents = conversationHistory.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  contents.push({ role: 'user', parts: [{ text: userMessage }] });

  console.log(`[Gemini] Model: ${MODEL}, Output Limit: ${CHAT_MAX_OUTPUT_TOKENS}`);
  console.log(`[Gemini] Approx System Prompt Size: ~${systemPrompt.length} chars`);

  let response = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
    },
  });

  let fullText = response.text || '';
  const finishReason = response.candidates?.[0]?.finishReason;

  if (finishReason === 'MAX_TOKENS') {
    console.log(`[Gemini] Response hit MAX_TOKENS (${CHAT_MAX_OUTPUT_TOKENS}). Attempting 1 continuation...`);
    
    contents.push({ role: 'model', parts: [{ text: fullText }] });
    contents.push({ role: 'user', parts: [{ text: 'Please continue exactly where you left off without any introductory text.' }] });

    const continuationResponse = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
      },
    });

    fullText += continuationResponse.text || '';
  } else {
    console.log(`[Gemini] Response finished naturally. Reason: ${finishReason}`);
  }

  return fullText;
}

export async function generateMorningBrief(prompt: string): Promise<string> {
  console.log(`[Gemini] Model: ${MODEL}, Output Limit: ${MORNING_BRIEF_MAX_OUTPUT_TOKENS}`);

  let response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      maxOutputTokens: MORNING_BRIEF_MAX_OUTPUT_TOKENS,
    },
  });

  let fullText = response.text || '';
  const finishReason = response.candidates?.[0]?.finishReason;

  if (finishReason === 'MAX_TOKENS') {
    console.log(`[Gemini] Morning Brief hit MAX_TOKENS. Attempting 1 continuation...`);
    
    const continuationContents = [
      { role: 'user', parts: [{ text: prompt }] },
      { role: 'model', parts: [{ text: fullText }] },
      { role: 'user', parts: [{ text: 'Please continue exactly where you left off.' }] }
    ];

    const continuationResponse = await ai.models.generateContent({
      model: MODEL,
      contents: continuationContents as any, // Cast to any to bypass strict type mismatch if SDK wants Content array
      config: {
        maxOutputTokens: MORNING_BRIEF_MAX_OUTPUT_TOKENS,
      },
    });

    fullText += continuationResponse.text || '';
  } else {
    console.log(`[Gemini] Morning Brief finished naturally. Reason: ${finishReason}`);
  }

  return fullText;
}
