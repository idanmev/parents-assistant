import { Context } from 'grammy';

export async function safeSend(ctx: Context, text: string) {
  try {
    console.log(`[Telegram] Sending message to user ${ctx.from?.id}, update_id: ${ctx.update?.update_id}`);
    await ctx.reply(text, { parse_mode: 'Markdown' });
    console.log(`[Telegram] Message sent successfully.`);
  } catch (error) {
    // Markdown parse failed — send as plain text
    console.log(`[Telegram] Markdown send failed, falling back to plain text. Error:`, error);
    await ctx.reply(text);
    console.log(`[Telegram] Plain text message sent successfully.`);
  }
}
