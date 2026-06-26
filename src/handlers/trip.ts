import { Context, Bot } from 'grammy';
import { generateMorningBrief } from '../gemini/client';
import { getRecentJournals } from '../supabase/client';
import { safeSend } from '../utils/send';

async function buildTripPrompt(who: 'idan' | 'sveta', days: number, journals: string): Promise<string> {
  const traveler = who === 'idan' ? 'עידן' : 'Sveta';
  const homeparent = who === 'idan' ? 'Sveta' : 'עידן';

  return `${traveler} is leaving for a work trip for ${days} days. ${homeparent} will be managing Maya and Yonatan alone.

Recent journal context:
${journals || 'No recent journals.'}

Based on Natascha's framework and what you know about this family, write two short briefs in Hebrew:

---
**לפני הנסיעה — ל${traveler}:**
[3-4 bullet points: what to do before leaving — a note in Maya's lunchbox, something to promise, how to say goodbye in a way that reduces regression. Specific and actionable.]

---
**ל${homeparent} — ${days} ימים לבד:**
[What to reduce expectations on. The one highest-leverage tool for solo management. How to handle Maya asking for ${traveler}. One concrete trick for the hardest moment of the solo day — usually bedtime.]

Keep it practical. Under 200 words total. In Hebrew.`;
}

async function buildReturnPrompt(who: 'idan' | 'sveta', journals: string): Promise<string> {
  const returner = who === 'idan' ? 'עידן' : 'Sveta';

  return `${returner} is returning home today from a work trip.

Recent journal context from while they were away:
${journals || 'No recent journals.'}

Based on Natascha's framework, write a re-entry brief in Hebrew:

**${returner} חוזר/ת הביתה היום** 🏠

[What Maya might do in the first hour — excitement, regression, meltdown, or all three. What NOT to do (don't try to re-establish authority immediately, don't over-excite). The one thing that works best for re-entry. How to reconnect with Maya in the first 15 minutes specifically.]

Under 120 words. Warm, specific.`;
}

export async function handleTrip(ctx: Context) {
  const text = ctx.message?.text || '';
  const parts = text.trim().split(/\s+/);
  const days = parseInt(parts[1]) || 5;

  const userId = ctx.from!.id;
  const IDAN_ID = parseInt(process.env.TELEGRAM_IDAN_ID!);
  const who = userId === IDAN_ID ? 'idan' : 'sveta';

  await ctx.replyWithChatAction('typing');

  const journals = await getRecentJournals(4);
  const prompt = await buildTripPrompt(who, days, journals);
  const brief = await generateMorningBrief(prompt);

  await safeSend(ctx, brief);
}

export async function handleBack(ctx: Context) {
  const userId = ctx.from!.id;
  const IDAN_ID = parseInt(process.env.TELEGRAM_IDAN_ID!);
  const who = userId === IDAN_ID ? 'idan' : 'sveta';

  await ctx.replyWithChatAction('typing');

  const journals = await getRecentJournals(7);
  const prompt = await buildReturnPrompt(who, journals);
  const brief = await generateMorningBrief(prompt);

  await safeSend(ctx, brief);
}

export async function handleBreak(ctx: Context) {
  const text = ctx.message?.text || '';
  const parts = text.trim().split(/\s+/);
  const breakName = parts.slice(1).join(' ') || 'חופשה';

  await ctx.replyWithChatAction('typing');

  const journals = await getRecentJournals(4);

  const prompt = `${breakName} starts soon. Maya (6.5, ADHD) historically struggles with school breaks — loss of routine, more time at home, less structure.

Recent journals:
${journals || 'No recent journals.'}

Write a school break prep brief in Hebrew:

**${breakName} — מתכוננים** 📅

**מה לצפות:** [How Maya typically responds to break — what gets harder, what gets easier]
**המבנה המינימלי:** [The 2-3 structure elements to keep even during break — the ones that matter most]
**כלי אחד:** [One specific technique for the hardest moment of break days — usually unstructured afternoon time]
**ציפיות:** [One expectation to lower, one expectation to keep]

Under 150 words. Hebrew. Specific to this family.`;

  const brief = await generateMorningBrief(prompt);
  await safeSend(ctx, brief);
}
