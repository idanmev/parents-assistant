import { Bot } from 'grammy';
import * as dotenv from 'dotenv';
import { transcribeVoice } from './handlers/voice';
import { handleChat } from './handlers/chat';
import { startJournal, handleJournalStep, autoSaveJournalIfNeeded } from './handlers/journal';
import { sendMorningBriefToUser } from './handlers/morning';
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

  if (!alreadyOnboarded) {
    await startOnboarding(ctx);
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
  const tz = await getUserTimezone(userId);
  await sendMorningBriefToUser(bot, userId, tz);
});

bot.command('weekly', async (ctx) => {
  await ctx.replyWithChatAction('typing');
  await sendWeeklyBrief(bot);
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
  await ctx.replyWithChatAction('typing');

  const transcribed = await transcribeVoice(ctx);
  if (!transcribed) {
    await ctx.reply('לא הצלחתי להבין את ההקלטה. נסה להקליד?');
    return;
  }

  await ctx.reply(`_שמעתי: "${transcribed}"_`, { parse_mode: 'Markdown' });

  const state = await getUserState(userId);
  if (state?.current_mode === 'journal') {
    await handleJournalStep(ctx, transcribed);
  } else {
    await handleChat(ctx, transcribed);
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

  await handleChat(ctx, text);
});

// ─── Scheduler logic has been moved to api/cron.ts for Vercel ───────────────

bot.catch((err) => {
  console.error('Bot error:', err);
});

// For Vercel, we do NOT call bot.start()
// The bot is exported and handled via webhooks in api/bot.ts
