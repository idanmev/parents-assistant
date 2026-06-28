import { Context } from 'grammy';
import { safeSend } from '../utils/send';
import { askGemini } from '../gemini/client';
import { buildSystemPrompt, FamilyContext } from '../claude/prompts';
import {
  getRecentJournals,
  saveConversationTurn,
  getConversationHistory,
  setUserState,
  getUserState,
  supabase
} from '../supabase/client';

export async function handleChat(ctx: Context, userMessage: string) {
  const userId = ctx.from!.id;
  const state = await getUserState(userId);
  
  if (!state?.family_id) {
    await safeSend(ctx, `❌ טרם סיימת הרשמה. כתוב /start`);
    return;
  }
  const familyId = state.family_id;
  const parentName = state.display_name || 'Parent';

  await ctx.replyWithChatAction('typing');

  const [recentJournals, history] = await Promise.all([
    getRecentJournals(familyId, 7),
    getConversationHistory(userId, 10),
  ]);

  const { data: children } = await supabase.from('children').select('*').eq('family_id', familyId);
  const { data: parents } = await supabase.from('user_states').select('display_name, telegram_user_id').eq('family_id', familyId);
  const { data: memories } = await supabase.from('memories').select('summary').eq('family_id', familyId).eq('status', 'active');
  
  const familyContext: FamilyContext = {
    children: (children || []).map(c => ({ name: c.name, age: Number(c.age), tags: c.profile_tags || [] })),
    parents: (parents || []).map(p => ({ name: p.display_name || 'Parent' })),
    memories: (memories || []).map(m => m.summary)
  };

  const systemPrompt = buildSystemPrompt(recentJournals, 'chat', parentName, familyContext);

  const response = await askGemini(systemPrompt, history, userMessage);

  await safeSend(ctx, response);

  await Promise.all([
    saveConversationTurn(userId, 'user', userMessage, 'chat'),
    saveConversationTurn(userId, 'assistant', response, 'chat'),
    setUserState(userId, { current_mode: 'chat' }),
  ]);
}
