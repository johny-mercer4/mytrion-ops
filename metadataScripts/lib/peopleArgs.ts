/**
 * Shared CLI parsing for Zoho People metadata / bulk-fetch scripts.
 *
 *   --module=employee          one form (alias: --form=)
 *   --module=employee,leave    several forms
 *   --list                     modules only (metadata script)
 *   --max-pages=N              stop after N pages (bulk script)
 *   --page-size=N              records per page (default 200, max 200)
 *   --modified-after=MS        epoch ms filter for getRecords
 */

export interface PeopleCliArgs {
  /** Empty → all modules. Matched case-insensitively against formLinkName / displayName. */
  modules: string[];
  listOnly: boolean;
  maxPages: number | undefined;
  pageSize: number;
  modifiedAfterMs: number | undefined;
  help: boolean;
}

function intFlag(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function parsePeopleCliArgs(argv: string[] = process.argv.slice(2)): PeopleCliArgs {
  const out: PeopleCliArgs = {
    modules: [],
    listOnly: false,
    maxPages: undefined,
    pageSize: 200,
    modifiedAfterMs: undefined,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    if (arg === '--list') {
      out.listOnly = true;
      continue;
    }
    if (arg.startsWith('--module=') || arg.startsWith('--form=')) {
      const value = arg.slice(arg.indexOf('=') + 1);
      out.modules = value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      continue;
    }
    if (arg.startsWith('--max-pages=')) {
      out.maxPages = intFlag(arg.slice('--max-pages='.length), 0) || undefined;
      continue;
    }
    if (arg.startsWith('--page-size=')) {
      out.pageSize = Math.min(200, intFlag(arg.slice('--page-size='.length), 200));
      continue;
    }
    if (arg.startsWith('--modified-after=')) {
      const n = Number(arg.slice('--modified-after='.length));
      if (Number.isFinite(n) && n > 0) out.modifiedAfterMs = n;
    }
  }

  return out;
}

export function peopleCliHelp(script: 'meta' | 'records'): string {
  if (script === 'meta') {
    return [
      'Usage: pnpm meta:zoho-people [-- --module=<formLinkName|displayName>[,...]] [--list]',
      '',
      '  (no flags)              fetch ALL forms + field apiName + data type',
      '  --module=employee       one form (match formLinkName or displayName, case-insensitive)',
      '  --module=a,b            several forms',
      '  --form=…                alias of --module=',
      '  --list                  list matching forms only (no /components calls)',
      '',
      'Output: metadataScripts/output/zoho-people[.json|.md]',
      '        (or zoho-people-<form> when a single --module is set)',
    ].join('\n');
  }
  return [
    'Usage: pnpm meta:zoho-people-records -- --module=<formLinkName> [--page-size=200] [--max-pages=N] [--modified-after=MS]',
    '',
    '  --module=employee       required — formLinkName (or unique displayName)',
    '  --page-size=200         max 200 (People getRecords cap)',
    '  --max-pages=N           stop early (smoke / sampling)',
    '  --modified-after=MS     epoch milliseconds; only records changed after this',
    '',
    'Paginates GET {base}/forms/{form}/getRecords until exhausted.',
    'Output: metadataScripts/output/zoho-people-records-<form>.json',
  ].join('\n');
}
