import { Context, InlineKeyboard } from 'grammy';
import { setUserState, getUserState, createFamily, getFamilyByInvite } from '../supabase/client';
import { safeSend } from '../utils/send';

const COUNTRY_OPTIONS = [
  { label: '🇮🇱 ישראל', timezone: 'Asia/Jerusalem', week_start: 'sunday', callback: 'tz_il' },
  { label: '🇺🇸 ארה"ב (מזרח)', timezone: 'America/New_York', week_start: 'monday', callback: 'tz_us_east' },
  { label: '🌍 אחר', timezone: '', week_start: 'monday', callback: 'tz_other' },
];

export const COUNTRY_CALLBACK_MAP = Object.fromEntries(
  COUNTRY_OPTIONS.map((o) => [o.callback, o])
);

export async function startOnboarding(ctx: Context, startPayload?: string) {
  const userId = ctx.from!.id;
  
  let familyId: string | null = null;
  let isPartner = false;

  // Handle deep links
  if (startPayload && startPayload.startsWith('invite_')) {
    const inviteCode = startPayload.replace('invite_', '');
    familyId = await getFamilyByInvite(inviteCode);
    if (!familyId) {
      await ctx.reply(`❌ קוד ההזמנה לא תקין או פג תוקף.`);
      return;
    }
    isPartner = true;
  } else {
    // Parent 1 (Or simulated web signup)
    familyId = await createFamily();
    if (!familyId) {
      await ctx.reply(`❌ תקלה ביצירת משפחה חדשה. אנא נסה שוב.`);
      return;
    }
  }

  await setUserState(userId, {
    family_id: familyId,
    current_mode: 'journal', // Block other flows
    journal_step: isPartner ? 'onboarding_partner_name' : 'onboarding_name',
    journal_draft: { is_partner: isPartner ? 'true' : 'false' },
  });

  if (isPartner) {
    await ctx.reply(
      `👋 *ברוך הבא למשפחה!*\n\nלפני שנתחיל, איך לקרוא לך?`,
      { parse_mode: 'Markdown' }
    );
  } else {
    await ctx.reply(
      `👋 *שלום! בוא נגדיר את הפרופיל המשפחתי שלכם.*\n\nאיך לקרוא לך?`,
      { parse_mode: 'Markdown' }
    );
  }
}

export async function handleOnboardingStep(ctx: Context, text: string): Promise<boolean> {
  const userId = ctx.from!.id;
  const state = await getUserState(userId);
  const step = state?.journal_step;

  if (!step?.startsWith('onboarding_')) return false;

  const draft = (state?.journal_draft || {}) as Record<string, string>;

  // Partner Flow
  if (step === 'onboarding_partner_name') {
    draft.display_name = text;
    await setUserState(userId, {
      current_mode: 'journal',
      journal_step: 'onboarding_partner_perspective',
      journal_draft: draft,
    });
    await safeSend(ctx, `נעים מאוד, *${text}*!\n\nלפני שנצא לדרך, כל הורה חווה את הילד בצורה קצת אחרת. מה החלק שהכי מאתגר *אותך* ביומיום מולו?`);
    return true;
  }

  if (step === 'onboarding_partner_perspective') {
    draft.partner_perspective = text;
    // In a real app, we would save this to the AI's child_profile or memories table here.
    await finishOnboarding(ctx, userId, draft, state.family_id);
    return true;
  }

  // Parent 1 Flow
  if (step === 'onboarding_name') {
    draft.display_name = text;

    const keyboard = new InlineKeyboard();
    COUNTRY_OPTIONS.forEach((o) => keyboard.text(o.label, o.callback).row());

    await setUserState(userId, {
      current_mode: 'journal',
      journal_step: 'onboarding_country',
      journal_draft: draft,
    });

    await ctx.reply(
      `נעים, *${text}*! 🙌\n\nבאיזה אזור זמן אתם גרים? (כדי לדעת מתי לשלוח בריפים)`,
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
    await safeSend(ctx, `כתוב את ה-timezone שלך בפורמט IANA (למשל Europe/Paris)`);
    return true;
  }

  if (step === 'onboarding_tz_manual') {
    draft.timezone = text.trim();
    draft.week_start = 'monday';
    await finishOnboarding(ctx, userId, draft, state.family_id);
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
  await finishOnboarding(ctx, userId, draft, state.family_id);
}

async function finishOnboarding(ctx: Context, userId: number, draft: Record<string, string>, familyId: string) {
  // If partner, they inherit the timezone of the family ideally, but for now we'll just set defaults if missing
  const timezone = draft.timezone || 'Asia/Jerusalem';
  const weekStart = draft.week_start || 'sunday';

  await setUserState(userId, {
    current_mode: null,
    journal_step: null,
    journal_draft: null,
    onboarded: true,
    display_name: draft.display_name,
  });

  const { supabase } = await import('../supabase/client');
  await supabase.from('user_states').update({
    timezone,
    week_start: weekStart,
  }).eq('telegram_user_id', userId);

  // If this is Parent 1, fetch their invite code to share
  if (draft.is_partner === 'false') {
    const { data: family } = await supabase.from('families').select('invite_code').eq('id', familyId).single();
    const inviteLink = `https://t.me/${ctx.me.username}?start=invite_${family.invite_code}`;
    
    await safeSend(
      ctx,
      `✅ *הפרופיל המשפחתי הוקם בהצלחה, ${draft.display_name}!*\n\n` +
      `כדי שהמערכת תלמד את התמונה המלאה, הזמן את בן/בת הזוג שלך דרך הלינק הזה:\n${inviteLink}\n\n` +
      `עכשיו — אתה יכול לשתף אותי בקושי הראשון שלכם.`
    );
  } else {
    await safeSend(
      ctx,
      `✅ *מעולה, ${draft.display_name}. הפרופיל שלך סונכרן עם המשפחה.*\n\n` +
      `אני כאן למקרי חירום (SOS) או סתם כדי לפרוק בסוף היום.`
    );
  }
}
