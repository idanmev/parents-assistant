import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { Context } from 'grammy';

export async function transcribeFileId(fileId: string): Promise<string | null> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const botToken = process.env.TELEGRAM_BOT_TOKEN!;

  // Fetch file info directly from Telegram API
  const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
  const fileData = await fileRes.json() as any;
  const filePath = fileData.result?.file_path;

  if (!filePath) {
    console.error('No file path returned from Telegram API');
    return null;
  }

  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  const localPath = path.join('/tmp', `voice_${Date.now()}.ogg`);

  await downloadFile(fileUrl, localPath);

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(localPath),
      model: 'whisper-1',
      // Language auto-detection works best for Russian/Hebrew mixed inputs
    });

    return transcription.text;
  } finally {
    fs.unlink(localPath, () => {});
  }
}

// Keep the old function for backward compatibility / Grammy use if needed
export async function transcribeVoice(ctx: Context): Promise<string | null> {
  const voice = ctx.message?.voice;
  if (!voice) return null;
  return transcribeFileId(voice.file_id);
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
