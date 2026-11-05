import { describe, expect, it } from "vitest";
import { buildProject, ownerList, visibleTasks } from "../src/model";
import { findTables } from "../src/parser";
import { parseDate } from "../src/dates";

const d = (s: string): number => parseDate(s) as number;

function project(rows: string[], today = "2026-11-05", header = "| WBS | Task | Start | End | Done | After | Owner | Baseline |") {
	const text = [header, "| - | - | - | - | - | - | - | - |", ...rows].join("\n");
	return buildProject(findTables(text)[0], d(today));
}

describe("hierarchy and rollup", () => {
	const p = project([
		"| 1 | Phase | | | | | | |",
		"| 1.1 | A | 2026-10-05 | 2026-10-09 | 100% | | Joshuva | |",
		"| 1.2 | B | 2026-10-12 | 2026-10-23 | 0% | 1.1 | Mei | |",
		"| 2 | Other | 2026-11-01 | 2026-11-02 | | | | |",
	]);

	it("marks parents as summary rows with levels", () => {
		expect(p.byWbs.get("1")?.summary).toBe(true);
		expect(p.byWbs.get("1")?.level).toBe(0);
		expect(p.byWbs.get("1.1")?.level).toBe(1);
		expect(p.byWbs.get("1.1")?.parent).toBe("1");
		expect(p.byWbs.get("2")?.summary).toBe(false);
	});

	it("rolls dates up from children", () => {
		const phase = p.byWbs.get("1");
		expect(phase?.start).toBe(d("2026-10-05"));
		expect(phase?.end).toBe(d("2026-10-23"));
	});

	it("weights summary progress by task length", () => {
		// A is 5 days at 100%, B is 12 days at 0%: 500 / 17 = 29.4
		expect(p.byWbs.get("1")?.done).toBe(29);
	});

	it("keeps rows in the order they appear in the note", () => {
		expect(p.tasks.map((t) => t.wbs)).toEqual(["1", "1.1", "1.2", "2"]);
	});

	it("records the note line of each row", () => {
		expect(p.byWbs.get("1.1")?.line).toBe(3);
	});
});

describe("milestones", () => {
	it("treats a diamond-prefixed name as a milestone and strips the marker", () => {
		const p = project(["| 1 | ◆ Launch | 2026-12-01 | | | | | |"]);
		const t = p.byWbs.get("1");
		expect(t?.milestone).toBe(true);
		expect(t?.name).toBe("Launch");
		expect(t?.end).toBe(t?.start);
	});

	it("does not count milestones in progress totals", () => {
		const p = project([
			"| 1 | Work | 2026-11-02 | 2026-11-06 | 100% | | | |",
			"| 2 | ◆ Gate | 2026-11-06 | | | | | |",
		]);
		expect(p.stats.done).toBe(100);
		expect(p.stats.taskCount).toBe(1);
	});
});

describe("validation", () => {
	it("reports a bad date and skips the row", () => {
		const p = project(["| 1 | Bad | 2026-11-030 | 2026-11-30 | | | | |", "| 2 | Good | 2026-11-02 | 2026-11-03 | | | | |"]);
		expect(p.tasks.map((t) => t.wbs)).toEqual(["2"]);
		expect(p.issues.some((i) => i.message.includes("2026-11-030"))).toBe(true);
	});

	it("reports a duplicate WBS number", () => {
		const p = project(["| 1 | A | 2026-11-02 | 2026-11-03 | | | | |", "| 1 | B | 2026-11-04 | 2026-11-05 | | | | |"]);
		expect(p.tasks).toHaveLength(1);
		expect(p.issues.some((i) => i.message.includes("more than once"))).toBe(true);
	});

	it("falls back to End = Start when End is before Start", () => {
		const p = project(["| 1 | Backwards | 2026-11-10 | 2026-11-05 | | | | |"]);
		expect(p.byWbs.get("1")?.end).toBe(d("2026-11-10"));
		expect(p.issues.some((i) => i.message.includes("before Start"))).toBe(true);
	});

	it("flags an unknown predecessor and a self reference", () => {
		const p = project(["| 1 | A | 2026-11-02 | 2026-11-03 | | 9, 1 | | |"]);
		expect(p.byWbs.get("1")?.after).toEqual([]);
		expect(p.issues).toHaveLength(2);
	});

	it("keeps valid predecessors", () => {
		const p = project(["| 1 | A | 2026-11-02 | 2026-11-03 | | | | |", "| 2 | B | 2026-11-04 | 2026-11-05 | | 1 | | |"]);
		expect(p.byWbs.get("2")?.after).toEqual(["1"]);
	});

	it("numbers rows automatically when WBS is blank", () => {
		const p = project(["| | A | 2026-11-02 | 2026-11-03 | | | | |", "| | B | 2026-11-04 | 2026-11-05 | | | | |"]);
		expect(p.tasks.map((t) => t.wbs)).toEqual(["1", "2"]);
	});

	it("rejects a table with no Task and Start columns", () => {
		const text = "| A | B |\n| - | - |\n| 1 | 2 |";
		const out = buildProject(findTables(text)[0], d("2026-11-05"));
		expect(out.tasks).toHaveLength(0);
		expect(out.issues).toHaveLength(1);
	});

	it("clamps progress to 0 to 100", () => {
		const p = project(["| 1 | A | 2026-11-02 | 2026-11-03 | 250% | | | |"]);
		expect(p.byWbs.get("1")?.done).toBe(100);
	});

	it("attaches a row to its nearest existing ancestor", () => {
		const p = project(["| 1 | Top | | | | | | |", "| 1.2.3 | Deep | 2026-11-02 | 2026-11-03 | | | | |"]);
		expect(p.byWbs.get("1.2.3")?.parent).toBe("1");
		expect(p.byWbs.get("1.2.3")?.level).toBe(1);
	});
});

