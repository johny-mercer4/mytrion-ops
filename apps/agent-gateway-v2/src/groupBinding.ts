import { randomBytes } from 'node:crypto';
import {
  canPromptAutoBind,
  confirmAutoBind,
  previewAutoBind,
  releaseAutoBindPrompt,
} from './chatMap.js';
import {
  answerCallback,
  clearButtons,
  sendButtons,
  sendMessage,
  type TgUpdate,
} from './telegram.js';

const CONFIRM_TTL_MS = 10 * 60_000;
const MAX_PENDING = 10_000;

interface PendingGroupBinding {
  token: string;
  chatId: number;
  telegramUserId: number;
  carrierId: string;
  companyName: string | null;
  messageId: number;
  expiresAt: number;
}

const pendingByToken = new Map<string, PendingGroupBinding>();
const tokenByActor = new Map<string, string>();

function actorKey(chatId: number, telegramUserId: number): string {
  return `${chatId}:${telegramUserId}`;
}

function removePending(pending: PendingGroupBinding): void {
  pendingByToken.delete(pending.token);
  if (tokenByActor.get(actorKey(pending.chatId, pending.telegramUserId)) === pending.token) {
    tokenByActor.delete(actorKey(pending.chatId, pending.telegramUserId));
  }
}

function sweepExpired(): void {
  const now = Date.now();
  for (const pending of pendingByToken.values()) {
    if (pending.expiresAt <= now) {
      removePending(pending);
      releaseAutoBindPrompt(pending.chatId);
    }
  }
}

setInterval(sweepExpired, CONFIRM_TTL_MS).unref();

function confirmationText(companyName: string | null, carrierId: string): string {
  const company = companyName?.trim() || `Carrier ${carrierId}`;
  return [
    '🔗 Guruhni kompaniyaga ulash / Connect group',
    '',
    `Bu guruh aynan “${company}” kompaniyasinikimi?`,
    `Is this group specifically for “${company}”?`,
    '',
    'Faqat so‘rovni boshlagan owner yoki manager tasdiqlay oladi.',
    'Only the owner or manager who started this request can confirm.',
  ].join('\n');
}

function announcementText(companyName: string | null): string {
  const company = companyName ? ` — ${companyName}` : '';
  return `✅ Guruh ulandi${company}. Endi shu yerda savol berishingiz mumkin. / Group connected${company}. You can now ask for help here.`;
}

export function parseGroupBindingCallback(
  data: string | undefined,
): { decision: 'confirm' | 'cancel'; token: string } | null {
  const match = data?.match(/^gb([cx]):([a-f0-9]{32})$/u);
  if (!match?.[2]) return null;
  return { decision: match[1] === 'c' ? 'confirm' : 'cancel', token: match[2] };
}

/**
 * Ask an active owner/manager to confirm the server-resolved company. No chat-map write occurs here.
 * Returns true when the sender is eligible and a prompt exists (new or already pending).
 */
export async function requestGroupBindingConfirmation(input: {
  chatId: number;
  telegramUserId: number;
  replyToMessageId: number;
}): Promise<boolean> {
  sweepExpired();
  const key = actorKey(input.chatId, input.telegramUserId);
  if (tokenByActor.has(key)) return true;
  if (!canPromptAutoBind(input.chatId)) return false;

  const preview = await previewAutoBind(input.telegramUserId);
  if (!preview) {
    releaseAutoBindPrompt(input.chatId);
    return false;
  }
  if (pendingByToken.size >= MAX_PENDING) {
    releaseAutoBindPrompt(input.chatId);
    return false;
  }

  const token = randomBytes(16).toString('hex');
  try {
    const messageId = await sendButtons(
      input.chatId,
      confirmationText(preview.companyName, preview.carrierId),
      [
        { label: '✅ Ha, ulang / Yes', data: `gbc:${token}` },
        { label: '❌ Yo‘q / No', data: `gbx:${token}` },
      ],
      input.replyToMessageId,
    );
    const pending: PendingGroupBinding = {
      token,
      chatId: input.chatId,
      telegramUserId: input.telegramUserId,
      carrierId: preview.carrierId,
      companyName: preview.companyName,
      messageId,
      expiresAt: Date.now() + CONFIRM_TTL_MS,
    };
    pendingByToken.set(token, pending);
    tokenByActor.set(key, token);
    return true;
  } catch {
    releaseAutoBindPrompt(input.chatId);
    return false;
  }
}

/** Handle bind confirmation before normal callbacks, because an unbound group has no carrier yet. */
export async function handleGroupBindingCallback(update: TgUpdate): Promise<boolean> {
  const callback = update.callback_query;
  const parsed = parseGroupBindingCallback(callback?.data);
  if (!callback || !parsed) return false;
  const message = callback.message;
  if (!message) {
    await answerCallback(callback.id, 'This confirmation is unavailable.', true);
    return true;
  }

  sweepExpired();
  const pending = pendingByToken.get(parsed.token);
  if (!pending || pending.expiresAt <= Date.now()) {
    await answerCallback(callback.id, 'Confirmation expired. Mention the bot again.', true);
    return true;
  }
  if (
    pending.chatId !== message.chat.id ||
    pending.messageId !== message.message_id ||
    pending.telegramUserId !== callback.from.id
  ) {
    await answerCallback(
      callback.id,
      'Only the owner or manager who started this request can confirm.',
      true,
    );
    return true;
  }

  removePending(pending);
  releaseAutoBindPrompt(pending.chatId);
  await clearButtons(pending.chatId, pending.messageId);
  if (parsed.decision === 'cancel') {
    await answerCallback(callback.id, 'Bekor qilindi / Cancelled');
    return true;
  }

  const result = await confirmAutoBind(pending.chatId, pending.telegramUserId);
  if (!result) {
    await answerCallback(callback.id, 'Could not connect this group. Try again.', true);
    return true;
  }
  if (result.carrierId !== pending.carrierId) {
    await answerCallback(callback.id, 'This group is already connected to another company.', true);
    return true;
  }

  await answerCallback(callback.id, 'Guruh ulandi / Group connected');
  await sendMessage(
    pending.chatId,
    announcementText(result.companyName ?? pending.companyName),
    pending.messageId,
  ).catch(() => undefined);
  return true;
}

