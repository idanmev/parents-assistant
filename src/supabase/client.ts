import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function getRecentJournals(days = 7): Promise<string> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await supabase
    .from('journal_entries')
    .select('date, author, content, what_worked, what_challenged, what_to_try')
    .gte('date', since.toISOString().split('T')[0])
    .order('date', { ascending: false })
    .limit(10);

  if (error || !data?.length) return '';

  return data
    .map((entry) => {
      const parts = [`[${entry.date} — ${entry.author}]`, entry.content];
      if (entry.what_worked) parts.push(`✓ What worked: ${entry.what_worked}`);
      if (entry.what_challenged) parts.push(`✗ What challenged: ${entry.what_challenged}`);
      if (entry.what_to_try) parts.push(`→ To try: ${entry.what_to_try}`);
      return parts.join('\n');
    })
    .join('\n\n---\n\n');
}

export async function saveJournalEntry(
  author: 'idan' | 'sveta',
  content: string,
  structured?: { what_worked?: string; what_challenged?: string; what_to_try?: string },
  messageId?: number
) {
  const { error } = await supabase.from('journal_entries').insert({
    author,
    content,
    ...structured,
    raw_telegram_message_id: messageId,
  });

  if (error) console.error('Error saving journal entry:', error);
}

export async function saveConversationTurn(
  telegramUserId: number,
  role: 'user' | 'assistant',
  content: string,
  mode: 'sos' | 'chat' | 'morning' | 'journal'
) {
  const { error } = await supabase.from('conversations').insert({
    telegram_user_id: telegramUserId,
    role,
    content,
    mode,
  });

  if (error) console.error('Error saving conversation:', error);
}

export async function getConversationHistory(
  telegramUserId: number,
  limit = 10
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const { data, error } = await supabase
    .from('conversations')
    .select('role, content')
    .eq('telegram_user_id', telegramUserId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data?.length) return [];

  return data.reverse().map((row) => ({
    role: row.role as 'user' | 'assistant',
    content: row.content,
  }));
}

export async function getUserState(telegramUserId: number) {
  const { data } = await supabase
    .from('user_states')
    .select('*')
    .eq('telegram_user_id', telegramUserId)
    .single();

  return data;
}

export async function setUserState(
  telegramUserId: number,
  state: {
    current_mode?: string | null;
    journal_step?: string | null;
    journal_draft?: Record<string, string> | null;
  }
) {
  const { error } = await supabase.from('user_states').upsert({
    telegram_user_id: telegramUserId,
    ...state,
    updated_at: new Date().toISOString(),
  });

  if (error) console.error('Error setting user state:', error);
}

export async function getUserTimezone(telegramUserId: number): Promise<string> {
  const { data } = await supabase
    .from('user_states')
    .select('timezone')
    .eq('telegram_user_id', telegramUserId)
    .single();
  return data?.timezone || 'Asia/Jerusalem';
}

export async function isOnboarded(telegramUserId: number): Promise<boolean> {
  const { data } = await supabase
    .from('user_states')
    .select('onboarded')
    .eq('telegram_user_id', telegramUserId)
    .single();
  return data?.onboarded === true;
}

export async function hasJournalToday(author: 'idan' | 'sveta'): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('author', author)
    .eq('date', today)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export async function getTodayConversations(telegramUserId: number): Promise<string> {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('conversations')
    .select('role, content')
    .eq('telegram_user_id', telegramUserId)
    .gte('created_at', `${today}T00:00:00`)
    .order('created_at', { ascending: true });

  if (error || !data?.length) return '';

  return data
    .map((row) => `${row.role === 'user' ? 'הורה' : 'מאמן'}: ${row.content}`)
    .join('\n');
}

export async function saveMorningBrief(content: string) {
  const today = new Date().toISOString().split('T')[0];
  const { error } = await supabase.from('morning_briefs').insert({
    date: today,
    content,
  });

  if (error) console.error('Error saving morning brief:', error);
}

// ---------------------------------------------------------------------------
// Webhook Idempotency — used exclusively from api/bot.ts
// ---------------------------------------------------------------------------

const STALE_PROCESSING_THRESHOLD_MS = 90_000; // 90 seconds

/**
 * Attempts to claim an incoming Telegram update_id atomically.
 *
 * Returns:
 *   'claimed'   — insert succeeded; this instance owns processing.
 *   'ignore'    — a recent processing/sent row exists; ignore this retry.
 *   'takeover'  — a stale/failed row exists and this instance successfully
 *                 took ownership via a conditional UPDATE; process it.
 *   'skip'      — another instance beat us to the stale-takeover UPDATE.
 */
