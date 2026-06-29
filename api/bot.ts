import { webhookCallback } from 'grammy';
import { bot } from '../src/bot';
import {
  claimUpdate,
  getUserState,
  getRecentJournals,
  getConversationHistory,
  saveConversationTurn,
  setUserState,
  supabase,
} from '../src/supabase/client';
import { askGemini } from '../src/gemini/client';
import { buildSystemPrompt } from '../src/claude/prompts';

const grammyHandler = webhookCallback(bot, 'http');

const telegramToken = process.env.TELEGRAM_BOT_TOKEN!;

async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
  let res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
  let data = await res.json() as any;
  if (!data.ok && data.description?.includes('parse')) {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    data = await res.json();
  }
  if (!data.ok) throw new Error(`Telegram sendMessage failed: ${data.description}`);
}

async function sendTyping(chatId: number): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${telegramToken}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
    });
  } catch { /* non-fatal */ }
}

function splitMessage(text: string, maxLength = 4000): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let current = text;
  while (current.length > maxLength) {
    let idx = current.lastIndexOf('\n\n', maxLength);
    if (idx === -1) idx = current.lastIndexOf('. ', maxLength);
    if (idx === -1) idx = current.lastIndexOf(' ', maxLength);
    if (idx <= 0) idx = maxLength;
    const slice = current.slice(0, idx + (current[idx] === '.' ? 1 : 0)).trim();
    if (slice) chunks.push(slice);
    current = current.slice(idx).trim();
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * /api/bot — Telegram webhook receiver.
 *
 * Commands → Grammy (fast synchronous path).
 * Regular text/voice → process Gemini inline (300s timeout, no queue needed).
 */
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const update = req.body;
  const updateId: number | undefined = update?.update_id;
  const telegramUserId: number | undefined =
    update?.message?.from?.id ?? update?.callback_query?.from?.id;
  const chatId: number | undefined =
    update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id;
  const messageId: number | undefined =
    update?.message?.message_id ?? update?.callback_query?.message?.message_id;
  const text: string | undefined = update?.message?.text;
  const voiceFileId: string | undefined = update?.message?.voice?.file_id;

  // Commands & callbacks → Grammy
  if ((text && text.startsWith('/')) || update?.callback_query) {
    console.log(`[Webhook] Command/callback → Grammy`);
    return grammyHandler(req, res);
  }

  if (!updateId || !chatId || !telegramUserId || (!text && !voiceFileId)) {
    return res.status(200).send('OK');
  }

  console.log(`[Webhook] update_id=${updateId} user=${telegramUserId} text_len=${text?.length ?? 0} voice=${!!voiceFileId}`);

  // Idempotency — deduplicate
  const claim = await claimUpdate(updateId, telegramUserId, chatId, messageId ?? 0);
  console.log(`[Webhook] claim=${claim}`);
  if (claim === 'ignore' || claim === 'skip') return res.status(200).send('OK');

  // Send typing immediately
  await sendTyping(chatId);

  // Respond to Telegram right away — Telegram needs 200 within a few seconds
  // but the function itself can keep running up to 300s.
  res.status(200).send('OK');

  // --- Heavy async processing continues after response ---
  try {
    const state = await getUserState(telegramUserId);

    if (!state?.family_id) {
      await sendTelegramMessage(chatId, '❌ טרם סיימת הרשמה. כתוב /start');
      return;
    }

    const familyId = state.family_id;
    const parentName = state.display_name || 'Parent';

    let processedText = text || '';

    // Voice: transcribe via Telegram file download → Whisper
    if (voiceFileId) {
      const { transcribeFileId } = await import('../src/handlers/voice');
      try {
        const transcribed = await transcribeFileId(voiceFileId);
        if (transcribed) {
          processedText = transcribed;
          await sendTelegramMessage(chatId, `_שמעתי: "${transcribed}"_`);
        } else {
          await sendTelegramMessage(chatId, 'לא הצלחתי להבין את ההקלטה. נסה להקליד?');
          return;
        }
      } catch {
        await sendTelegramMessage(chatId, 'לא הצלחתי להבין את ההקלטה. נסה להקליד?');
        return;
      }
    }

    // Fetch context
    const [recentJournals, history] = await Promise.all([
      getRecentJournals(familyId, 7),
      getConversationHistory(telegramUserId, 10),
    ]);
    const { data: children } = await supabase.from('children').select('*').eq('family_id', familyId);
    const { data: parents } = await supabase.from('user_states').select('display_name, telegram_user_id').eq('family_id', familyId);
    const { data: memories } = await supabase.from('memories').select('summary').eq('family_id', familyId).eq('status', 'active');

    const familyContext = {
      children: (children || []).map((c: any) => ({ name: c.name, age: Number(c.age), tags: c.profile_tags || [] })),
      parents: (parents || []).map((p: any) => ({ name: p.display_name || 'Parent' })),
      memories: (memories || []).map((m: any) => m.summary),
    };

    const systemPrompt = buildSystemPrompt(recentJournals, 'chat', parentName, familyContext, familyId);

    console.log(`[Webhook] Calling Gemini for update_id=${updateId}...`);
    const response = await askGemini(systemPrompt, history, processedText);
    console.log(`[Webhook] Gemini done. Response length: ${response.length}`);

    // Send in chunks
    const chunks = splitMessage(response);
    for (const chunk of chunks) {
      await sendTelegramMessage(chatId, chunk);
    }

    // Save to DB
    await Promise.all([
      saveConversationTurn(telegramUserId, 'user', processedText, 'chat'),
      saveConversationTurn(telegramUserId, 'assistant', response, 'chat'),
      setUserState(telegramUserId, { current_mode: 'chat' }),
    ]);

    console.log(`[Webhook] update_id=${updateId} complete.`);
  } catch (err: any) {
    console.error(`[Webhook] update_id=${updateId} FAILED:`, err?.message ?? err);
    try {
      await sendTelegramMessage(chatId, '❌ משהו השתבש. נסה שוב.');
    } catch { /* ignore */ }
  }
}
