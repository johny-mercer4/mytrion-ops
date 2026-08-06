import { HORIZON_RAG_GOLDEN_V1 } from '../tests/fixtures/horizon-rag-golden.js';
import { routeRetrievalIntent } from '../src/modules/knowledge/agentic/router.js';

const ids = new Set(HORIZON_RAG_GOLDEN_V1.map((item) => item.id));
if (HORIZON_RAG_GOLDEN_V1.length < 200) throw new Error('RAG golden set must contain at least 200 cases');
if (ids.size !== HORIZON_RAG_GOLDEN_V1.length) throw new Error('RAG golden case ids must be unique');

const routingCorrect = HORIZON_RAG_GOLDEN_V1.filter((item) =>
  routeRetrievalIntent(item.request).route === item.expectedRoute,
).length;
const routingAccuracy = routingCorrect / HORIZON_RAG_GOLDEN_V1.length;
if (routingAccuracy < 0.98) throw new Error(`routing promotion gate failed: ${routingAccuracy}`);
const byCategory = Object.fromEntries(
  [...new Set(HORIZON_RAG_GOLDEN_V1.map((item) => item.category))]
    .sort()
    .map((category) => [category, HORIZON_RAG_GOLDEN_V1.filter((item) => item.category === category).length]),
);

process.stdout.write(`${JSON.stringify({
  schemaVersion: '1',
  cases: HORIZON_RAG_GOLDEN_V1.length,
  routingAccuracy,
  byCategory,
}, null, 2)}\n`);
