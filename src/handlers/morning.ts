import { Bot } from 'grammy';
import { generateMorningBrief } from '../claude/client';
import { buildMorningBriefPrompt } from '../claude/prompts';
import { getRecentJournals, saveMorningBrief } from '../supabase/client';

async function buildAndSendBrief(bot: Bot, userIds: number[]) {
  const recentJournals = await getRecentJournals(3);
  const prompt = buildMorningBriefPrompt(recentJournals);
  const brief = await generateMorningBrief(prompt);

  await saveMorningBrief(brief);

  await Promise.all(
    userIds.map((id) =>
      bot.api.sendMessage(id, brief, { parse_mode: 'Markdown' }).catch((err) => {
        console.error(`Failed to send morning brief to ${id}:`, err.message);
      })
    )
  );

  console.log(`Morning brief sent at ${new Date().toISOString()}`);
}

// Send to a single user (per-user timezone scheduler)
export async function sendMorningBriefToUser(bot: Bot, telegramId: number, _timezone: string) {
  await buildAndSendBrief(bot, [telegramId]);
}

// Legacy — send to all users at once
export async function sendMorningBriefs(bot: Bot) {
  const IDAN_ID = parseInt(process.env.TELEGRAM_IDAN_ID!);
  const SVETA_ID = parseInt(process.env.TELEGRAM_SVETA_ID!);
  const ids = [IDAN_ID, SVETA_ID].filter(Boolean);
  await buildAndSendBrief(bot, ids);
}
