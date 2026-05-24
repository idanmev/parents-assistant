import { Context } from 'grammy';
import { askClaude } from '../claude/client';
import { buildSystemPrompt } from '../claude/prompts';
import {
  getRecentJournals,
  saveConversationTurn,
  getConversationHistory,
  setUserState,
} from '../supabase/client';
import { safeSend } from '../utils/send';
import { getAuthor } from '../utils/users';

export async function handleSOS(ctx: Context, userMessage: string) {
  const userId = ctx.from!.id;
  const author = getAuthor(userId);
  await ctx.replyWithChatAction('typing');

  const [recentJournals, history] = await Promise.all([
    getRecentJournals(7),
    getConversationHistory(userId, 6),
  ]);

  const systemPrompt = buildSystemPrompt(recentJournals, 'sos', author);

  const response = await askClaude(systemPrompt, history, userMessage);

  await safeSend(ctx, response);

  await Promise.all([
    saveConversationTurn(userId, 'user', userMessage, 'sos'),
    saveConversationTurn(userId, 'assistant', response, 'sos'),
    setUserState(userId, { current_mode: 'sos' }),
  ]);
}
