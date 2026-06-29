import {
  claimPendingJobs,
  markJobSent,
  markJobFailed,
  markUpdateSent,
  markUpdateFailed,
  getRecentJournals,
  getConversationHistory,
  saveConversationTurn,
  setUserState,
  getUserState,
  supabase,
} from '../src/supabase/client';
import { askGemini } from '../src/gemini/client';
import { buildSystemPrompt } from '../src/claude/prompts';
import { getAuthor, isAuthorizedUser } from '../src/utils/users';
import { transcribeFileId } from '../src/handlers/voice';

// Telegram Bot API instance — used to send messages directly without Grammy.
// We use sendMessage directly (not Grammy ctx.reply) since we have no request context.
const telegramToken = process.env.TELEGRAM_BOT_TOKEN!;

async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  // Use the Telegram Bot API directly via fetch since node-telegram-bot-api
  // requires polling. We just POST to the sendMessage endpoint.
  const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;

  // Try Markdown first, fall back to plain text on parse error
  let res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });

  let data = await res.json() as any;

  if (!data.ok && data.description?.includes('parse')) {
    console.log(`[Send] Markdown failed, retrying as plain text.`);
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    data = await res.json();
  }

  if (!data.ok) {
    throw new Error(`Telegram sendMessage failed: ${data.description}`);
  }
}

async function sendTypingAction(chatId: number): Promise<void> {
  try {
    const url = `https://api.telegram.org/bot${telegramToken}/sendChatAction`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
    });
  } catch {
    // typing action failure is non-fatal
  }
}

function splitMessage(text: string, maxLength = 3500): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let currentText = text;

  while (currentText.length > maxLength) {
    // try to split at paragraph
    let splitIndex = currentText.lastIndexOf('\n\n', maxLength);
    if (splitIndex === -1) {
      // try to split at sentence
      splitIndex = currentText.lastIndexOf('. ', maxLength);
    }
    if (splitIndex === -1) {
      // split at space
      splitIndex = currentText.lastIndexOf(' ', maxLength);
    }
    if (splitIndex === -1 || splitIndex === 0) {
      // hard split
      splitIndex = maxLength;
    }

    // Keep the period if we split on it
    const sliceLen = splitIndex + (currentText[splitIndex] === '.' ? 1 : 0);
    const chunk = currentText.slice(0, sliceLen).trim();
    if (chunk) chunks.push(chunk);

    currentText = currentText.slice(sliceLen).trim();
  }

  if (currentText) chunks.push(currentText);

  return chunks;
}

/**
 * /api/process-jobs — async worker endpoint.
 *
 * Called by Vercel Cron every minute (or manually).
 * Processes up to 5 pending telegram_jobs per invocation.
 *
 * For each job:
 *  1. Call Gemini with user message + conversation history.
 *  2. Send reply via Telegram Bot API.
 *  3. Save conversation turn to Supabase.
 *  4. Mark job + processed_updates as sent.
 *  5. On failure: mark job + processed_updates as failed, log error.
 */
