import { webhookCallback } from 'grammy';
import { bot } from '../src/bot';
import { supabase } from '../src/supabase/client';

const grammyHandler = webhookCallback(bot, 'http');

export default async function (req: any, res: any) {
  try {
    const update = req.body;
    
    if (update && update.update_id) {
      const updateId = update.update_id;
      const message = update.message || update.callback_query?.message;
      const userId = update.message?.from?.id || update.callback_query?.from?.id;
      const messageId = message?.message_id;

      console.log(`[Webhook] Received update_id: ${updateId}, message_id: ${messageId}, user_id: ${userId}`);

      if (userId) {
        // Idempotency: Check deduplication in Supabase JSONB
        const { data } = await supabase
          .from('user_states')
          .select('journal_draft')
          .eq('telegram_user_id', userId)
          .maybeSingle();

        let draft: any = data?.journal_draft || {};
        if (typeof draft !== 'object' || Array.isArray(draft)) {
          draft = {};
        }

        const processed = draft.processed_updates || [];

        if (processed.includes(updateId)) {
          console.log(`[Webhook] Update ${updateId} was ALREADY PROCESSED! Returning 200 immediately to stop duplicate.`);
          return res.status(200).send('OK');
        }

        // Mark as processed BEFORE continuing to Grammy
        processed.push(updateId);
        draft.processed_updates = processed.slice(-20); // Keep last 20 to avoid bloating JSONB

        await supabase
          .from('user_states')
          .upsert({ 
            telegram_user_id: userId, 
            journal_draft: draft,
            updated_at: new Date().toISOString()
          }, { onConflict: 'telegram_user_id' });
          
        console.log(`[Webhook] Update ${updateId} marked as processed.`);
      }
    }
  } catch (error) {
    console.error(`[Webhook] Error in deduplication logic:`, error);
  }

  // Pass to grammy
  return grammyHandler(req, res);
}
