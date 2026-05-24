import { Context, InlineKeyboard } from 'grammy';
import { setUserState, getUserState } from '../supabase/client';
import { safeSend } from '../utils/send';

const COUNTRY_OPTIONS = [
  { label: '🇮🇱 ישראל', timezone: 'Asia/Jerusalem', week_start: 'sunday', callback: 'tz_il' },
  { label: '🇹🇭 תאילנד', timezone: 'Asia/Bangkok', week_start: 'monday', callback: 'tz_th' },
  { label: '🇺🇸 ארה"ב (מזרח)', timezone: 'America/New_York', week_start: 'monday', callback: 'tz_us_east' },
  { label: '🇺🇸 ארה"ב (מערב)', timezone: 'America/Los_Angeles', week_start: 'monday', callback: 'tz_us_west' },
  { label: '🇬🇧 בריטניה', timezone: 'Europe/London', week_start: 'monday', callback: 'tz_uk' },
  { label: '🇩🇪 אירופה (מרכז)', timezone: 'Europe/Berlin', week_start: 'monday', callback: 'tz_eu' },
  { label: '🇦🇺 אוסטרליה', timezone: 'Australia/Sydney', week_start: 'monday', callback: 'tz_au' },
  { label: '🌍 אחר', timezone: '', week_start: 'monday', callback: 'tz_other' },
];

export const COUNTRY_CALLBACK_MAP = Object.fromEntries(
  COUNTRY_OPTIONS.map((o) => [o.callback, o])
);

export async function startOnboarding(ctx: Context) {
  const userId = ctx.from!.id;

  await setUserState(userId, {
    current_mode: 'journal', // reuse mode slot to block other flows during onboarding
    journal_step: 'onboarding_name',
    journal_draft: {},
  });

  await ctx.reply(
    `👋 *שלום! בוא נגדיר אותך תוך דקה.*\n\nאיך לקרוא לך?`,
    { parse_mode: 'Markdown' }
  );
}

export async function handleOnboardingStep(ctx: Context, text: string): Promise<boolean> {
  const userId = ctx.from!.id;
  const state = await getUserState(userId);
  const step = state?.journal_step;

  if (!step?.startsWith('onboarding_')) return false;

  const draft = (state?.journal_draft || {}) as Record<string, string>;

  if (step === 'onboarding_name') {
    draft.display_name = text;

    const keyboard = new InlineKeyboard();
    COUNTRY_OPTIONS.slice(0, 4).forEach((o) => keyboard.text(o.label, o.callback).row());
    COUNTRY_OPTIONS.slice(4).forEach((o) => keyboard.text(o.label, o.callback).row());

    await setUserState(userId, {
      current_mode: 'journal',
      journal_step: 'onboarding_country',
      journal_draft: draft,
    });

    await ctx.reply(
      `נעים, *${text}*! 🙌\n\nאיפה אתה גר? (כדי לדעת מתי לשלוח בריפים)`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    return true;
  }

  if (step === 'onboarding_country' && text === 'tz_other') {
    await setUserState(userId, {
      current_mode: 'journal',
      journal_step: 'onboarding_tz_manual',
      journal_draft: draft,
    });
    await safeSend(ctx, `כתוב את ה-timezone שלך בפורמט IANA, למשל:\nAsia/Bangkok, Europe/Paris, America/Chicago`);
    return true;
  }

  if (step === 'onboarding_tz_manual') {
    draft.timezone = text.trim();
    draft.week_start = 'monday';
    await finishOnboarding(ctx, userId, draft);
    return true;
  }

  return false;
}

export async function handleCountryCallback(ctx: Context) {
  const userId = ctx.from!.id;
  const callbackData = ctx.callbackQuery?.data;
  if (!callbackData) return;

  const state = await getUserState(userId);
  if (state?.journal_step !== 'onboarding_country') return;

  const draft = (state?.journal_draft || {}) as Record<string, string>;

  if (callbackData === 'tz_other') {
    await ctx.answerCallbackQuery();
    await handleOnboardingStep(ctx, 'tz_other');
    return;
  }

  const option = COUNTRY_CALLBACK_MAP[callbackData];
  if (!option) return;

  draft.timezone = option.timezone;
  draft.week_start = option.week_start;

  await ctx.answerCallbackQuery();
  await finishOnboarding(ctx, userId, draft);
}

async function finishOnboarding(ctx: Context, userId: number, draft: Record<string, string>) {
  await setUserState(userId, {
    current_mode: null,
    journal_step: null,
    journal_draft: null,
    // @ts-ignore — extra fields stored via upsert
    timezone: draft.timezone,
    week_start: draft.week_start,
    onboarded: true,
    display_name: draft.display_name,
  });

  // Also save extra fields directly
  const { supabase } = await import('../supabase/client');
  await supabase.from('user_states').upsert({
    telegram_user_id: userId,
    timezone: draft.timezone,
    week_start: draft.week_start,
    onboarded: true,
    display_name: draft.display_name,
    updated_at: new Date().toISOString(),
  });

  const localTime = new Date().toLocaleString('he-IL', {
    timeZone: draft.timezone,
    hour: '2-digit',
    minute: '2-digit',
  });

  await safeSend(
    ctx,
    `✅ *מוכן, ${draft.display_name}!*\n\n` +
      `📍 Timezone: ${draft.timezone} (עכשיו ${localTime})\n` +
      `📅 שבוע מתחיל ב: ${draft.week_start === 'sunday' ? 'ראשון' : 'שני'}\n\n` +
      `הבריף הבוקר יגיע ב-7:00 בבוקר לפי השעה שלך.\n\n` +
      `עכשיו — ספר לי מה קורה.`
  );
}
