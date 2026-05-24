import * as dotenv from 'dotenv';
dotenv.config();

export function getAuthor(telegramUserId: number): 'idan' | 'sveta' {
  const idanId = parseInt(process.env.TELEGRAM_IDAN_ID || '0');
  const svetaId = parseInt(process.env.TELEGRAM_SVETA_ID || '0');

  if (telegramUserId === idanId) return 'idan';
  if (telegramUserId === svetaId) return 'sveta';

  // Default — should never happen since we guard at the bot level
  return 'idan';
}

export function isAuthorizedUser(telegramUserId: number): boolean {
  const idanId = parseInt(process.env.TELEGRAM_IDAN_ID || '0');
  const svetaId = parseInt(process.env.TELEGRAM_SVETA_ID || '0');

  return telegramUserId === idanId || telegramUserId === svetaId;
}

export function getAllUsers(): Array<{ telegramId: number; author: 'idan' | 'sveta' }> {
  const idanId = parseInt(process.env.TELEGRAM_IDAN_ID || '0');
  const svetaId = parseInt(process.env.TELEGRAM_SVETA_ID || '0');
  const users = [];
  if (idanId) users.push({ telegramId: idanId, author: 'idan' as const });
  if (svetaId) users.push({ telegramId: svetaId, author: 'sveta' as const });
  return users;
}
