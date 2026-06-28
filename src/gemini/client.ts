import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODEL = 'gemini-2.5-flash';
const CHAT_MAX_OUTPUT_TOKENS = 3072;
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
  console.log(`[Gemini] STARTING generation...`);
  const startTime = Date.now();

  let response = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
    },
  });
  
  console.log(`[Gemini] ENDED generation. Took ${Date.now() - startTime}ms.`);

  let fullText = response.text || '';
  const finishReason = response.candidates?.[0]?.finishReason;

  console.log(`[Gemini] Response finished. Reason: ${finishReason}`);

  if (finishReason === 'MAX_TOKENS') {
    console.log(`[Gemini] MAX_TOKENS reached. Requesting ONE continuation...`);
    const continuationStart = Date.now();
    
    // Add context for continuation
    contents.push({ role: 'model', parts: [{ text: fullText }] });
    contents.push({
      role: 'user',
      parts: [
        {
          text: `You hit the maximum length limit. Please continue your previous answer EXACTLY from where you left off. Do not repeat the beginning. Do not apologize or add conversational filler. Just continue the sentence or paragraph.`,
        },
      ],
    });

    const contResponse = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
      },
    });

    console.log(`[Gemini] Continuation ENDED. Took ${Date.now() - continuationStart}ms. Reason: ${contResponse.candidates?.[0]?.finishReason}`);
    fullText += (contResponse.text || '');
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

  console.log(`[Gemini] Morning Brief finished. Reason: ${finishReason}`);

  return fullText;
}
