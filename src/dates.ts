/**
 * Date helpers. A "day" is a whole number of days since 1970-01-01 (UTC),
 * which avoids every timezone and daylight-saving problem of Date objects.
 */

export const MS_DAY = 86_400_000;

/** Parse YYYY-MM-DD or YYYY/MM/DD. Returns null for anything else, including impossible dates. */
export function parseDate(input: string): number | null {
	const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(input.trim());
	if (!m) return null;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const d = Number(m[3]);
	const ms = Date.UTC(y, mo - 1, d);
	const check = new Date(ms);
	if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
	return Math.round(ms / MS_DAY);
}

export function dayToDate(day: number): Date {
	return new Date(day * MS_DAY);
}

export function toISO(day: number): string {
	return dayToDate(day).toISOString().slice(0, 10);
}

/** Today in the user's local calendar, as a day number. */
export function todayDay(now: Date = new Date()): number {
	return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_DAY);
}

/** Monday = 0 ... Sunday = 6. 1970-01-01 was a Thursday. */
export function weekday(day: number): number {
	return (((day + 3) % 7) + 7) % 7;
}

export function startOfWeek(day: number): number {
	return day - weekday(day);
}

export function isoWeek(day: number): number {
	const d = dayToDate(day);
	const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
	const dn = (t.getUTCDay() + 6) % 7;
	t.setUTCDate(t.getUTCDate() - dn + 3);
	const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
	return 1 + Math.round(((t.getTime() - firstThursday.getTime()) / MS_DAY - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

export function dayOfMonth(day: number): number {
	return dayToDate(day).getUTCDate();
}

export function monthKey(day: number): number {
	const d = dayToDate(day);
	return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

export function quarterKey(day: number): number {
	const d = dayToDate(day);
	return d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3);
}

export function monthName(day: number): string {
	return dayToDate(day).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
}

export function monthYear(day: number): string {
	return `${monthName(day)} ${dayToDate(day).getUTCFullYear()}`;
}

export function quarterLabel(day: number): string {
	const d = dayToDate(day);
	return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}

/** Short date such as "5 Oct". Pass withYear for "5 Oct 2026". */
export function formatShort(day: number, withYear = false): string {
	return dayToDate(day).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: withYear ? "numeric" : undefined,
		timeZone: "UTC",
	});
}
