/**
 * Telegram's own tools for the SDK session — currently image handling. The model calls
 * telegram_read_image when the user attaches a photo; the tool downloads the latest photo for
 * this chat, transcribes it to TEXT in a THROWAWAY vision pass, and returns only that text.
 *
 * Why a tool (not inline in the prompt): the raw image never enters the resumable chat session,
 * so history stays cheap and we don't re-send the photo on every later turn. Only the extracted
 * text (a card number, a receipt total, an error message, whatever the image is — NOT only cards)
 * lands in history.
 */
import { createSdkMcpServer, query, tool, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { config } from './config.js';
import { fetchPhotoBase64, type TgImage } from './telegram.js';

/** chatId → the most recent photo WITH its sender and time. The binding matters: driver A's
 *  card photo must never be readable in driver B's ask — same own-card philosophy as RBAC. */
const latestPhoto = new Map<number, { photo: unknown[]; userId: number; at: number }>();
const PHOTO_TTL_MS = 10 * 60_000;

export function notePhoto(chatId: number, userId: number, photo: unknown[]): void {
  latestPhoto.set(chatId, { photo, userId, at: Date.now() });
}

/** One-message streaming-input prompt: an image block + a text instruction. */
async function* imagePrompt(text: string, image: TgImage): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
        { type: 'text', text },
      ],
    },
  };
}

/** Vision → text in a throwaway session (no resume, no tools, id discarded). General purpose:
 *  images are not only fuel cards — could be a receipt, a pump screen, a document, a screenshot. */
async function extractImageText(image: TgImage): Promise<string> {
  const q = query({
    prompt: imagePrompt(
      'Transcribe what this image shows in 1-3 short lines. Include any text, numbers, or ' +
        'identifiers visible (card numbers, amounts, dates, error messages, etc.). No preamble.',
      image,
    ),
    options: {
      model: config.model,
      systemPrompt: 'You transcribe images to plain text for another assistant. Be literal; no commentary.',
      disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
      permissionMode: 'bypassPermissions',
      maxTurns: 1,
    },
  });
  let text = '';
  for await (const msg of q) {
    if (msg.type === 'result' && msg.subtype === 'success') text = msg.result;
  }
  return text.trim().slice(0, 600);
}

/** One server per chat: the chatId is closed over, so the model can't point it at another chat. */
export function buildTelegramServer(chatId: number) {
  return createSdkMcpServer({
    name: 'telegram',
    version: '1.0.0',
    tools: [
      tool(
        'telegram_read_image',
        'Read the image the user just attached in THIS chat (photo, screenshot, receipt, pump/card ' +
          'display, document, etc.) and return its transcribed text and content. Call this whenever ' +
          'the message mentions or includes a photo and its contents matter to the request.',
        { telegram_user_id: z.number().describe('Telegram id of the asker — the image must be THEIRS') },
        async ({ telegram_user_id }) => {
          const entry = latestPhoto.get(chatId);
          if (!entry || Date.now() - entry.at > PHOTO_TTL_MS)
            return { content: [{ type: 'text' as const, text: 'No recent image is attached in this chat — ask them to resend it.' }], isError: true };
          if (entry.userId !== telegram_user_id)
            return { content: [{ type: 'text' as const, text: "The recent image was sent by a DIFFERENT user — you may not read it for this asker. Ask them to send their own photo." }], isError: true };
          const image = await fetchPhotoBase64(entry.photo);
          if (!image) return { content: [{ type: 'text' as const, text: 'Could not download the attached image.' }], isError: true };
          const text = await extractImageText(image);
          return { content: [{ type: 'text' as const, text: text || '(the image could not be read)' }] };
        },
      ),
    ],
  });
}
