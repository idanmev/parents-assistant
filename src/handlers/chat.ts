import { Context } from 'grammy';
import { safeSend } from '../utils/send';
import { getAuthor } from '../utils/users';
import { askGemini } from '../gemini/client';
import { buildSystemPrompt } from '../claude/prompts';
import {
  getRecentJournals,
  saveConversationTurn,
  getConversationHistory,
  setUserState,
} from '../supabase/client';

export async function handleChat(ctx: Context, userMessage: string) {
  const userId = ctx.from!.id;
  const author = getAuthor(userId);

  await ctx.replyWithChatAction('typing');

  const [recentJournals, history] = await Promise.all([
    getRecentJournals(7),
    getConversationHistory(userId, 10),
  ]);

  const systemPrompt = buildSystemPrompt(recentJournals, 'chat', author);

  const response = await askGemini(systemPrompt, history, userMessage);

  await safeSend(ctx, response);

  await Promise.all([
    saveConversationTurn(userId, 'user', userMessage, 'chat'),
    saveConversationTurn(userId, 'assistant', response, 'chat'),
    setUserState(userId, { current_mode: 'chat' }),
  ]);
}
