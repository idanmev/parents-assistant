import { Bot } from 'grammy';
import { generateMorningBrief } from '../gemini/client';
import { supabase, saveMorningBrief } from '../supabase/client';

async function getJournalsForWeeks(weeks = 4): Promise<string> {
  const since = new Date();
  since.setDate(since.getDate() - weeks * 7);

  const { data, error } = await supabase
    .from('journal_entries')
    .select('date, author, content, what_worked, what_challenged, what_to_try')
    .gte('date', since.toISOString().split('T')[0])
    .order('date', { ascending: true });

  if (error || !data?.length) return '';

  return data
    .map((entry) => {
      const dayOfWeek = new Date(entry.date).toLocaleDateString('en-GB', { weekday: 'long' });
      const parts = [`[${entry.date} ${dayOfWeek} — ${entry.author}]`];
      if (entry.what_worked) parts.push(`✓ ${entry.what_worked}`);
      if (entry.what_challenged) parts.push(`✗ ${entry.what_challenged}`);
      if (entry.what_to_try) parts.push(`→ ${entry.what_to_try}`);
      if (!entry.what_worked && !entry.what_challenged) parts.push(entry.content);
      return parts.join('\n');
    })
    .join('\n\n');
}

async function buildPatternPrompt(journals: string): Promise<string> {
  return `You are analyzing ${Math.round(journals.split('\n\n').length)} journal entries from Idan and Sveta about parenting Maya (6.5, ADHD).

JOURNAL DATA:
${journals}

Analyze this data and write a Monday morning weekly brief. Structure it exactly like this:

**שבוע טוב** 🌱

**דפוס שזיהיתי השבוע:**
[One specific pattern you noticed — e.g. which day of week is hardest, what trigger keeps appearing, what's improving. Be concrete and cite the data. e.g. "4 מתוך 5 הימים הקשים היו אחרי יום שישי עמוס"]

**מה עובד — תמשיכו:**
[One or two specific things that appeared repeatedly as working. Cite who did it and when.]

**מה שמחכה לכם השבוע:**
[Based on patterns — one thing to watch for or prepare for this week. Specific, not generic.]

**עידן ↔ Sveta:**
[One thing where they seem aligned, one thing where their approaches differ and could be discussed. Practical, not critical.]

**הצלחה אחת שאני רוצה שתראו:**
[One specific win from the journals — name the date, name who did what, say why it mattered.]

Keep it warm, specific to this family, under 280 words. In Hebrew, since that's the family's daily language.`;
}

async function buildAlignmentPrompt(journals: string): Promise<string> {
  return `Based on these journal entries from Idan and Sveta over the past weeks:

${journals}

Write a very short alignment note (under 100 words, in Hebrew) that:
1. Names one thing they're handling the same way (aligned)
2. Names one thing where their approaches differ (not a criticism — just a flag to discuss)
3. Suggests one sentence they could agree on this week

Warm, specific, not preachy.`;
}

export async function sendWeeklyBrief(bot: Bot) {
  const IDAN_ID = parseInt(process.env.TELEGRAM_IDAN_ID!);
  const SVETA_ID = parseInt(process.env.TELEGRAM_SVETA_ID!);

  const journals = await getJournalsForWeeks(4);

  if (!journals) {
    const noDataMsg = '📊 *ניתוח שבועי*\n\nאין מספיק יומנים עדיין לזהות דפוסים. המשיכו לכתוב — אחרי שבוע-שבועיים אתחיל לראות דפוסים.';
    if (IDAN_ID) await bot.api.sendMessage(IDAN_ID, noDataMsg, { parse_mode: 'Markdown' });
    if (SVETA_ID) await bot.api.sendMessage(SVETA_ID, noDataMsg, { parse_mode: 'Markdown' });
    return;
  }

  const [patternPrompt] = await Promise.all([buildPatternPrompt(journals)]);

  const weeklyBrief = await generateMorningBrief(patternPrompt);
  await saveMorningBrief('system', `[WEEKLY] ${weeklyBrief}`, [IDAN_ID, SVETA_ID].filter(Boolean));

  const sends: Promise<unknown>[] = [];
  if (IDAN_ID) sends.push(bot.api.sendMessage(IDAN_ID, weeklyBrief, { parse_mode: 'Markdown' }));
  if (SVETA_ID) sends.push(bot.api.sendMessage(SVETA_ID, weeklyBrief, { parse_mode: 'Markdown' }));
  await Promise.all(sends);

  console.log(`Weekly brief sent at ${new Date().toISOString()}`);
}
