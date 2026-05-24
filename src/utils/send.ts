import { Context } from 'grammy';

export async function safeSend(ctx: Context, text: string) {
  try {
    await ctx.reply(text, { parse_mode: 'Markdown' });
  } catch {
    // Markdown parse failed — send as plain text
    await ctx.reply(text);
  }
}
