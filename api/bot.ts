import { webhookCallback } from 'grammy';
import { bot } from '../src/bot';
import { claimUpdate, enqueueJob } from '../src/supabase/client';

const grammyHandler = webhookCallback(bot, 'http');

/**
 * /api/bot — Telegram webhook receiver.
 *
 * This endpoint does NOT call Gemini. It returns HTTP 200 immediately.
 * Heavy processing (Gemini + Telegram reply) happens in /api/process-jobs.
 *
 * Flow:
 *  1. Parse Telegram update.
 *  2. If it's a command or callback, pass to Grammy synchronously.
 *  3. Otherwise, deduplicate via processed_updates (claimUpdate).
 *  4. Enqueue text or [VOICE]file_id into telegram_jobs.
 *  5. Return 200 to Telegram immediately.
 */
export default async function handler(req: any, res: any) {
  // Only accept POST from Telegram
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

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

  // Pass commands and callbacks to Grammy synchronously (they are fast)
  if ((text && text.startsWith('/')) || update?.callback_query) {
    console.log(`[Webhook] Command or callback detected — delegating to Grammy.`);
    return grammyHandler(req, res);
  }

  console.log(
    `[Webhook] update_id=${updateId} user=${telegramUserId} chat=${chatId} msg=${messageId} ` +
    `text_len=${text?.length ?? 0} voice=${!!voiceFileId}`
  );

  // Always return 200 quickly. Only do minimal work first.
  if (!updateId || !chatId || !telegramUserId) {
    console.log(`[Webhook] Missing required fields — returning 200 with no action.`);
    return res.status(200).send('OK');
  }

  let contentToQueue = text;
  if (voiceFileId) {
    contentToQueue = `[VOICE]${voiceFileId}`;
  }

  if (!contentToQueue) {
    console.log(`[Webhook] Non-text/non-voice update — returning 200 with no action.`);
    return res.status(200).send('OK');
  }

  try {
    // Idempotency check
    const claim = await claimUpdate(updateId, telegramUserId, chatId, messageId ?? 0);
    console.log(`[Webhook] update_id=${updateId} claim result: ${claim}`);

    if (claim === 'ignore' || claim === 'skip') {
      return res.status(200).send('OK');
    }

    // Enqueue for async processing
    await enqueueJob(updateId, telegramUserId, chatId, messageId ?? 0, text);

    return res.status(200).send('OK');
  } catch (err: any) {
    // Even on internal error, return 200 so Telegram does not flood us with retries.
    console.error(`[Webhook] Unexpected error for update_id=${updateId}:`, err?.message ?? err);
    return res.status(200).send('OK');
  }
}
