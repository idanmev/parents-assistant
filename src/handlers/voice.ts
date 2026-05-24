import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { Context } from 'grammy';

export async function transcribeVoice(ctx: Context): Promise<string | null> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const voice = ctx.message?.voice;
  if (!voice) return null;

  const botToken = process.env.TELEGRAM_BOT_TOKEN!;
  const fileInfo = await ctx.api.getFile(voice.file_id);
  const filePath = fileInfo.file_path;

  if (!filePath) {
    console.error('No file path returned from Telegram');
    return null;
  }

  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  const localPath = path.join('/tmp', `voice_${Date.now()}.ogg`);

  await downloadFile(fileUrl, localPath);

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(localPath),
      model: 'whisper-1',
      language: 'he', // Hebrew — fallback handles Russian/English naturally
    });

    return transcription.text;
  } finally {
    fs.unlink(localPath, () => {});
  }
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (response) => {
        response.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      })
      .on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
}
