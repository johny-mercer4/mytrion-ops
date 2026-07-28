function partsAt(date: Date, timeZone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
}

/** Convert a wall-clock time in an IANA zone to its UTC instant without a date library. */
export function zonedDateTimeToUtc(
  ymd: string,
  timeZone: string,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const [year, month, day] = ymd.split('-').map(Number);
  if (!year || !month || !day) throw new Error(`Invalid date '${ymd}'`);
  const desired = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = new Date(desired);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const observed = partsAt(candidate, timeZone);
    const observedAsUtc = Date.UTC(
      observed.year ?? year,
      (observed.month ?? month) - 1,
      observed.day ?? day,
      observed.hour ?? 0,
      observed.minute ?? 0,
      observed.second ?? 0,
    );
    candidate = new Date(candidate.getTime() + desired - observedAsUtc);
  }
  return candidate;
}

export function addCalendarDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const value = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return value.toISOString().slice(0, 10);
}

export function reportingDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function dayBounds(ymd: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: zonedDateTimeToUtc(ymd, timeZone),
    end: zonedDateTimeToUtc(addCalendarDays(ymd, 1), timeZone),
  };
}

export function monthDays(periodStart: string): string[] {
  const days: string[] = [];
  for (let cursor = periodStart; cursor.slice(0, 7) === periodStart.slice(0, 7); cursor = addCalendarDays(cursor, 1)) {
    days.push(cursor);
  }
  return days;
}

export function previousMonthStart(date: Date, timeZone: string): string {
  const current = reportingDate(date, timeZone);
  const [year, month] = current.split('-').map(Number);
  const value = new Date(Date.UTC(year ?? 0, (month ?? 1) - 2, 1));
  return value.toISOString().slice(0, 10);
}
