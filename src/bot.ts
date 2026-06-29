import { Bot } from 'grammy';
import * as dotenv from 'dotenv';
import { transcribeVoice } from './handlers/voice';
import { handleChat } from './handlers/chat';
import { startJournal, handleJournalStep, autoSaveJournalIfNeeded } from './handlers/journal';
import { sendMorningBriefToFamily } from './handlers/morning';
import { sendWeeklyBrief } from './handlers/weekly';
import { handleTrip, handleBack, handleBreak } from './handlers/trip';
import { startOnboarding, handleOnboardingStep, handleCountryCallback } from './handlers/onboarding';
import { getUserState, setUserState, getUserTimezone, isOnboarded } from './supabase/client';
import { isAuthorizedUser, getAuthor, getAllUsers } from './utils/users';
import { supabase } from './supabase/client';

dotenv.config();

export const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

// ─── Auth guard ────────────────────────────────────────────────────────────────
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId || !isAuthorizedUser(userId)) {
    await ctx.reply('This bot is private.');
    return;
  }
  await next();
});

// ─── Inline keyboard callbacks (onboarding country selection) ──────────────────
bot.on('callback_query:data', async (ctx) => {
  await handleCountryCallback(ctx);
});

// ─── Commands ──────────────────────────────────────────────────────────────────
bot.command('start', async (ctx) => {
  const userId = ctx.from!.id;
  const alreadyOnboarded = await isOnboarded(userId);
  const startPayload = ctx.match; // e.g., 'invite_ABC12'

  if (!alreadyOnboarded) {
    await startOnboarding(ctx, startPayload);
    return;
  }

  await ctx.reply(
    `👋 *שלום.* אני המאמן שלכם.\n\n` +
      `• שלח לי כל הודעה — אענה כמאמן\n` +
      `• /journal — יומן ערב\n` +
      `• /brief — בריף בוקר עכשיו\n` +
      `• /weekly — ניתוח שבועי\n` +
      `• /trip [ימים] — בריף לפני נסיעה\n` +
      `• /back — בריף חזרה מנסיעה\n` +
      `• /break [שם] — בריף לפני חופשה\n\n` +
      `מה קורה?`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('journal', async (ctx) => {
  await startJournal(ctx);
});

bot.command('brief', async (ctx) => {
  const userId = ctx.from!.id;
  await ctx.replyWithChatAction('typing');
  const state = await getUserState(userId);
  const familyId = state?.family_id;
  if (!familyId) {
    await ctx.reply('טרם סיימת הרשמה. כתוב /start');
    return;
  }
  await sendMorningBriefToFamily(bot, familyId, [userId]);
});

bot.command('weekly', async (ctx) => {
  const userId = ctx.from!.id;
  await ctx.replyWithChatAction('typing');
  const state = await getUserState(userId);
  const familyId = state?.family_id;
  if (!familyId) {
    await ctx.reply('טרם סיימת הרשמה. כתוב /start');
    return;
  }
  await sendWeeklyBrief(bot, familyId, [userId]);
});

bot.command('trip', async (ctx) => {
  await handleTrip(ctx);
});

bot.command('back', async (ctx) => {
  await handleBack(ctx);
});

bot.command('break', async (ctx) => {
  await handleBreak(ctx);
});

bot.command('stop', async (ctx) => {
  const userId = ctx.from!.id;
  await setUserState(userId, { current_mode: null, journal_step: null, journal_draft: null });
  await ctx.reply('בסדר. מה עוד?');
});

// ─── Voice messages ────────────────────────────────────────────────────────────
bot.on('message:voice', async (ctx) => {
  const userId = ctx.from!.id;
  const state = await getUserState(userId);

  if (state?.current_mode === 'journal') {
    // Journal voice: handled synchronously (fast)
    await ctx.replyWithChatAction('typing');
    const transcribed = await transcribeVoice(ctx);
    if (!transcribed) {
      await ctx.reply('לא הצלחתי להבין את ההקלטה. נסה להקליד?');
      return;
    }
    await ctx.reply(`_שמעתי: "${transcribed}"_`, { parse_mode: 'Markdown' });
    await handleJournalStep(ctx, transcribed);
  } else {
    // Chat voice: enqueue — processing-jobs will transcribe + call Gemini
    await ctx.reply('🎤 שמעתי, עונה בעוד רגע...');
  }
});

// ─── Text messages ─────────────────────────────────────────────────────────────
bot.on('message:text', async (ctx) => {
  const userId = ctx.from!.id;
  const text = ctx.message.text.trim();
  const state = await getUserState(userId);

  // Onboarding intercept
  if (state?.journal_step?.startsWith('onboarding_')) {
    const handled = await handleOnboardingStep(ctx, text);
    if (handled) return;
  }

  if (state?.current_mode === 'journal') {
    await handleJournalStep(ctx, text);
    return;
  }

  // Regular chat: do NOT call Gemini here — it will timeout.
  // The job queue (api/bot.ts → process-jobs) handles it asynchronously.
  // This handler only fires if api/bot.ts passed the request to Grammy
  // (e.g., commands). For non-command text api/bot.ts returns 200 directly.
  // Fallback in case this code IS reached:
  await ctx.reply('📨 קיבלתי, עונה בעוד כמה שניות...');
});

// ─── Scheduler logic has been moved to api/cron.ts for Vercel ───────────────

import { updateErrors } from './utils/updateState';

bot.catch((err) => {
  console.error('Bot error:', err);
  const updateId = err.ctx?.update?.update_id;
  if (updateId) {
    updateErrors.set(updateId, err.error);
  }
});


// For Vercel, we do NOT call bot.start()
// The bot is exported and handled via webhooks in api/bot.ts