export default async function handler(req: any, res: any) {
  // Protect endpoint with CRON_SECRET
  const authHeader = req.headers['authorization'] ?? '';
  const expectedToken = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;

  if (expectedToken && authHeader !== expectedToken) {
    console.warn(`[ProcessJobs] Unauthorized request.`);
    return res.status(401).send('Unauthorized');
  }

  console.log(`[ProcessJobs] Starting job processing run.`);
  const runStart = Date.now();

  const jobs = await claimPendingJobs(5);

  if (jobs.length === 0) {
    console.log(`[ProcessJobs] No pending jobs.`);
    return res.status(200).json({ status: 'ok', processed: 0 });
  }

  const results: { jobId: number; updateId: number; status: string }[] = [];

  for (const job of jobs) {
    const jobStart = Date.now();
    console.log(`[ProcessJobs] Processing job ${job.id} for update_id=${job.update_id} chat=${job.chat_id}`);

    try {
      // Auth guard
      if (!isAuthorizedUser(job.telegram_user_id)) {
        console.warn(`[ProcessJobs] Unauthorized user ${job.telegram_user_id} — skipping.`);
        await markJobFailed(job.id, 'Unauthorized user');
        await markUpdateFailed(job.update_id, 'Unauthorized user');
        results.push({ jobId: job.id, updateId: job.update_id, status: 'failed:unauthorized' });
        continue;
      }

      const author = getAuthor(job.telegram_user_id);

      // Determine mode from user state
      const state = await getUserState(job.telegram_user_id);
      // Journal mode messages should not be processed as chat here.
      // Journal handling remains synchronous via the Grammy path (commands only).
      if (state?.current_mode === 'journal') {
        console.log(`[ProcessJobs] User is in journal mode — skipping chat processing for job ${job.id}.`);
        await markJobFailed(job.id, 'User in journal mode — message skipped');
        await markUpdateFailed(job.update_id, 'User in journal mode — message skipped');
        results.push({ jobId: job.id, updateId: job.update_id, status: 'skipped:journal' });
        continue;
      }

      // Send typing indicator (non-blocking fire-and-forget)
      sendTypingAction(job.chat_id);

      if (!state?.family_id) {
        throw new Error('User has no family_id. Cannot process job.');
      }
      const familyId = state.family_id;
      const parentName = state.display_name || 'Parent';

      // Fetch context in parallel
      const [recentJournals, history] = await Promise.all([
        getRecentJournals(familyId, 7),
        getConversationHistory(job.telegram_user_id, 10),
      ]);

      const { data: children } = await supabase.from('children').select('*').eq('family_id', familyId);
      const { data: parents } = await supabase.from('user_states').select('display_name, telegram_user_id').eq('family_id', familyId);
      const { data: memories } = await supabase.from('memories').select('summary').eq('family_id', familyId).eq('status', 'active');
      
      const familyContext = {
        children: (children || []).map(c => ({ name: c.name, age: Number(c.age), tags: c.profile_tags || [] })),
        parents: (parents || []).map(p => ({ name: p.display_name || 'Parent' })),
        memories: (memories || []).map(m => m.summary)
      };

      const systemPrompt = buildSystemPrompt(recentJournals, 'chat', parentName, familyContext, familyId);

      let processedText = job.text;

      // Handle voice messages
      if (processedText.startsWith('[VOICE]')) {
        const fileId = processedText.replace('[VOICE]', '');
        console.log(`[ProcessJobs] job ${job.id} — Transcribing voice message ${fileId}...`);
        try {
          const transcription = await transcribeFileId(fileId);
          if (!transcription) {
            throw new Error('Transcription returned null');
          }
          processedText = transcription;
          console.log(`[ProcessJobs] job ${job.id} — Transcription: "${processedText}"`);
          // Send acknowledgment
          await sendTelegramMessage(job.chat_id, `_שמעתי: "${processedText}"_`);
        } catch (err: any) {
          console.error(`[ProcessJobs] job ${job.id} — Voice transcription failed:`, err.message);
          await sendTelegramMessage(job.chat_id, 'לא הצלחתי להבין את ההקלטה. נסה להקליד?');
          throw err;
        }
      }

      console.log(`[ProcessJobs] job ${job.id} — calling Gemini...`);
      const geminiStart = Date.now();
      const response = await askGemini(systemPrompt, history, processedText);
      console.log(`[ProcessJobs] job ${job.id} — Gemini done in ${Date.now() - geminiStart}ms`);

      const chunks = splitMessage(response);
      console.log(`[ProcessJobs] job ${job.id} — Final answer length: ${response.length}, split into ${chunks.length} chunks.`);

      // Send reply to Telegram
      for (let i = 0; i < chunks.length; i++) {
        try {
          await sendTelegramMessage(job.chat_id, chunks[i]);
          console.log(`[ProcessJobs] job ${job.id} — Telegram message chunk ${i + 1}/${chunks.length} sent successfully.`);
        } catch (err: any) {
          console.error(`[ProcessJobs] job ${job.id} — Failed to send chunk ${i + 1}: ${err.message}`);
          throw new Error(`Failed to send chunk ${i + 1}: ${err.message}`); // will be caught below
        }
      }

      // Save conversation to DB
      await Promise.all([
        saveConversationTurn(job.telegram_user_id, 'user', processedText, 'chat'),
        saveConversationTurn(job.telegram_user_id, 'assistant', response, 'chat'),
        setUserState(job.telegram_user_id, { current_mode: 'chat' }),
      ]);

      // Mark as done
      await markJobSent(job.id);
      await markUpdateSent(job.update_id);

      results.push({ jobId: job.id, updateId: job.update_id, status: 'sent' });
      console.log(`[ProcessJobs] job ${job.id} complete. Took ${Date.now() - jobStart}ms.`);
    } catch (err: any) {
      const errMsg = err?.message ?? String(err);
      console.error(`[ProcessJobs] job ${job.id} FAILED:`, errMsg);
      await markJobFailed(job.id, errMsg);
      await markUpdateFailed(job.update_id, errMsg);
      results.push({ jobId: job.id, updateId: job.update_id, status: 'failed' });
    }
  }

  console.log(`[ProcessJobs] Run complete. ${results.length} jobs in ${Date.now() - runStart}ms.`);
  return res.status(200).json({ status: 'ok', processed: results.length, results });
}