export async function claimUpdate(
  updateId: number,
  telegramUserId: number,
  chatId: number,
  messageId: number
): Promise<'claimed' | 'ignore' | 'takeover' | 'skip'> {
  console.log(`[DB] Attempting claim insertion for update_id ${updateId}`);
  // 1. Optimistic insert — this is the primary race-condition guard.
  //    PostgreSQL PRIMARY KEY guarantees at most one insert wins.
  const { error: insertError } = await supabase.from('processed_updates').insert({
    update_id: updateId,
    telegram_user_id: telegramUserId,
    chat_id: chatId,
    message_id: messageId,
    status: 'processing',
  });

  if (!insertError) {
    console.log(`[DB] update_id ${updateId} insert succeeded: claimed`);
    // We inserted successfully — we own this update.
    return 'claimed';
  }

  // If it's a duplicate key violation (code '23505'), this is expected.
  // Any other error code (like RLS code '42501') indicates a configuration issue.
  if (insertError.code !== '23505') {
    console.error(`[DB] claimUpdate unexpected INSERT error for update_id ${updateId}:`, {
      code: insertError.code,
      message: insertError.message,
      details: insertError.details,
      hint: insertError.hint
    });
  }

  // Insert failed (duplicate key / other error). Fetch the existing row.
  const { data: existing, error: selectError } = await supabase
    .from('processed_updates')
    .select('status, updated_at')
    .eq('update_id', updateId)
    .maybeSingle();

  if (selectError) {
    console.error(`[DB] claimUpdate SELECT error for update_id ${updateId}:`, {
      code: selectError.code,
      message: selectError.message,
      details: selectError.details
    });
    return 'ignore';
  }

  if (!existing) {
    console.log(`[DB] update_id ${updateId} not found in DB after failed insert. Ignoring.`);
    return 'ignore';
  }

  console.log(`[DB] update_id ${updateId} existing status: ${existing.status}, age: ${Date.now() - new Date(existing.updated_at).getTime()}ms`);

  if (existing.status === 'sent') {
    // Already completed successfully — ignore retry.
    return 'ignore';
  }

  const ageMs = Date.now() - new Date(existing.updated_at).getTime();

  if (existing.status === 'processing' && ageMs < STALE_PROCESSING_THRESHOLD_MS) {
    // Another instance is actively processing this — ignore retry.
    return 'ignore';
  }

  // Status is 'failed' OR 'processing' and stale — attempt conditional takeover.
  // The WHERE clause ensures only one Vercel instance wins even if two race here.
  const thresholdISO = new Date(Date.now() - STALE_PROCESSING_THRESHOLD_MS).toISOString();

  console.log(`[DB] update_id ${updateId} is stale or failed. Attempting takeover...`);
  const { data: takeoverData, error: updateError } = await supabase
    .from('processed_updates')
    .update({
      status: 'processing',
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq('update_id', updateId)
    .or(`status.eq.failed,and(status.eq.processing,updated_at.lt.${thresholdISO})`)
    .select('update_id');

  if (updateError) {
    console.error(`[DB] claimUpdate TAKEOVER error for update_id ${updateId}:`, {
      code: updateError.code,
      message: updateError.message,
      details: updateError.details
    });
    return 'skip';
  }

  if ((takeoverData?.length ?? 0) > 0) {
    console.log(`[DB] update_id ${updateId} takeover succeeded.`);
    return 'takeover';
  }

  console.log(`[DB] update_id ${updateId} takeover skipped (another instance probably won the race).`);
  // Another instance won the takeover race — ignore.
  return 'skip';
}

/** Called from api/bot.ts after Grammy + Gemini + Telegram send all succeed. */
export async function markUpdateSent(updateId: number): Promise<void> {
  const { error } = await supabase
    .from('processed_updates')
    .update({ status: 'sent', updated_at: new Date().toISOString() })
    .eq('update_id', updateId);

  if (error) {
    console.error(`[DB] Failed to mark update ${updateId} as sent:`, {
      code: error.code,
      message: error.message,
      details: error.details
    });
  } else {
    console.log(`[DB] update_id ${updateId} marked as sent successfully.`);
  }
}

/** Called from api/bot.ts if Grammy / Gemini / Telegram send throws. */
export async function markUpdateFailed(updateId: number, errorMessage: string): Promise<void> {
  const { error } = await supabase
    .from('processed_updates')
    .update({
      status: 'failed',
      error_message: errorMessage.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('update_id', updateId);

  if (error) {
    console.error(`[DB] Failed to mark update ${updateId} as failed:`, {
      code: error.code,
      message: error.message,
      details: error.details
    });
  } else {
    console.log(`[DB] update_id ${updateId} marked as failed successfully.`);
  }
}

