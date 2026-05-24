import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

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
