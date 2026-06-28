import { bot } from '../src/bot';
import { sendMorningBriefToFamily } from '../src/handlers/morning';
import { autoSaveJournalIfNeeded } from '../src/handlers/journal';
import { sendWeeklyBrief } from '../src/handlers/weekly';
import { supabase } from '../src/supabase/client';

export default async function handler(req: any, res: any) {
  // Optional: protect this endpoint with a secret token
  // if (req.query.token !== process.env.CRON_SECRET) {
  //   return res.status(401).send('Unauthorized');
  // }

  const { data: users, error } = await supabase
    .from('user_states')
    .select('telegram_user_id, family_id, timezone, week_start, display_name')
    .eq('onboarded', true);

  if (error || !users) {
    return res.status(500).json({ error: 'Failed to fetch users' });
  }

  const logs: string[] = [];

  // Group by family for morning briefs to save tokens
  const familyMorningBriefs = new Map<string, number[]>();

  for (const user of users) {
    try {
      const tz = user.timezone || 'Asia/Jerusalem';
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
      const hour = now.getHours();
      const minute = now.getMinutes();
      const day = now.getDay();

      // Morning brief at 7:00
      if (hour === 7 && minute < 30 && user.family_id) {
        if (!familyMorningBriefs.has(user.family_id)) {
          familyMorningBriefs.set(user.family_id, []);
        }
        familyMorningBriefs.get(user.family_id)!.push(user.telegram_user_id);
      }

      // Auto-journal at 22:00
      if (hour === 22 && minute < 30 && user.family_id) {
        await autoSaveJournalIfNeeded(bot, user.family_id, user.telegram_user_id, user.display_name || 'Parent');
        logs.push(`Auto-journal checked for user ${user.telegram_user_id}`);
      }

      // Weekly brief — Monday or Sunday at 7:30
      const weekStartDay = user.week_start === 'sunday' ? 0 : 1;
      if (day === weekStartDay && hour === 7 && minute >= 30 && user.family_id) {
        // TODO: convert weekly brief to per-family similar to morning brief
        // await sendWeeklyBrief(bot, user.family_id, [user.telegram_user_id]);
        logs.push(`Weekly brief scheduled for user ${user.telegram_user_id}`);
      }
    } catch (err: any) {
      console.error(`Scheduler error for user ${user.telegram_user_id}:`, err);
      logs.push(`Error for ${user.telegram_user_id}: ${err.message}`);
    }
  }

  // Execute grouped morning briefs
  for (const [familyId, telegramIds] of familyMorningBriefs.entries()) {
    try {
      await sendMorningBriefToFamily(bot, familyId, telegramIds);
      logs.push(`Morning brief sent to family ${familyId}`);
    } catch (err: any) {
      console.error(`Morning brief error for family ${familyId}:`, err);
      logs.push(`Error for family ${familyId}: ${err.message}`);
    }
  }

  res.status(200).json({ status: 'ok', logs });
}
