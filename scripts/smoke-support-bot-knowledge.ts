import { closeDb } from '../src/db/client.js';
import { systemContext } from '../src/modules/auth/authService.js';
import { searchSupportBotKnowledge } from '../src/modules/carrier/supportBotKnowledge.js';

const ctx = systemContext(`support-kb-smoke-${Date.now()}`);
const scope = {
  carrierId: 'support-kb-smoke-carrier',
  enabledServices: [
    'knowledge',
    'cards',
    'transactions',
    'billing',
    'service_requests',
    'tracking',
    'vision',
  ],
};
const scenarios = [
  {
    query: 'hisobotni discount bilan excel formatda qanday olaman',
    expectedSlug: 'historical-report-request-intake',
  },
  {
    query: 'tire work order uchun nima yuborish kerak',
    expectedSlug: 'historical-maintenance-work-order-intake',
  },
  {
    query: 'money code fee qancha',
    expectedSlug: null,
  },
  {
    query: 'supported fuel stations right now',
    expectedSlug: 'kb-01',
  },
];

try {
  for (const scenario of scenarios) {
    const hits = await searchSupportBotKnowledge(
      ctx,
      scope,
      scenario.query,
      3,
    );
    if (
      scenario.expectedSlug === null
        ? hits.length > 0
        : !hits.some((hit) => hit.slug === scenario.expectedSlug)
    ) {
      throw new Error(
        `Unexpected support KB retrieval for "${scenario.query}": ${hits
          .map((hit) => hit.slug)
          .join(', ') || 'no hits'}`,
      );
    }
    console.log(
      JSON.stringify({
        query: scenario.query,
        hits: hits.map(({ slug, serviceId, source }) => ({
          slug,
          serviceId,
          source,
        })),
      }),
    );
  }
} finally {
  await closeDb();
}
