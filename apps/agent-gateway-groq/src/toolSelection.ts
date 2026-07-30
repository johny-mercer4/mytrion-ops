import type { ToolManifest } from './toolRuntime.js';

export interface SelectionHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolSelectionPlan {
  tools: ToolManifest[];
  /** Tools the model must call, in order, before it may compose the final answer. */
  requiredSequence: string[];
}

interface ToolRoute {
  keywords: readonly string[];
  tools: readonly string[];
  required: readonly string[];
  /** The state-changing tool exposed only after a verified yes/confirm message. */
  confirmationTool?: string;
  generic?: boolean;
}

const ROUTES: readonly ToolRoute[] = [
  {
    keywords: ['photo', 'image', 'screenshot', 'rasm', 'surat', 'фото', 'скрин'],
    tools: ['telegram_read_image', 'octane_card_status', 'telegram_buttons'],
    required: ['telegram_read_image'],
  },
  {
    keywords: ['money code', 'money-code', 'moneycode', 'pul kod', 'денежн', 'efs code'],
    tools: [
      'octane_money_code_quote',
      'octane_money_code',
      'telegram_progress',
      'telegram_buttons',
    ],
    required: ['octane_money_code_quote', 'telegram_buttons'],
    confirmationTool: 'octane_money_code',
  },
  {
    keywords: ['manual code', 'manual entry', 'entry code', "qo'lda kod", 'ручной код'],
    tools: ['octane_manual_code', 'telegram_progress'],
    required: ['telegram_progress', 'octane_manual_code'],
  },
  {
    keywords: ['latest invoice', 'invoice file', 'invoice pdf', 'invoice excel', 'oxirgi invoice'],
    tools: ['octane_invoice', 'telegram_progress'],
    required: ['telegram_progress', 'octane_invoice'],
  },
  {
    keywords: ['report', 'hisobot', 'отчёт', 'отчет', 'statement', 'xlsx', 'csv', 'pdf'],
    tools: ['octane_txn_report', 'telegram_progress'],
    required: ['telegram_progress', 'octane_txn_report'],
  },
  {
    keywords: ['transaction', 'txn', 'tranz', 'транзак', 'fueling', "yoqilg'i tarixi"],
    tools: ['octane_transactions', 'octane_txn_report', 'telegram_progress'],
    required: ['octane_transactions'],
  },
  {
    keywords: ['invoices', 'invoicelar', 'invoicelar', 'faktura', 'счета', 'счёта'],
    tools: ['octane_invoices'],
    required: ['octane_invoices'],
  },
  {
    keywords: ['invoice', 'invois', 'счёт', 'счет', 'billing'],
    tools: [
      'octane_invoice',
      'octane_invoices',
      'octane_payment_status',
      'octane_billing_form',
      'telegram_progress',
    ],
    required: ['octane_invoices'],
  },
  {
    keywords: ['payment', 'due date', 'qarz', "to'lov", "to'lov", 'оплат', 'долг'],
    tools: ['octane_payment_status', 'octane_invoices'],
    required: ['octane_payment_status'],
  },
  {
    keywords: ['billing form', 'billing-form', 'verification status'],
    tools: ['octane_billing_form', 'octane_service_request', 'telegram_buttons'],
    required: ['octane_billing_form'],
    confirmationTool: 'octane_service_request',
  },
  {
    keywords: ['balance', 'balans', "mablag'", 'funds', 'баланс', 'средств'],
    tools: ['octane_funds', 'octane_balance_dm', 'telegram_progress'],
    required: ['octane_funds'],
  },
  {
    keywords: ['override', 'fraud', 'hold', 'unlock', 'ochib ber', 'блок', 'фрод'],
    tools: [
      'octane_card_status',
      'octane_override',
      'octane_service_request',
      'telegram_buttons',
    ],
    required: ['octane_card_status', 'telegram_buttons'],
    confirmationTool: 'octane_override',
  },
  {
    keywords: [
      'activate',
      'deactivate',
      'card action',
      'card-action',
      'aktiv',
      'deaktiv',
      "o'chir",
      'актив',
      'деактив',
    ],
    tools: ['octane_card_status', 'octane_card_action', 'telegram_buttons'],
    required: ['octane_card_status', 'telegram_buttons'],
    confirmationTool: 'octane_card_action',
  },
  {
    keywords: ['limit', 'card-limit', 'gallon', 'лимит', 'галлон'],
    tools: ['octane_card_status', 'octane_card_limits', 'telegram_buttons'],
    required: ['octane_card_status', 'telegram_buttons'],
    confirmationTool: 'octane_card_limits',
  },
  {
    keywords: [
      'unit number',
      'driver id',
      'driver name',
      'card info',
      'card-info',
      'cardinfo',
      'unit',
      'unitni',
      'pinni',
      'haydovchi nomi',
      'водител',
    ],
    tools: ['octane_card_status', 'octane_card_info', 'telegram_buttons'],
    required: ['octane_card_status', 'telegram_buttons'],
    confirmationTool: 'octane_card_info',
  },
  {
    keywords: ['last used', 'oxirgi ishlat', 'qachon ishlat', 'последн'],
    tools: ['octane_last_used'],
    required: ['octane_last_used'],
  },
  {
    keywords: ['tracking', 'track', 'shipment', 'delivery', 'yetkaz', 'достав', 'трек'],
    tools: ['octane_tracking'],
    required: ['octane_tracking'],
  },
  {
    keywords: [
      'replace',
      'lost',
      'dispute',
      'ticket',
      'escalat',
      'service request',
      'service-request',
      'almashtir',
      'yoqot',
      'потер',
      'спор',
    ],
    tools: ['octane_service_request', 'telegram_buttons', 'octane_whoami'],
    required: ['telegram_buttons'],
    confirmationTool: 'octane_service_request',
  },
  {
    keywords: ['who am i', 'whoami', 'kimman', 'my role', 'rolim', 'кто я', 'моя роль'],
    tools: ['octane_whoami'],
    required: ['octane_whoami'],
  },
  {
    keywords: ['card', 'karta', 'карта', 'efs', 'status', 'statusi', 'holati'],
    tools: ['octane_card_status', 'telegram_buttons'],
    required: ['octane_card_status'],
  },
  {
    keywords: [
      'how',
      'qanday',
      'nega',
      'как',
      'почему',
      'fee',
      'station',
      'pin',
      'supported',
      'help',
      'yordam',
      'помощ',
    ],
    tools: ['octane_kb_search', 'octane_whoami'],
    required: ['octane_kb_search'],
    generic: true,
  },
  {
    keywords: ['rahmat', 'thanks', 'thank you', 'спасибо', 'gracias'],
    tools: ['telegram_react'],
    required: ['telegram_react'],
  },
];

