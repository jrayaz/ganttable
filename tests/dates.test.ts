import { describe, expect, it } from "vitest";
import { isoWeek, parseDate, startOfWeek, toISO, todayDay, weekday } from "../src/dates";

describe("parseDate", () => {
	it("parses ISO dates and slash dates", () => {
		expect(parseDate("2026-10-05")).not.toBeNull();
		expect(parseDate("2026/10/05")).toBe(parseDate("2026-10-05"));
		expect(parseDate(" 2026-1-5 ")).toBe(parseDate("2026-01-05"));
	});

	it("rejects malformed and impossible dates", () => {
		expect(parseDate("2026-11-030")).toBeNull();
		expect(parseDate("2026-02-30")).toBeNull();
		expect(parseDate("2026-13-01")).toBeNull();
		expect(parseDate("05/10/2026")).toBeNull();
		expect(parseDate("tomorrow")).toBeNull();
		expect(parseDate("")).toBeNull();
	});

	it("round-trips through toISO", () => {
		const day = parseDate("2027-03-22") as number;
		expect(toISO(day)).toBe("2027-03-22");
	});

	it("counts consecutive days", () => {
		const a = parseDate("2026-12-31") as number;
		const b = parseDate("2027-01-01") as number;
		expect(b - a).toBe(1);
	});
});

describe("weeks", () => {
	it("knows 2026-10-05 is a Monday in ISO week 41", () => {
		const day = parseDate("2026-10-05") as number;
		expect(weekday(day)).toBe(0);
		expect(isoWeek(day)).toBe(41);
	});

	it("finds the Monday of a week", () => {
		const wed = parseDate("2026-10-07") as number;
		expect(toISO(startOfWeek(wed))).toBe("2026-10-05");
		const sun = parseDate("2026-10-11") as number;
		expect(toISO(startOfWeek(sun))).toBe("2026-10-05");
	});

	it("handles the ISO week at a year boundary", () => {
		expect(isoWeek(parseDate("2027-01-01") as number)).toBe(53);
		expect(isoWeek(parseDate("2027-01-04") as number)).toBe(1);
	});
});

describe("todayDay", () => {
	it("uses the local calendar date", () => {
		const d = new Date(2026, 10, 5, 23, 30);
		expect(toISO(todayDay(d))).toBe("2026-11-05");
	});
});
