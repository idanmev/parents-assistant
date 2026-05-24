import { Context } from 'grammy';
import { supabase } from '../supabase/client';

export async function handleSettings(ctx: Context) {
  await ctx.reply(
    `⚙️ *הגדרות*\n\nאיזה יום מתחיל אצלכם השבוע?\n\n` +
      `/week_sunday — ראשון (ישראל 🇮🇱)\n` +
      `/week_monday — שני (תאילנד 🇹🇭 / רוב העולם)`,
    { parse_mode: 'Markdown' }
  );
}

export async function setWeekStart(ctx: Context, day: 'sunday' | 'monday') {
  const userId = ctx.from!.id;
  const IDAN_ID = parseInt(process.env.TELEGRAM_IDAN_ID!);
  const SVETA_ID = parseInt(process.env.TELEGRAM_SVETA_ID!);

  // Store for both parents — it's a family setting
  const updates = [];
  if (IDAN_ID) updates.push(upsertSetting('week_start', day, IDAN_ID));
  if (SVETA_ID) updates.push(upsertSetting('week_start', day, SVETA_ID));
  await Promise.all(updates);

  const label = day === 'sunday' ? 'ראשון (ישראל)' : 'שני (תאילנד / רוב העולם)';
  await ctx.reply(`✅ הבנתי — השבוע מתחיל ב${label}. הניתוח השבועי ישלח בהתאם.`);
}

async function upsertSetting(key: string, value: string, userId: number) {
  await supabase.from('user_states').upsert(
    { telegram_user_id: userId, [key]: value, updated_at: new Date().toISOString() },
    { onConflict: 'telegram_user_id' }
  );
}

export async function getWeekStart(): Promise<'sunday' | 'monday'> {
  const IDAN_ID = parseInt(process.env.TELEGRAM_IDAN_ID!);
  const { data } = await supabase
    .from('user_states')
    .select('week_start')
    .eq('telegram_user_id', IDAN_ID)
    .single();

  return (data?.week_start as 'sunday' | 'monday') || 'sunday';
}
