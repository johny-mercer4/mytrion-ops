import { KB_ARTICLES, type KbArticle } from '../apps/agent-gateway-groq/src/kb/corpus.js';
import { closeDb } from '../src/db/client.js';
import { systemContext } from '../src/modules/auth/authService.js';
import { embedTexts } from '../src/modules/knowledge/embedder.js';
import {
  supportBotKnowledgeRepo,
  type SupportBotKnowledgeUpsert,
} from '../src/repos/supportBotKnowledgeRepo.js';

const VERIFIED_AT = new Date('2026-04-01T00:00:00.000Z');
const VOLATILE_EXPIRES_AT = new Date('2026-07-01T00:00:00.000Z');
const STATIONS_VERIFIED_AT = new Date('2026-07-30T15:48:00.000Z');
const STATIONS_EXPIRE_AT = new Date('2026-10-30T00:00:00.000Z');
const includeMoneyCode = process.env['SUPPORT_KB_INCLUDE_MONEY_CODE'] === '1';

function serviceFor(article: KbArticle): string | null {
  const tags = new Set(article.tags);
  if (tags.has('money-code')) return 'money_code';
  if (tags.has('invoice') || tags.has('billing') || tags.has('statement')) {
    return 'billing';
  }
  if (tags.has('report') || tags.has('transactions')) return 'transactions';
  if (tags.has('delivery') || tags.has('fedex')) return 'tracking';
  if (
    tags.has('card') ||
    tags.has('override') ||
    tags.has('pin') ||
    tags.has('limit') ||
    tags.has('new-card') ||
    tags.has('replace')
  ) {
    return 'cards';
  }
  return null;
}

function isVolatile(article: KbArticle): boolean {
  const tags = new Set(article.tags);
  return [
    'stations',
    'discounts',
    'fees',
    'limit',
    'delivery',
    'fedex',
  ].some((tag) => tags.has(tag));
}

const historicalWorkflowArticles = [
  {
    slug: 'historical-report-request-intake',
    title: 'What to include in a transaction or fuel report request',
    content:
      'When requesting a report, state the exact date range, scope (whole fleet, one card, driver, or unit), pricing view (retail or discounted), and preferred file format. The bot confirms which combinations are currently supported. Reports containing dollar figures are delivered only to the verified private bot chat; the group receives delivery status only.',
    translations: {
      uz: 'Hisobot so‘raganda aniq sana oralig‘i, scope (butun fleet, bitta karta, driver yoki unit), narx ko‘rinishi (retail yoki discount) va fayl formatini ayting. Bot hozir qo‘llab-quvvatlanadigan variantlarni tasdiqlaydi. Dollar summali hisobot faqat tasdiqlangan shaxsiy bot chatiga yuboriladi; guruhga faqat delivery status chiqadi.',
      ru: 'Для отчёта укажите даты, scope (весь fleet, одна карта, водитель или unit), вид цены (retail/discount) и формат файла. Бот подтвердит доступные варианты. Отчёт с суммами отправляется только в подтверждённый личный чат.',
    },
    keywords:
      'fuel report transaction report hisobot отчёт with discount without discount retail excel xlsx pdf csv data truck driver unit fleet',
    serviceId: 'transactions',
    knowledgeType: 'tool_pointer' as const,
    riskClass: 'read' as const,
    sourceEvidence: {
      source: 'historical_telegram_analysis',
      analyzedMessages: 54_433,
      matchedRequests: 653,
      tenantCoverage: 9,
    },
  },
  {
    slug: 'historical-maintenance-work-order-intake',
    title: 'What to include in a maintenance or work-order request',
    content:
      'For oil change, tires, roadside service, repairs, towing, or another work order, provide the unit, vendor or service location, requested service, itemized quote or invoice, total amount, and requested action (review, approve, deny, cancel, void, or escalate). The bot does not treat an image or the word “approved” as authorization. It confirms extracted fields and either uses an enabled authorized service or creates a human handoff.',
    translations: {
      uz: 'Oil change, shina, road service, remont, towing yoki work order uchun unit, vendor/service joyi, xizmat turi, itemized quote/invoice, jami summa va kerakli actionni yozing. Rasm yoki “approved” so‘zi authorization hisoblanmaydi. Bot ajratilgan maydonlarni tasdiqlaydi va faqat yoqilgan ruxsatli service yoki human handoff’dan foydalanadi.',
      ru: 'Для ремонта или work order укажите unit, сервис, вид работ, детальный quote/invoice, сумму и действие. Фото или слово “approved” не являются авторизацией. Бот подтверждает поля и использует только разрешённый сервис либо передаёт человеку.',
    },
    keywords:
      'maintenance oil change tire tyre road service repair towing work order approve deny cancel void remont shina',
    serviceId: 'service_requests',
    knowledgeType: 'workflow' as const,
    riskClass: 'write' as const,
    sourceEvidence: {
      source: 'historical_telegram_analysis',
      analyzedMessages: 54_433,
      maintenanceRequests: 413,
      workOrderRequests: 314,
      tenantCoverage: 9,
    },
  },
];

