import type { ToolManifest } from './toolRuntime.js';

export const SERVICE_CATALOG = {
  core: {
    label: 'Core Telegram UX',
    description: 'Progress messages, buttons, and reactions required by gateway workflows.',
    defaultEnabled: true,
    toggleable: false,
    tools: ['telegram_progress', 'telegram_buttons', 'telegram_react'],
  },
  identity: {
    label: 'Identity',
    description: 'Registration, role, and assigned Octane agent lookup.',
    defaultEnabled: true,
    toggleable: true,
    tools: ['octane_whoami'],
  },
  knowledge: {
    label: 'Knowledge base',
    description: 'Grounded Octane policy and how-to search.',
    defaultEnabled: true,
    toggleable: true,
    tools: ['octane_kb_search'],
  },
  cards: {
    label: 'Card services',
    description: 'Card status, metadata, limits, activation, override, and manual code.',
    defaultEnabled: true,
    toggleable: true,
    tools: [
      'octane_card_status',
      'octane_card_action',
      'octane_card_limits',
      'octane_card_info',
      'octane_manual_code',
      'octane_last_used',
      'octane_override',
    ],
  },
  funds: {
    label: 'Funds and balance',
    description: 'Account-funds checks and private balance delivery.',
    defaultEnabled: true,
    toggleable: true,
    tools: ['octane_funds', 'octane_balance_dm'],
  },
  transactions: {
    label: 'Transactions and reports',
    description: 'Recent transactions and private transaction reports.',
    defaultEnabled: true,
    toggleable: true,
    tools: ['octane_transactions', 'octane_txn_report'],
  },
  money_code: {
    label: 'Money Code',
    description: 'Money Code availability quotes and EFS code creation.',
    defaultEnabled: false,
    toggleable: true,
    tools: ['octane_money_code_quote', 'octane_money_code'],
  },
  billing: {
    label: 'Billing',
    description: 'Invoices, payment status, and billing-form status.',
    defaultEnabled: true,
    toggleable: true,
    tools: [
      'octane_invoice',
      'octane_invoices',
      'octane_payment_status',
      'octane_billing_form',
    ],
  },
  service_requests: {
    label: 'Service requests',
    description: 'Confirmed support-ticket creation.',
    defaultEnabled: true,
    toggleable: true,
    tools: ['octane_service_request'],
  },
  tracking: {
    label: 'Card tracking',
    description: 'Card shipment tracking.',
    defaultEnabled: true,
    toggleable: true,
    tools: ['octane_tracking'],
  },
  vision: {
    label: 'Image reading',
    description: 'Sender-bound Telegram image transcription.',
    defaultEnabled: true,
    toggleable: true,
    tools: ['telegram_read_image'],
  },
  memory: {
    label: 'Per-user semantic memory',
    description: 'Scoped pgvector recall and sanitized turn-memory persistence.',
    defaultEnabled: false,
    toggleable: true,
    tools: [],
  },
} as const;

export type ServiceId = keyof typeof SERVICE_CATALOG;
export type ServiceAvailability = Readonly<Record<ServiceId, boolean>>;

const serviceIds = Object.keys(SERVICE_CATALOG) as ServiceId[];
const toolServices = new Map<string, ServiceId>();

for (const serviceId of serviceIds) {
  for (const toolName of SERVICE_CATALOG[serviceId].tools) {
    if (toolServices.has(toolName)) {
      throw new Error(`tool "${toolName}" belongs to more than one gateway service`);
    }
    toolServices.set(toolName, serviceId);
  }
}

function parseSwitch(value: string, serviceId: ServiceId): boolean {
  if (value === 'on' || value === 'true' || value === '1') return true;
  if (value === 'off' || value === 'false' || value === '0') return false;
  throw new Error(
    `invalid AGENT_SERVICE_FLAGS value for "${serviceId}": use on/off`,
  );
}

/**
 * Parse comma-separated service overrides such as `money_code=off,billing=on`.
 * Services not mentioned retain their safe catalog default; new services therefore opt in
 * explicitly by choosing their catalog default and can be switched without changing code.
 */
