export interface CasualFastReply {
  message: string;
  model: 'horizon-local-greeting-v1';
}

const EN_GREETING = /^(?:hi|hello|hey|good morning|good afternoon|good evening)$/i;
const EN_THANKS = /^(?:thanks|thank you|thank you very much)$/i;
const UZ_GREETING = /^(?:salom|assalomu alaykum|asalomu alaykum)$/i;
const UZ_THANKS = /^(?:rahmat|katta rahmat)$/i;
const RU_GREETING = /^(?:привет|здравствуйте|доброе утро|добрый день|добрый вечер)$/iu;
const RU_THANKS = /^(?:спасибо|большое спасибо)$/iu;

function normalized(text: string): string {
  return text.trim().replace(/[.!?,;:]+$/u, '').trim();
}

function firstName(userName?: string): string {
  return userName?.trim().split(/\s+/u)[0]?.slice(0, 80) ?? '';
}

/**
 * Exact, deterministic replies for greetings and thanks. This deliberately stays narrower than
 * the RAG router: a message with any actual request still goes through the normal agent runtime.
 */
export function casualFastReply(text: string, userName?: string): CasualFastReply | null {
  const clean = normalized(text);
  const name = firstName(userName);
  const named = name ? `, ${name}` : '';

  if (EN_GREETING.test(clean)) {
    return { message: `Hello${named}! How can I help you today?`, model: 'horizon-local-greeting-v1' };
  }
  if (EN_THANKS.test(clean)) {
    return { message: `You're welcome${named}!`, model: 'horizon-local-greeting-v1' };
  }
  if (UZ_GREETING.test(clean)) {
    return { message: `Salom${named}! Sizga qanday yordam bera olaman?`, model: 'horizon-local-greeting-v1' };
  }
  if (UZ_THANKS.test(clean)) {
    return { message: `Arzimaydi${named}!`, model: 'horizon-local-greeting-v1' };
  }
  if (RU_GREETING.test(clean)) {
    return { message: `Здравствуйте${named}! Чем я могу помочь?`, model: 'horizon-local-greeting-v1' };
  }
  if (RU_THANKS.test(clean)) {
    return { message: `Пожалуйста${named}!`, model: 'horizon-local-greeting-v1' };
  }
  return null;
}
