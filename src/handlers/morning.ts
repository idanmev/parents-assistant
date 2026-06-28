import { Bot } from 'grammy';
import { generateMorningBrief } from '../gemini/client';
import { buildMorningBriefPrompt, FamilyContext } from '../claude/prompts';
import { getRecentJournals, saveMorningBrief, supabase } from '../supabase/client';

export async function sendMorningBriefToFamily(bot: Bot, familyId: string, telegramIds: number[]) {
  // 1. Fetch recent journals for this family
  const recentJournals = await getRecentJournals(familyId, 3);
  
  // 2. Fetch family context
  const { data: children } = await supabase.from('children').select('*').eq('family_id', familyId);
  const { data: parents } = await supabase.from('user_states').select('display_name, telegram_user_id').eq('family_id', familyId).in('telegram_user_id', telegramIds);
  const { data: memories } = await supabase.from('memories').select('summary').eq('family_id', familyId).eq('status', 'active');

  const familyContext: FamilyContext = {
    children: (children || []).map(c => ({ name: c.name, age: Number(c.age), tags: c.profile_tags || [] })),
    parents: (parents || []).map(p => ({ name: p.display_name || 'Parent' })),
    memories: (memories || []).map(m => m.summary)
  };

  // 3. Build prompt and generate
  const prompt = buildMorningBriefPrompt(recentJournals, familyContext);
  const brief = await generateMorningBrief(prompt);

  // 4. Save to DB
  await saveMorningBrief(familyId, brief, telegramIds);

  // 5. Send to all parents in this batch
  await Promise.all(
    telegramIds.map((id) =>
      bot.api.sendMessage(id, brief, { parse_mode: 'Markdown' }).catch((err) => {
        console.error(`Failed to send morning brief to ${id}:`, err.message);
      })
    )
  );

  console.log(`Morning brief sent for family ${familyId} at ${new Date().toISOString()}`);
}