export function parseServiceFlags(raw = ''): ServiceAvailability {
  const availability = Object.fromEntries(
    serviceIds.map((serviceId) => [
      serviceId,
      SERVICE_CATALOG[serviceId].defaultEnabled,
    ]),
  ) as Record<ServiceId, boolean>;

  for (const token of raw.split(',').map((part) => part.trim()).filter(Boolean)) {
    const [rawId, rawValue, ...extra] = token.split('=').map((part) => part.trim());
    if (!rawId || !rawValue || extra.length) {
      throw new Error(
        `invalid AGENT_SERVICE_FLAGS entry "${token}": expected service=on|off`,
      );
    }
    if (!serviceIds.includes(rawId as ServiceId)) {
      throw new Error(`unknown gateway service "${rawId}" in AGENT_SERVICE_FLAGS`);
    }
    const serviceId = rawId as ServiceId;
    if (!SERVICE_CATALOG[serviceId].toggleable) {
      throw new Error(`gateway service "${serviceId}" cannot be disabled`);
    }
    availability[serviceId] = parseSwitch(rawValue.toLowerCase(), serviceId);
  }

  return Object.freeze(availability);
}

export const runtimeServiceAvailability = parseServiceFlags(
  process.env['AGENT_SERVICE_FLAGS'] ?? '',
);

export function serviceForTool(toolName: string): ServiceId | null {
  return toolServices.get(toolName) ?? null;
}

export function isServiceEnabled(
  serviceId: ServiceId,
  availability: ServiceAvailability = runtimeServiceAvailability,
): boolean {
  return availability[serviceId];
}

export function isToolEnabled(
  toolName: string,
  availability: ServiceAvailability = runtimeServiceAvailability,
): boolean {
  const serviceId = serviceForTool(toolName);
  return serviceId !== null && isServiceEnabled(serviceId, availability);
}

/** Unknown gateway tools fail closed; generic test/internal manifests remain unaffected. */
export function filterEnabledTools(
  manifests: readonly ToolManifest[],
  availability: ServiceAvailability = runtimeServiceAvailability,
): ToolManifest[] {
  return manifests.filter((manifest) => {
    const serviceId = serviceForTool(manifest.name);
    if (serviceId) return isServiceEnabled(serviceId, availability);
    return !manifest.name.startsWith('octane_') && !manifest.name.startsWith('telegram_');
  });
}

export function serviceUnavailableText(serviceId: ServiceId, prompt = ''): string {
  const label = SERVICE_CATALOG[serviceId].label;
  const body = prompt.toLocaleLowerCase();
  if (/\p{Script=Cyrillic}/u.test(body)) {
    return `⚠️ Сервис ${label} сейчас отключён. Обратитесь к вашему агенту Octane.`;
  }
  if (/\b(puedo|código|dinero|cuánto|necesito|quiero|disponible)\b/u.test(body)) {
    return `⚠️ El servicio ${label} está desactivado por ahora. Contacte a su agente de Octane.`;
  }
  if (
    /\b(can|could|please|how|what|need|want|available|issue|create|get)\b/u.test(
      body,
    )
  ) {
    return `⚠️ ${label} is currently unavailable. Please contact your Octane agent.`;
  }
  return `⚠️ ${label} xizmati hozircha o‘chirilgan. Octane agentingizga murojaat qiling.`;
}

export function enabledServiceSummary(
  availability: ServiceAvailability = runtimeServiceAvailability,
): string {
  return serviceIds
    .filter((serviceId) => availability[serviceId])
    .join(',');
}

export function servicePromptPolicy(
  availability: ServiceAvailability = runtimeServiceAvailability,
): string {
  const toggleableIds = serviceIds.filter(
    (serviceId) =>
      SERVICE_CATALOG[serviceId].toggleable && serviceId !== 'memory',
  );
  const enabled = toggleableIds
    .filter((serviceId) => availability[serviceId])
    .map((serviceId) => SERVICE_CATALOG[serviceId].label);
  const disabled = toggleableIds
    .filter((serviceId) => !availability[serviceId])
    .map((serviceId) => SERVICE_CATALOG[serviceId].label);
  return [
    'DEPLOYMENT SERVICE FLAGS — OVERRIDE ALL CAPABILITY TEXT ABOVE',
    `Enabled services: ${enabled.join(', ') || 'none'}.`,
    `Disabled services: ${disabled.join(', ') || 'none'}.`,
    'Never advertise, promise, or attempt a disabled service. Its tools are intentionally absent.',
  ].join('\n');
}
