import { describe, expect, it } from 'vitest';
import {
  selectToolPlanForTurn,
  selectToolsForPrompt,
  type SelectionHistoryMessage,
} from '../src/toolSelection.js';
import type { ToolManifest } from '../src/toolRuntime.js';

const names = [
  'octane_whoami',
  'octane_kb_search',
  'octane_card_status',
  'octane_txn_report',
  'octane_transactions',
  'telegram_progress',
  'octane_money_code_quote',
  'octane_money_code',
  'octane_card_action',
  'octane_card_limits',
  'octane_card_info',
  'octane_invoice',
  'octane_invoices',
  'octane_funds',
  'octane_balance_dm',
  'octane_manual_code',
  'octane_service_request',
  'octane_tracking',
  'octane_last_used',
  'octane_payment_status',
  'octane_billing_form',
  'octane_override',
  'telegram_buttons',
  'telegram_react',
  'telegram_read_image',
];

const manifests: ToolManifest[] = names.map((name) => ({
  name,
  description: name,
  parameters: { type: 'object' },
  riskClass: 'read',
  async execute() {
    return { content: [{ type: 'text', text: 'ok' }] };
  },
}));

function selected(prompt: string): string[] {
  return selectToolsForPrompt(manifests, prompt).map((tool) => tool.name);
}

function plan(
  prompt: string,
  history: SelectionHistoryMessage[] = [],
): { tools: string[]; requiredSequence: string[] } {
  const result = selectToolPlanForTurn(manifests, prompt, history);
  return {
    tools: result.tools.map((tool) => tool.name),
    requiredSequence: result.requiredSequence,
  };
}

