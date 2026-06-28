import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function createFamily(): Promise<string | null> {
  const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  console.log(`[createFamily] Attempting to insert family with invite code: ${inviteCode}`);
  
  const { data, error } = await supabase.from('families').insert({
    invite_code: inviteCode
  }).select('id').single();
  
  if (error) {
    console.error('[createFamily] FAILED to create family. Full error:', JSON.stringify({
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    }));
    return null;
  }
  
  console.log(`[createFamily] Success. Family created with id: ${data.id}`);
  return data.id;
}

export async function getFamilyByInvite(inviteCode: string): Promise<string | null> {
  const { data, error } = await supabase.from('families').select('id').eq('invite_code', inviteCode.toUpperCase()).single();
  if (error) return null;
  return data.id;
}
export async function getRecentJournals(familyId: string, days = 7): Promise<string> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await supabase
    .from('journal_entries')
    .select('date, telegram_user_id, content, what_worked, what_challenged, what_to_try')
    .eq('family_id', familyId)
    .gte('date', since.toISOString().split('T')[0])
    .order('date', { ascending: false })
    .limit(10);

  if (error || !data?.length) return '';

  return data
    .map((entry) => {
      const parts = [`[${entry.date} — User ${entry.telegram_user_id}]`, entry.content];
      if (entry.what_worked) parts.push(`✓ What worked: ${entry.what_worked}`);
      if (entry.what_challenged) parts.push(`✗ What challenged: ${entry.what_challenged}`);
      if (entry.what_to_try) parts.push(`→ To try: ${entry.what_to_try}`);
      return parts.join('\n');
    })
    .join('\n\n---\n\n');
}

export async function saveJournalEntry(
  familyId: string,
  telegramUserId: number,
  content: string,
  structured?: { what_worked?: string; what_challenged?: string; what_to_try?: string },
  messageId?: number
) {
  const { error } = await supabase.from('journal_entries').insert({
    family_id: familyId,
    telegram_user_id: telegramUserId,
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
    family_id?: string | null;
    onboarded?: boolean;
    display_name?: string;
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

export async function hasJournalToday(familyId: string, telegramUserId: number): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('family_id', familyId)
    .eq('telegram_user_id', telegramUserId)
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

export async function saveMorningBrief(familyId: string, content: string, telegramUserIds: number[]) {
  const today = new Date().toISOString().split('T')[0];
  const { error } = await supabase.from('morning_briefs').insert({
    family_id: familyId,
    date: today,
    content,
    sent_to_telegram_ids: telegramUserIds
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

// ---------------------------------------------------------------------------
// Telegram Job Queue — enqueue / fetch / update used by api/bot.ts and api/process-jobs.ts
// ---------------------------------------------------------------------------

export interface TelegramJob {
  id: number;
  update_id: number;
  telegram_user_id: number;
  chat_id: number;
  message_id: number;
  text: string;
  status: 'pending' | 'processing' | 'sent' | 'failed';
  priority: 'high' | 'normal' | 'scheduled';
  attempts: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/** Insert a new job. Returns true if inserted, false if update_id already exists. */
export async function enqueueJob(
  updateId: number,
  telegramUserId: number,
  chatId: number,
  messageId: number,
  text: string,
  priority: 'high' | 'normal' | 'scheduled' = 'normal'
): Promise<boolean> {
  const { error } = await supabase.from('telegram_jobs').insert({
    update_id: updateId,
    telegram_user_id: telegramUserId,
    chat_id: chatId,
    message_id: messageId,
    text,
    status: 'pending',
    priority,
  });

  if (error) {
    if (error.code === '23505') {
      console.log(`[Jobs] update_id ${updateId} already in telegram_jobs — skipping enqueue.`);
      return false;
    }
    console.error(`[Jobs] Failed to enqueue update_id ${updateId}:`, {
      code: error.code,
      message: error.message,
    });
    return false;
  }

  console.log(`[Jobs] update_id ${updateId} enqueued successfully.`);
  return true;
}

/**
 * Fetch up to `limit` pending jobs and atomically mark them as processing.
 * Returns the list of jobs now owned by this process.
 */
export async function claimPendingJobs(limit = 5): Promise<TelegramJob[]> {
  // Fetch the oldest pending jobs, prioritizing high priority
  const { data: jobs, error } = await supabase
    .from('telegram_jobs')
    .select('*')
    .eq('status', 'pending')
    .order('priority', { ascending: true }) // 'high' sorts before 'normal'
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error(`[Jobs] Failed to fetch pending jobs:`, error.message);
    return [];
  }

  if (!jobs || jobs.length === 0) return [];

  const ids = jobs.map((j: TelegramJob) => j.id);

  // Mark them processing in one update
  const { error: updateError } = await supabase
    .from('telegram_jobs')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .in('id', ids)
    .eq('status', 'pending'); // guard against race: only update still-pending rows

  if (updateError) {
    console.error(`[Jobs] Failed to mark jobs as processing:`, updateError.message);
    return [];
  }

  console.log(`[Jobs] Claimed ${ids.length} jobs for processing: ${ids.join(', ')}`);
  return jobs as TelegramJob[];
}

/** Mark a job as sent. */
export async function markJobSent(jobId: number): Promise<void> {
  const { error } = await supabase
    .from('telegram_jobs')
    .update({ status: 'sent', updated_at: new Date().toISOString() })
    .eq('id', jobId);

  if (error) console.error(`[Jobs] Failed to mark job ${jobId} as sent:`, error.message);
  else console.log(`[Jobs] Job ${jobId} marked as sent.`);
}

/** Mark a job as failed with an error message. */
export async function markJobFailed(jobId: number, errorMessage: string): Promise<void> {
  const { error } = await supabase
    .from('telegram_jobs')
    .update({
      status: 'failed',
      error_message: errorMessage.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (error) console.error(`[Jobs] Failed to mark job ${jobId} as failed:`, error.message);
  else console.log(`[Jobs] Job ${jobId} marked as failed: ${errorMessage.slice(0, 100)}`);
}
