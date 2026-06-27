import { claimUpdate, enqueueJob } from '../src/supabase/client';

/**
 * /api/bot — Telegram webhook receiver.
 *
 * This endpoint does NOT call Gemini. It returns HTTP 200 immediately.
 * Heavy processing (Gemini + Telegram reply) happens in /api/process-jobs.
 *
 * Flow:
 *  1. Parse Telegram update (only text messages are handled for now).
 *  2. Deduplicate via processed_updates (claimUpdate).
 *  3. Enqueue into telegram_jobs.
 *  4. Return 200 to Telegram immediately.
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

  // Extract text — only plain text messages are queued for AI processing.
  // Commands (/start, /journal, etc.) and other update types are ignored for now.
  const text: string | undefined = update?.message?.text;

  console.log(
    `[Webhook] update_id=${updateId} user=${telegramUserId} chat=${chatId} msg=${messageId} ` +
    `text_len=${text?.length ?? 0}`
  );

  // Always return 200 quickly. Only do minimal work first.
  if (!updateId || !chatId || !telegramUserId) {
    console.log(`[Webhook] Missing required fields — returning 200 with no action.`);
    return res.status(200).send('OK');
  }

  // Skip non-text updates (voice, stickers, etc.) — they have their own handlers
  // but they're synchronous right now. This PR only queues text messages.
  if (!text) {
    console.log(`[Webhook] Non-text update — returning 200 with no action.`);
    return res.status(200).send('OK');
  }

  // Skip commands — they need synchronous Grammy handling (short and fast).
  if (text.startsWith('/')) {
    console.log(`[Webhook] Command detected — returning 200, commands handled elsewhere.`);
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