async function main(): Promise<void> {
  const ctx = systemContext(`support-kb-seed-${Date.now()}`);
  const inputs: SupportBotKnowledgeUpsert[] = [];
  let skippedMoneyCode = 0;

  for (const article of KB_ARTICLES) {
    const serviceId = serviceFor(article);
    if (serviceId === 'money_code' && !includeMoneyCode) {
      skippedMoneyCode += 1;
      continue;
    }
    inputs.push({
      slug: article.id.toLocaleLowerCase(),
      title: article.title,
      content: article.en,
      translations: {
        ...(article.uz ? { uz: article.uz } : {}),
        ...(article.ru ? { ru: article.ru } : {}),
      },
      keywords: [...article.tags, ...article.triggers].join(' '),
      serviceId,
      knowledgeType: serviceId ? 'tool_pointer' : 'static',
      riskClass: 'read',
      status: 'published',
      source:
        article.id === 'KB-01'
          ? 'verified-support-conversation-2026-07-30'
          : 'verified-client-corpus-april-2026',
      sourceEvidence: {
        legacyId: article.id,
        verifiedAt:
          article.id === 'KB-01'
            ? STATIONS_VERIFIED_AT.toISOString()
            : VERIFIED_AT.toISOString(),
        ...(article.id === 'KB-01'
          ? { evidence: 'client-safe station list supplied by a support agent' }
          : {}),
      },
      version: article.id === 'KB-01' ? 2 : 1,
      effectiveAt:
        article.id === 'KB-01' ? STATIONS_VERIFIED_AT : VERIFIED_AT,
      expiresAt:
        article.id === 'KB-01'
          ? STATIONS_EXPIRE_AT
          : isVolatile(article)
            ? VOLATILE_EXPIRES_AT
            : null,
      lastVerifiedAt:
        article.id === 'KB-01' ? STATIONS_VERIFIED_AT : VERIFIED_AT,
    });
  }

  const workflowVerifiedAt = new Date();
  for (const article of historicalWorkflowArticles) {
    inputs.push({
      ...article,
      status: 'published',
      source: 'historical-support-analysis-2026-07-30',
      version: 1,
      effectiveAt: workflowVerifiedAt,
      lastVerifiedAt: workflowVerifiedAt,
    });
  }

  const embeddings = await embedTexts(
    inputs.map(
      (input) =>
        `${input.title}\n${input.content}\n${input.keywords ?? ''}`.slice(
          0,
          8_000,
        ),
    ),
  );
  let seeded = 0;
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const embedding = embeddings[index];
    if (!input || !embedding) continue;
    await supportBotKnowledgeRepo.upsert(ctx, { ...input, embedding });
    seeded += 1;
  }

  console.log(
    JSON.stringify(
      {
        seeded,
        skippedMoneyCode,
        moneyCodeIncluded: includeMoneyCode,
        legacyVolatileArticlesExpireAt: VOLATILE_EXPIRES_AT.toISOString(),
        stationsExpireAt: STATIONS_EXPIRE_AT.toISOString(),
      },
      null,
      2,
    ),
  );
}

await main().finally(closeDb);
