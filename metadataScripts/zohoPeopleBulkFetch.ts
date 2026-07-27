/**
 * Zoho People bulk record fetch — paginate getRecords for one form until exhausted.
 *
 *   GET {base}/forms/{formLinkName}/getRecords?sIndex=&limit=
 *
 * Usage:
 *   pnpm meta:zoho-people-records -- --module=employee
 *   pnpm meta:zoho-people-records -- --module=employee --max-pages=2
 *   pnpm meta:zoho-people-records -- --module=leave --modified-after=1710000000000
 *
 * Rate limit: ~400 req / 5 min for getRecords. Backs off on HTTP 429.
 * Output: metadataScripts/output/zoho-people-records-<form>.json
 */
import 'dotenv/config';
import { env } from '../src/config/env.js';
import { tryGetJson } from './lib/http.js';
import { nowIso, runAnalyzer, writeMetadata, type WrittenPaths } from './lib/output.js';
import { parsePeopleCliArgs, peopleCliHelp } from './lib/peopleArgs.js';
import {
  filterForms,
  flattenGetRecordsResult,
  formApiName,
  listPeopleForms,
  type FlatPeopleRecord,
} from './lib/peopleForms.js';
import { fetchZohoAccessToken, resolveZohoConfig, zohoAuthHeader } from './lib/zohoAuth.js';

interface PeopleGetRecordsResponse {
  response?: {
    result?: Array<Record<string, unknown[]>>;
    status?: number;
    message?: string;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPage(
  url: string,
  headers: Record<string, string>,
  attempt = 0,
): Promise<PeopleGetRecordsResponse> {
  const res = await tryGetJson<PeopleGetRecordsResponse>(url, headers);
  if (!res.ok) {
    const is429 = /HTTP 429/.test(res.error);
    if (is429 && attempt < 5) {
      const wait = Math.min(60_000, 2_000 * 2 ** attempt);
      console.warn(`[zoho-people-records] 429 — backing off ${wait}ms (attempt ${attempt + 1})`);
      await sleep(wait);
      return fetchPage(url, headers, attempt + 1);
    }
    throw new Error(res.error);
  }
  return res.data;
}

async function main(): Promise<WrittenPaths> {
  const args = parsePeopleCliArgs();
  if (args.help) {
    console.log(peopleCliHelp('records'));
    process.exit(0);
  }
  if (args.modules.length === 0) {
    console.log(peopleCliHelp('records'));
    throw new Error('--module=<formLinkName> is required');
  }

  const cfg = resolveZohoConfig('people');
  const token = await fetchZohoAccessToken(cfg);
  const headers = zohoAuthHeader(token);
  const base = env.ZOHO_PEOPLE_BASE_URL.replace(/\/+$/, '');

  const allForms = await listPeopleForms(base, headers);
  const matched = filterForms(allForms, args.modules);
  if (matched.length !== 1) {
    throw new Error(
      `[zoho-people-records] --module must resolve to exactly one form (got ${matched.length}). ` +
        `Pass a single formLinkName.`,
    );
  }
  const form = matched[0]!;
  const formLinkName = formApiName(form);
  const pageSize = Math.min(200, Math.max(1, args.pageSize));

  console.log(
    `[zoho-people-records] fetching ${formLinkName} (pageSize=${pageSize}` +
      (args.maxPages ? `, maxPages=${args.maxPages}` : '') +
      ')',
  );

  const records: FlatPeopleRecord[] = [];
  let sIndex = 1;
  let page = 0;
  let truncated = false;

  for (;;) {
    if (args.maxPages !== undefined && page >= args.maxPages) {
      truncated = true;
      break;
    }

    const url = new URL(`${base}/forms/${encodeURIComponent(formLinkName)}/getRecords`);
    url.searchParams.set('sIndex', String(sIndex));
    url.searchParams.set('limit', String(pageSize));
    if (args.modifiedAfterMs !== undefined) {
      url.searchParams.set('modifiedtime', String(args.modifiedAfterMs));
    }

    const json = await fetchPage(url.toString(), headers);
    const status = json.response?.status;
    if (status !== undefined && status !== 0) {
      throw new Error(
        `[zoho-people-records] getRecords status=${status}: ${json.response?.message ?? 'unknown'}`,
      );
    }

    const batch = flattenGetRecordsResult(json.response?.result ?? []);
    records.push(...batch);
    page += 1;
    console.log(
      `[zoho-people-records] page ${page}: +${batch.length} (total ${records.length}) sIndex=${sIndex}`,
    );

    if (batch.length < pageSize) break;
    sIndex += pageSize;
    // Gentle pacing under the 400/5min ceiling.
    await sleep(150);
  }

  const outName = `zoho-people-records-${formLinkName.replace(/[^\w.-]+/g, '_')}`;
  const jsonOut = {
    service: 'zoho-people-records',
    generatedAt: nowIso(),
    base,
    form: {
      apiName: formLinkName,
      displayName: form.displayName ?? formLinkName,
    },
    pageSize,
    pagesFetched: page,
    truncated,
    modifiedAfterMs: args.modifiedAfterMs ?? null,
    recordCount: records.length,
    records,
  };

  const md = [
    `# Zoho People records — \`${formLinkName}\``,
    '',
    `Generated: ${jsonOut.generatedAt}`,
    `Records: ${records.length}${truncated ? ' (truncated by --max-pages)' : ''}`,
    `Pages: ${page} × ${pageSize}`,
    '',
    `Full payload: \`${outName}.json\``,
    '',
  ].join('\n');

  return writeMetadata(outName, jsonOut, md);
}

runAnalyzer('zoho-people-records', main);
