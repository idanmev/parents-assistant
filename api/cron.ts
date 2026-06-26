import { bot } from '../src/bot';
import { sendMorningBriefToUser } from '../src/handlers/morning';
import { autoSaveJournalIfNeeded } from '../src/handlers/journal';
import { sendWeeklyBrief } from '../src/handlers/weekly';
import { supabase, getUserTimezone } from '../src/supabase/client';
import { getAllUsers } from '../src/utils/users';

export default async function handler(req: any, res: any) {
  // Optional: protect this endpoint with a secret token
  // if (req.query.token !== process.env.CRON_SECRET) {
  //   return res.status(401).send('Unauthorized');
  // }

  const users = getAllUsers();
  const logs: string[] = [];

  for (const { telegramId, author } of users) {
    try {
      const tz = await getUserTimezone(telegramId);
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
      const hour = now.getHours();
      const minute = now.getMinutes();
      const day = now.getDay();

      // Morning brief at 7:00 (triggered if cron runs between :00 and :29)
      if (hour === 7 && minute < 30) {
        await sendMorningBriefToUser(bot, telegramId, tz);
        logs.push(`Morning brief sent to ${author}`);
      }

      // Auto-journal at 22:00 (triggered if cron runs between :00 and :29)
      if (hour === 22 && minute < 30) {
        await autoSaveJournalIfNeeded(bot, telegramId, author);
        logs.push(`Auto-journal checked for ${author}`);
      }

      // Weekly brief — Monday or Sunday at 7:30 (triggered if cron runs between :30 and :59)
      const { data: stateData } = await supabase
        .from('user_states')
        .select('week_start')
        .eq('telegram_user_id', telegramId)
        .single();
        
      const weekStartDay = stateData?.week_start === 'sunday' ? 0 : 1;
      
      if (day === weekStartDay && hour === 7 && minute >= 30) {
        await sendWeeklyBrief(bot);
        logs.push(`Weekly brief sent to ${author}`);
      }

    } catch (err: any) {
      console.error(`Scheduler error for user ${telegramId}:`, err);
      logs.push(`Error for ${telegramId}: ${err.message}`);
    }
  }

  res.status(200).json({ status: 'ok', logs });
}