const CONFIRMATION_GATED = new Set(
  ROUTES.flatMap((route) => (route.confirmationTool ? [route.confirmationTool] : [])),
);

function messageBody(prompt: string): string {
  const marker = prompt.lastIndexOf(']:');
  return (marker >= 0 ? prompt.slice(marker + 2) : prompt).toLocaleLowerCase().trim();
}

function normalizedBody(prompt: string): string {
  return messageBody(prompt)
    .replace(/@\w+/g, ' ')
    .replace(/[^\p{L}\p{N}:+-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGreetingOnly(body: string): boolean {
  return /^(hi|hello|hey|salom|assalomu alaykum|привет|здравствуйте|hola|yo|hi bot|hello bot)$/.test(
    body,
  );
}

function isCapabilityQuestion(body: string): boolean {
  return /(nima qila olasan|nimalar qila olasan|what can you do|что ты умеешь|capabilit)/.test(
    body,
  );
}

function isAffirmative(body: string): boolean {
  return (
    /^(ha|xa|yes|yep|ok|okay|confirm|tasdiq|да|подтверждаю|si|sí)$/.test(body) ||
    /(?:^|:)yes$/.test(body) ||
    /(?:^|:)(confirm|confirmed)(?::|$)/.test(body)
  );
}

function isNegative(body: string): boolean {
  return (
    /^(yo'q|yoq|no|cancel|bekor|нет|отмена)$/.test(body) ||
    /(?:^|:)no$/.test(body) ||
    /(?:^|:)cancel$/.test(body)
  );
}

function cardDigits(body: string): string | null {
  if (/\p{L}/u.test(body)) return null;
  const compact = body.replace(/[^\d]/g, '');
  return compact.length >= 4 && compact.length <= 19
    ? compact
    : null;
}

function matches(route: ToolRoute, body: string): boolean {
  return route.keywords.some((keyword) => body.includes(keyword));
}

function specificRouteForBody(body: string): ToolRoute | null {
  if (cardDigits(body)) return cardStatusRoute();
  return ROUTES.find((candidate) => !candidate.generic && matches(candidate, body)) ?? null;
}

function routeFromHistory(
  history: readonly SelectionHistoryMessage[],
  currentBody: string,
): ToolRoute | null {
  const latest = history.at(-1);
  if (latest?.role === 'assistant') {
    const latestAssistantRoute = specificRouteForBody(normalizedBody(latest.content));
    if (latestAssistantRoute) return latestAssistantRoute;
  }

  // A user challenging an earlier approval/availability claim is referring to that claim, even
  // if an identity question briefly happened in between. Recover the underlying service intent.
  if (/(tasdiq|approval|approve|подтверж|agent)/.test(currentBody)) {
    for (const message of [...history].reverse()) {
      if (message.role !== 'assistant') continue;
      const route = specificRouteForBody(normalizedBody(message.content));
      if (route) return route;
    }
  }

  for (const message of [...history].reverse()) {
    if (message.role !== 'user') continue;
    const body = normalizedBody(message.content);
    const route = specificRouteForBody(body);
    if (route) return route;
  }
  return null;
}

function cardStatusRoute(): ToolRoute | null {
  return (
    ROUTES.find(
      (route) =>
        route.required.length === 1 && route.required[0] === 'octane_card_status',
    ) ?? null
  );
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}

/**
 * Route one turn to the smallest safe tool set. Short follow-ups inherit the most recent
 * actionable user intent, while account reads and long delivery workflows get a deterministic
 * required sequence. State-changing tools are invisible until the current message is an explicit
 * confirmation.
 */
export function selectToolPlanForTurn(
  manifests: readonly ToolManifest[],
  prompt: string,
  history: readonly SelectionHistoryMessage[] = [],
): ToolSelectionPlan {
  const body = normalizedBody(prompt);
  if (isGreetingOnly(body) || isCapabilityQuestion(body) || isNegative(body)) {
    return { tools: [], requiredSequence: [] };
  }

  const digits = cardDigits(body);
  const directRoutes = ROUTES.filter((route) => matches(route, body));
  const specificDirect = directRoutes.find((route) => !route.generic) ?? null;
  const confirmed = isAffirmative(body);
  const inherited =
    confirmed || !specificDirect ? routeFromHistory(history, body) : null;
  const primary =
    (digits ? cardStatusRoute() : specificDirect) ??
    inherited ??
    directRoutes[0] ??
    null;

  if (!primary) {
    const fallback = new Set(['octane_whoami', 'octane_kb_search']);
    return {
      tools: manifests.filter((manifest) => fallback.has(manifest.name)),
      requiredSequence: [],
    };
  }

  const routeSet = new Set<ToolRoute>([primary, ...directRoutes]);
  const names = unique([...routeSet].flatMap((route) => route.tools));
  const allowedNames = confirmed
    ? names
    : names.filter((name) => !CONFIRMATION_GATED.has(name));

  let requiredSequence: string[];
  if (confirmed && primary.confirmationTool) {
    requiredSequence =
      primary.confirmationTool === 'octane_money_code'
        ? ['telegram_progress', primary.confirmationTool]
        : [primary.confirmationTool];
  } else if (digits) {
    requiredSequence = ['octane_card_status'];
  } else {
    requiredSequence = [...primary.required].filter((name) => allowedNames.includes(name));
  }

  const available = new Set(manifests.map((manifest) => manifest.name));
  return {
    tools: manifests.filter((manifest) => allowedNames.includes(manifest.name)),
    requiredSequence: unique(requiredSequence).filter((name) => available.has(name)),
  };
}

/** Backward-compatible helper used by small callers and tests that do not need a history plan. */
export function selectToolsForPrompt(
  manifests: readonly ToolManifest[],
  prompt: string,
): ToolManifest[] {
  return selectToolPlanForTurn(manifests, prompt).tools;
}
