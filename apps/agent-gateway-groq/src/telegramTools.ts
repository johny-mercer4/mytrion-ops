import { z } from 'zod';
import { config } from './config.js';
import { safetyIdentifierForChat } from './modelProvider.js';
import { getOpenAIClient } from './openaiClient.js';
import { fetchPhotoBase64 } from './telegram.js';
import { defineTool, type ToolManifest } from './toolRuntime.js';
import { visionStarted } from './metrics.js';
import { executeOpenAIRequest } from './openaiResilience.js';

/** The image is bound to its Telegram sender so one group member cannot inspect another's photo. */
const latestPhoto = new Map<number, { photo: unknown[]; userId: number; at: number }>();
const PHOTO_TTL_MS = 10 * 60_000;

export function notePhoto(chatId: number, userId: number, photo: unknown[]): void {
  latestPhoto.set(chatId, { photo, userId, at: Date.now() });
}

setInterval(() => {
  const cutoff = Date.now() - PHOTO_TTL_MS;
  for (const [chatId, entry] of latestPhoto) {
    if (entry.at < cutoff) latestPhoto.delete(chatId);
  }
}, PHOTO_TTL_MS).unref();

interface ImageText {
  text: string;
  isError?: boolean;
}

async function extractWithOpenAI(
  image: { mediaType: string; data: string },
  chatId: number,
): Promise<string> {
  const response = await executeOpenAIRequest({
    // High-detail image tokenization depends on image dimensions. Reserve a
    // conservative allowance, then reconcile from the API's actual usage.
    estimatedTokens: 3_000,
    operation: () =>
      getOpenAIClient().responses.create({
        model: config.openaiModel,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text:
                  'Transcribe this support image literally in 1-3 short lines. Include visible text, ' +
                  'numbers, dates, amounts, and errors. If it is a card, return only its last 6 digits, ' +
                  'never the full card number. No preamble.',
              },
              {
                type: 'input_image',
                image_url: `data:${image.mediaType};base64,${image.data}`,
                detail: 'high',
              },
            ],
          },
        ],
        reasoning: { effort: 'low' },
        max_output_tokens: 300,
        safety_identifier: safetyIdentifierForChat(chatId),
        store: false,
      }),
    usageTokens: (result) => (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0),
  });
  return response.output_text.trim().slice(0, 600);
}

async function extractImageText(chatId: number, userId: number): Promise<ImageText> {
  const entry = latestPhoto.get(chatId);
  if (!entry || Date.now() - entry.at > PHOTO_TTL_MS) {
    return {
      text: 'No recent image is attached in this chat — ask the user to resend it.',
      isError: true,
    };
  }
  if (entry.userId !== userId) {
    return {
      text: 'The recent image belongs to a different user — do not read it. Ask this user to send their own photo.',
      isError: true,
    };
  }

  const image = await fetchPhotoBase64(entry.photo);
  if (!image) {
    return {
      text: 'The attached image could not be downloaded — ask the user to resend it.',
      isError: true,
    };
  }

  const finishVision = visionStarted();
  let text: string;
  try {
    text = await extractWithOpenAI(image, chatId);
  } finally {
    finishVision();
  }
  return text ? { text } : { text: '(image unreadable)', isError: true };
}

/** One registry per chat: the chat id cannot be supplied or changed by the model. */
export function buildTelegramTools(chatId: number, askerId: number): ToolManifest[] {
  const manifest = defineTool(
    'telegram_read_image',
    'Read the image the user just attached in THIS chat and return a short transcription. Call whenever the photo contents matter.',
    {
      telegram_user_id: z
        .number()
        .describe("Telegram id of the asker — the image must be that user's own image"),
    },
    async ({ telegram_user_id }) => {
      const result = await extractImageText(chatId, telegram_user_id);
      return {
        content: [{ type: 'text', text: result.text }],
        ...(result.isError ? { isError: true } : {}),
      };
    },
  );

  return [
    {
      ...manifest,
      authorize(input) {
        const userId = input['telegram_user_id'];
        if (typeof userId !== 'number') return 'telegram_user_id is required';
        if (userId !== askerId) {
          return 'telegram_user_id does not match the current message sender';
        }
        const entry = latestPhoto.get(chatId);
        return entry?.userId === userId
          ? null
          : "the recent image is not owned by this chat's asker";
      },
    },
  ];
}
