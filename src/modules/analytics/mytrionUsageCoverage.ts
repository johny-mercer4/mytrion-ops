import { addDays, zonedDayStart, type MytrionUsageWindow } from './mytrionUsageDates.js';
import type { UsageSourceSpan } from './mytrionUsageData.js';
import type {
  MytrionUsageCoverage,
  MytrionUsageCoverageStatus,
} from './mytrionUsageTypes.js';

export function spanStatus(
  span: UsageSourceSpan | undefined,
  failed: boolean,
  window: MytrionUsageWindow,
): MytrionUsageCoverageStatus {
  if (failed || !span?.availableFrom) return 'unavailable';
  const first = new Date(span.availableFrom).getTime();
  const throughValue = span.coveredThrough ?? span.availableThrough;
  const through = throughValue ? new Date(throughValue).getTime() : first;
  if (through <= window.start.getTime() || first >= window.endExclusive.getTime()) {
    return 'unavailable';
  }
  return first > window.start.getTime() || through < window.endExclusive.getTime()
    ? 'partial'
    : 'complete';
}

export function coverageRow(
  source: string,
  label: string,
  status: MytrionUsageCoverageStatus,
  span?: UsageSourceSpan,
  note?: string,
): MytrionUsageCoverage {
  return {
    source,
    label,
    status,
    availableFrom: span?.availableFrom ?? null,
    availableThrough: span?.availableThrough ?? null,
    note: note ?? null,
  };
}

export function intersectSpans(
  spans: ReadonlyMap<string, UsageSourceSpan>,
  sources: string[],
): UsageSourceSpan | undefined {
  const present = sources.map((source) => spans.get(source)).filter((span): span is UsageSourceSpan => Boolean(span));
  if (present.length === 0) return undefined;
  const starts = present.map((span) => span.availableFrom).filter((value): value is string => Boolean(value));
  const ends = present.map((span) => span.availableThrough).filter((value): value is string => Boolean(value));
  return {
    source: 'work_outcomes',
    availableFrom: starts.length > 0 ? starts.sort().at(-1) ?? null : null,
    availableThrough: ends.length > 0 ? ends.sort()[0] ?? null : null,
    coveredThrough: present
      .map((span) => span.coveredThrough ?? span.availableThrough)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null,
  };
}

export function isAvailable(status: MytrionUsageCoverageStatus): boolean {
  return status !== 'unavailable';
}

export function directoryStatus(
  span: UsageSourceSpan | null | undefined,
  failed: boolean,
): MytrionUsageCoverageStatus {
  if (failed || !span?.availableThrough) return 'unavailable';
  const ageMs = Date.now() - new Date(span.availableThrough).getTime();
  if (ageMs <= 36 * 60 * 60_000) return 'complete';
  return ageMs <= 7 * 24 * 60 * 60_000 ? 'partial' : 'unavailable';
}

export function sourceCoversDay(
  status: MytrionUsageCoverageStatus,
  span: UsageSourceSpan | undefined,
  date: string,
): boolean {
  if (!isAvailable(status) || !span?.availableFrom) return false;
  const through = span.coveredThrough ?? span.availableThrough;
  if (!through) return false;
  const dayStart = zonedDayStart(date).getTime();
  const dayEnd = zonedDayStart(addDays(date, 1)).getTime();
  return new Date(span.availableFrom).getTime() < dayEnd && new Date(through).getTime() > dayStart;
}