describe('selectToolsForPrompt', () => {
  it('sends no tools for a greeting', () => {
    expect(selected('[msg 1 from Jamshid (id 9)]: @octane_support_ai_bot hi')).toEqual([]);
  });

  it('sends only card tools for a card-status ask', () => {
    expect(selected('[msg 2 from Jamshid (id 9)]: karta statusini tekshir')).toEqual([
      'octane_card_status',
      'telegram_buttons',
    ]);
  });

  it('includes report delivery dependencies for a report ask', () => {
    expect(selected('[msg 3 from Jamshid (id 9)]: weekly report pdf')).toEqual([
      'octane_txn_report',
      'telegram_progress',
    ]);
  });

  it('falls back to identity and grounded KB for unknown wording', () => {
    expect(selected('[msg 4 from Jamshid (id 9)]: something unclear')).toEqual([
      'octane_whoami',
      'octane_kb_search',
    ]);
  });

  it('forces the exact card-status read for a bare last-6 follow-up', () => {
    const history: SelectionHistoryMessage[] = [
      {
        role: 'user',
        content: '[msg 21 from Jamshid (id 9)]: cardning statusi qanaqa? [photo]',
      },
      {
        role: 'assistant',
        content: "Rasmni o'qib bo'lmadi. Oxirgi 6 raqamini yozing.",
      },
    ];
    expect(plan('[msg 23 from Jamshid (id 9)]: 917022', history)).toEqual({
      tools: ['octane_card_status', 'telegram_buttons'],
      requiredSequence: ['octane_card_status'],
    });
  });

  it('inherits the unresolved card lookup through a short correction follow-up', () => {
    const history: SelectionHistoryMessage[] = [
      {
        role: 'user',
        content: '[msg 21 from Jamshid (id 9)]: cardning statusi qanaqa?',
      },
      {
        role: 'assistant',
        content: "Oxirgi 6 raqamini yozing.",
      },
      { role: 'user', content: '[msg 23 from Jamshid (id 9)]: 917022' },
      {
        role: 'assistant',
        content: 'Agent tasdiqlashi kerak.',
      },
    ];
    expect(
      plan(
        '[msg 27 from Jamshid (id 9)]: nega agentim tasdiqlashi kerak?',
        history,
      ),
    ).toMatchObject({
      requiredSequence: ['octane_card_status'],
    });
  });

  it('recovers the card intent after an intervening role question', () => {
    const history: SelectionHistoryMessage[] = [
      {
        role: 'user',
        content: '[msg 21 from Jamshid (id 9)]: cardning statusi qanaqa?',
      },
      { role: 'assistant', content: "Oxirgi 6 raqamini yozing." },
      { role: 'user', content: '[msg 23 from Jamshid (id 9)]: 917022' },
      {
        role: 'assistant',
        content: 'Karta statusini tekshirish uchun agentingiz tasdiqlashi kerak.',
      },
      {
        role: 'user',
        content: '[msg 25 from Jamshid (id 9)]: mani rolim qanaqa',
      },
      { role: 'assistant', content: 'Sizning rolingiz owner.' },
    ];
    const correction = plan(
      '[msg 27 from Jamshid (id 9)]: nega agentim tasdiqlashi kerak?',
      history,
    );
    expect(correction.requiredSequence).toEqual(['octane_card_status']);

    history.push(
      {
        role: 'user',
        content: '[msg 27 from Jamshid (id 9)]: nega agentim tasdiqlashi kerak?',
      },
      {
        role: 'assistant',
        content: 'Karta statusini hozir tekshirishda yordam beraman.',
      },
    );
    expect(
      plan('[msg 29 from Jamshid (id 9)]: qachon?', history).requiredSequence,
    ).toEqual(['octane_card_status']);
  });

  it('keeps a role question scoped to whoami instead of stale card context', () => {
    const history: SelectionHistoryMessage[] = [
      { role: 'user', content: '[msg 23 from Jamshid (id 9)]: 917022' },
    ];
    expect(plan('[msg 25 from Jamshid (id 9)]: mani rolim qanaqa', history)).toEqual({
      tools: ['octane_whoami'],
      requiredSequence: ['octane_whoami'],
    });
  });

  it('hides a write tool before confirmation and requires it after a verified yes tap', () => {
    const initial = plan(
      '[msg 30 from Jamshid (id 9)]: 917022 kartani deactivate qil',
    );
    expect(initial.tools).not.toContain('octane_card_action');
    expect(initial.requiredSequence).toEqual([
      'octane_card_status',
      'telegram_buttons',
    ]);

    const confirmed = plan(
      '[button tap from Jamshid (id 9)]: confirm:deactivate:917022:yes',
    );
    expect(confirmed.tools).toContain('octane_card_action');
    expect(confirmed.requiredSequence).toEqual(['octane_card_action']);
  });

  it('forces progress before private report delivery', () => {
    expect(
      plan('[msg 40 from Jamshid (id 9)]: weekly report pdf').requiredSequence,
    ).toEqual(['telegram_progress', 'octane_txn_report']);
  });

  it('does not call tools for a capability summary', () => {
    expect(plan('[msg 50 from Jamshid (id 9)]: nima qila olasan')).toEqual({
      tools: [],
      requiredSequence: [],
    });
  });

  it('keeps every legacy gateway tool reachable through routing', () => {
    const prompts = [
      '[msg 1 from J (id 9)]: card photo',
      '[msg 2 from J (id 9)]: money code',
      '[button tap from J (id 9)]: confirm:money-code:500:12:B-2:yes',
      '[msg 3 from J (id 9)]: manual entry code',
      '[msg 4 from J (id 9)]: weekly report pdf',
      '[msg 5 from J (id 9)]: recent transactions',
      '[msg 6 from J (id 9)]: latest invoice pdf',
      '[msg 7 from J (id 9)]: invoice billing',
      '[msg 8 from J (id 9)]: balance funds',
      '[msg 9 from J (id 9)]: override',
      '[button tap from J (id 9)]: confirm:override:yes',
      '[button tap from J (id 9)]: confirm:card-action:deactivate:917022:yes',
      '[button tap from J (id 9)]: confirm:card-limit:917022:ULSD:50:yes',
      '[button tap from J (id 9)]: confirm:card-info:917022:unit:004:yes',
      '[button tap from J (id 9)]: confirm:service-request:card-replace:yes',
      '[msg 10 from J (id 9)]: tracking delivery',
      '[msg 11 from J (id 9)]: last used',
      '[msg 12 from J (id 9)]: mani rolim qanaqa',
      '[msg 13 from J (id 9)]: station fee qanday',
      '[msg 14 from J (id 9)]: rahmat',
    ];
    const reachable = new Set(
      prompts.flatMap((prompt) => plan(prompt).tools),
    );
    expect([...reachable].sort()).toEqual([...names].sort());
  });
});
