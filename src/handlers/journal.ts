import { Context } from 'grammy';
import { GoogleGenAI } from '@google/genai';
import { saveJournalEntry, getUserState, setUserState, getTodayConversations, hasJournalToday } from '../supabase/client';
import { getAuthor } from '../utils/users';
import { safeSend } from '../utils/send';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function draftJournalFromConversation(
  conversation: string,
  author: 'idan' | 'sveta'
): Promise<{ what_worked: string; what_challenged: string; what_to_try: string; summary: string }> {
  const name = author === 'idan' ? 'עידן' : 'Sveta';

  const prompt = `זו השיחה של ${name} עם הבוט המאמן היום:

${conversation}

על בסיס השיחה, צור טיוטה ליומן ערב בעברית. ענה בדיוק בפורמט הזה (JSON בלבד, ללא טקסט נוסף):
{
  "what_worked": "משפט אחד קצר על מה שעבד היום",
  "what_challenged": "משפט אחד קצר על מה שהיה קשה",
  "what_to_try": "דבר ספציפי אחד לנסות מחר",
  "summary": "סיכום של 2-3 שורות לשיחה של היום — מה קרה, מה הניסיון היה"
}`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
    },
  });

  const text = response.text || '{}';

  try {
    return JSON.parse(text);
  } catch {
    return {
      what_worked: '',
      what_challenged: '',
      what_to_try: '',
      summary: text,
    };
  }
}

export async function startJournal(ctx: Context) {
  const userId = ctx.from!.id;
  const author = getAuthor(userId);

  await ctx.replyWithChatAction('typing');

  const todayConversation = await getTodayConversations(userId);

  if (todayConversation) {
    // Auto-draft from today's conversation
    const draft = await draftJournalFromConversation(todayConversation, author);

    await setUserState(userId, {
      current_mode: 'journal',
      journal_step: 'confirm',
      journal_draft: draft,
    });

    const preview =
      `📓 *יומן ערב — טיוטה אוטומטית*\n\n` +
      `על בסיס השיחה שלנו היום:\n\n` +
      `✓ *מה עבד:* ${draft.what_worked || '—'}\n` +
      `✗ *מה היה קשה:* ${draft.what_challenged || '—'}\n` +
      `→ *מחר לנסות:* ${draft.what_to_try || '—'}\n\n` +
      `_${draft.summary}_\n\n` +
      `לשמור כך? אפשר לכתוב *כן* לשמירה, או לכתוב מה שרוצים לשנות/להוסיף.`;

    await safeSend(ctx, preview);
  } else {
    // No conversation today — fall back to 3 questions
    await setUserState(userId, {
      current_mode: 'journal',
      journal_step: 'what_worked',
      journal_draft: {},
    });

    await safeSend(
      ctx,
      `📓 *יומן ערב*\n\nלא היתה לנו שיחה היום, אז נעשה את זה ביחד.\n\n✓ *מה עבד היום?*\n\nאפילו משהו קטן.`
    );
  }
}

export async function handleJournalStep(ctx: Context, text: string) {
  const userId = ctx.from!.id;
  const author = getAuthor(userId);
  const state = await getUserState(userId);

  if (!state || state.current_mode !== 'journal') {
    return startJournal(ctx);
  }

  const step = state.journal_step;
  const draft = (state.journal_draft || {}) as Record<string, string>;

  // ── Confirm step (after auto-draft) ──────────────────────────────────────────
  if (step === 'confirm') {
    const isConfirm = /^(כן|yes|ok|אוקי|בסדר|שמור|👍)$/i.test(text.trim());

    if (isConfirm) {
      await saveAndClose(ctx, userId, author, draft);
    } else {
      // They want to edit — update the draft with their addition and save
      const updatedDraft = {
        ...draft,
        what_to_try: draft.what_to_try,
        summary: draft.summary
          ? `${draft.summary}\n\nהוספה: ${text}`
          : text,
      };
      await saveAndClose(ctx, userId, author, updatedDraft);
    }
    return;
  }

  // ── Manual 3-question flow ────────────────────────────────────────────────────
  const STEPS = ['what_worked', 'what_challenged', 'what_to_try'] as const;
  type JournalStep = typeof STEPS[number];

  const NEXT_PROMPTS: Record<JournalStep, string> = {
    what_worked: `✗ *מה היה קשה?*\n\nבלי שיפוט. פשוט מה שהיה קשה.`,
    what_challenged: `→ *מה רוצים לנסות מחר?*\n\nדבר אחד ספציפי.`,
    what_to_try: '',
  };

  draft[step as string] = text;

  const currentIndex = STEPS.indexOf(step as JournalStep);
  const nextStep = STEPS[currentIndex + 1];

  if (nextStep) {
    await setUserState(userId, {
      current_mode: 'journal',
      journal_step: nextStep,
      journal_draft: draft,
    });
    await safeSend(ctx, NEXT_PROMPTS[step as JournalStep]);
  } else {
    await saveAndClose(ctx, userId, author, draft);
  }
}

export async function autoSaveJournalIfNeeded(
  bot: { api: { sendMessage: (id: number, text: string, opts?: object) => Promise<unknown> } },
  telegramUserId: number,
  author: 'idan' | 'sveta'
) {
  const alreadySaved = await hasJournalToday(author);
  if (alreadySaved) return;

  const conversation = await getTodayConversations(telegramUserId);
  if (!conversation) return; // no conversation today — nothing to journal

  const draft = await draftJournalFromConversation(conversation, author);

  const fullContent = [
    draft.summary,
    draft.what_worked && `מה עבד: ${draft.what_worked}`,
    draft.what_challenged && `מה היה קשה: ${draft.what_challenged}`,
    draft.what_to_try && `מחר לנסות: ${draft.what_to_try}`,
  ]
    .filter(Boolean)
    .join('\n');

  await saveJournalEntry(author, fullContent, {
    what_worked: draft.what_worked,
    what_challenged: draft.what_challenged,
    what_to_try: draft.what_to_try,
  });

  const msg =
    `📓 *יומן ערב — נשמר אוטומטית*\n\n` +
    `✓ ${draft.what_worked || '—'}\n` +
    `✗ ${draft.what_challenged || '—'}\n` +
    `→ ${draft.what_to_try || '—'}\n\n` +
    `_${draft.summary}_\n\n` +
    `שמרתי את היומן על בסיס השיחה שלנו היום. אם רוצה לתקן משהו — כתוב לי.`;

  await bot.api.sendMessage(telegramUserId, msg, { parse_mode: 'Markdown' });
}

async function saveAndClose(
  ctx: Context,
  userId: number,
  author: 'idan' | 'sveta',
  draft: Record<string, string>
) {
  const fullContent = [
    draft.summary,
    draft.what_worked && `מה עבד: ${draft.what_worked}`,
    draft.what_challenged && `מה היה קשה: ${draft.what_challenged}`,
    draft.what_to_try && `מחר לנסות: ${draft.what_to_try}`,
  ]
    .filter(Boolean)
    .join('\n');

  await saveJournalEntry(
    author,
    fullContent,
    {
      what_worked: draft.what_worked,
      what_challenged: draft.what_challenged,
      what_to_try: draft.what_to_try,
    },
    ctx.message?.message_id
  );

  await setUserState(userId, {
    current_mode: null,
    journal_step: null,
    journal_draft: null,
  });

  await safeSend(
    ctx,
    `✅ *נשמר.*\n\nהיומן של היום מוכן. הוא יהיה חלק מהבריף של מחר בבוקר.`
  );
}
