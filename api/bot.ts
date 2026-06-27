import { webhookCallback } from 'grammy';
import { bot } from '../src/bot';
import { claimUpdate, markUpdateSent, markUpdateFailed } from '../src/supabase/client';
import { updateErrors } from '../src/utils/updateState';

// Build a Grammy handler that we call manually after the dedupe gate.
const grammyHandler = webhookCallback(bot, 'http');

export default async function handler(req: any, res: any) {
  const update = req.body;

  // -------------------------------------------------------------------------
  // Extract Telegram identifiers for logging and deduplication.
  // -------------------------------------------------------------------------
  const updateId: number | undefined = update?.update_id;
  const telegramUserId: number | undefined =
    update?.message?.from?.id ?? update?.callback_query?.from?.id;
  const chatId: number | undefined =
    update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id;
  const messageId: number | undefined =
    update?.message?.message_id ?? update?.callback_query?.message?.message_id;

  console.log(
    `[Webhook] Received update_id=${updateId} telegram_user_id=${telegramUserId} ` +
    `chat_id=${chatId} message_id=${messageId}`
  );

  // -------------------------------------------------------------------------
  // Deduplication gate — only run when we have enough context.
  // -------------------------------------------------------------------------
  if (updateId !== undefined && telegramUserId !== undefined && chatId !== undefined) {
    let claimResult: 'claimed' | 'ignore' | 'takeover' | 'skip';

    try {
      claimResult = await claimUpdate(
        updateId,
        telegramUserId,
        chatId,
        messageId ?? 0
      );
    } catch (dbError) {
      // If the DB call itself fails, log and fall through — better to risk a
      // duplicate than to silently drop a message.
      console.error(`[Webhook] claimUpdate threw — falling through without dedupe:`, dbError);
      return grammyHandler(req, res);
    }

    console.log(`[Webhook] update_id=${updateId} claim result: ${claimResult}`);

    if (claimResult === 'ignore' || claimResult === 'skip') {
      // Another instance owns this update — acknowledge Telegram and stop.
      return res.status(200).send('OK');
    }

    // 'claimed' or 'takeover' — we are responsible for processing this update.
    try {
      // Make sure we clean up any pre-existing errors for this updateId (e.g. from previous retries)
      updateErrors.delete(updateId);

      await grammyHandler(req, res);

      // Check if an error was captured inside the Grammy execution chain
      const botError = updateErrors.get(updateId);
      if (botError) {
        updateErrors.delete(updateId);
        throw botError;
      }

      // Grammy resolved without throwing, which means the Telegram reply was
      // attempted inside the handler chain. Mark as sent.
      console.log(`[Webhook] update_id=${updateId} processing complete — marking sent.`);
      await markUpdateSent(updateId);
    } catch (processingError: any) {
      const errMsg = processingError?.message ?? String(processingError);
      console.error(`[Webhook] update_id=${updateId} processing FAILED:`, errMsg);
      await markUpdateFailed(updateId, errMsg);

      // Return 200 so Telegram does not keep retrying something that already
      // threw on our side (we'll catch it via Vercel logs / markUpdateFailed).
      if (!res.headersSent) {
        return res.status(200).send('OK');
      }
    }

    return;
  }

  // -------------------------------------------------------------------------
  // No update_id / user context available (e.g. health check pings).
  // Just pass through to Grammy without deduplication.
  // -------------------------------------------------------------------------
  console.log(`[Webhook] update has no identifiable user — skipping dedupe, passing through.`);
  return grammyHandler(req, res);
}