describe("status and slip", () => {
	it("computes each status against today", () => {
		const p = project([
			"| 1 | Finished | 2026-10-01 | 2026-10-05 | 100% | | | |",
			"| 2 | Overdue | 2026-10-01 | 2026-11-03 | 60% | | | |",
			"| 3 | Running | 2026-11-02 | 2026-11-20 | 30% | | | |",
			"| 4 | Later | 2026-12-01 | 2026-12-05 | | | | |",
			"| 5 | Slipping | 2026-11-02 | 2026-11-27 | 10% | | | 2026-11-20 |",
		]);
		expect(p.byWbs.get("1")?.status).toBe("done");
		expect(p.byWbs.get("2")?.status).toBe("late");
		expect(p.byWbs.get("3")?.status).toBe("prog");
		expect(p.byWbs.get("4")?.status).toBe("todo");
		expect(p.byWbs.get("5")?.status).toBe("risk");
		expect(p.byWbs.get("5")?.slip).toBe(7);
	});

	it("reports finish slip against the latest baseline", () => {
		const p = project(["| 1 | A | 2026-11-02 | 2026-11-27 | | | | 2026-11-20 |"]);
		expect(p.stats.finishSlip).toBe(7);
	});

	it("takes a summary status from its worst child", () => {
		const p = project([
			"| 1 | Phase | | | | | | |",
			"| 1.1 | OK | 2026-11-02 | 2026-11-20 | 10% | | | |",
			"| 1.2 | Late | 2026-10-01 | 2026-11-03 | 0% | | | |",
		]);
		expect(p.byWbs.get("1")?.status).toBe("late");
	});
});

describe("visibleTasks and ownerList", () => {
	const p = project([
		"| 1 | Phase | | | | | | |",
		"| 1.1 | A | 2026-11-02 | 2026-11-03 | | | Joshuva | |",
		"| 1.1.1 | A deep | 2026-11-02 | 2026-11-03 | | | Mei | |",
		"| 2 | B | 2026-11-04 | 2026-11-05 | | | Joshuva | |",
	]);

	it("hides everything below a collapsed row", () => {
		expect(visibleTasks(p, new Set(["1"])).map((t) => t.wbs)).toEqual(["1", "2"]);
		expect(visibleTasks(p, new Set(["1.1"])).map((t) => t.wbs)).toEqual(["1", "1.1", "2"]);
		expect(visibleTasks(p, new Set()).map((t) => t.wbs)).toHaveLength(4);
	});

	it("lists owners once in order of first appearance", () => {
		expect(ownerList(p)).toEqual(["Joshuva", "Mei"]);
	});
});

describe("finish slip with summary rows", () => {
	it("ignores summary rows when working out the baseline finish", () => {
		const p = project([
			"| 1 | Phase | | | | | | |",
			"| 1.1 | Work | 2026-11-02 | 2026-11-27 | | | | 2026-11-20 |",
		]);
		expect(p.stats.finishSlip).toBe(7);
	});
});

describe("easy-to-type milestone markers", () => {
	it("accepts <>, (ms) and [ms] as well as the diamond", () => {
		const p = project([
			"| 1 | <> Gate A | 2026-12-01 | | | | | |",
			"| 2 | (ms) Gate B | 2026-12-02 | | | | | |",
			"| 3 | [MS] Gate C | 2026-12-03 | | | | | |",
			"| 4 | ◇ Gate D | 2026-12-04 | | | | | |",
			"| 5 | Not a milestone <> | 2026-12-05 | | | | | |",
		]);
		expect(p.tasks.map((t) => [t.name, t.milestone])).toEqual([
			["Gate A", true],
			["Gate B", true],
			["Gate C", true],
			["Gate D", true],
			["Not a milestone <>", false],
		]);
	});
});
