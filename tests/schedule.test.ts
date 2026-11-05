import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EditError, applyEdits, formatDone } from "../src/edit";
import { buildProject } from "../src/model";
import { findGanttTable, findTables } from "../src/parser";
import { ScheduleError, earliestStart, pushSuccessors } from "../src/schedule";
import { parseDate } from "../src/dates";

const d = (s: string): number => parseDate(s) as number;
const today = d("2026-11-05");

function build(rows: string[]) {
	const text = ["| WBS | Task | Start | End | After | Done |", "| - | - | - | - | - | - |", ...rows].join("\n");
	return buildProject(findTables(text)[0], today);
}

describe("earliestStart", () => {
	const task = { milestone: false, start: d("2026-11-02"), end: d("2026-11-06") };
	const gate = { milestone: true, start: d("2026-11-06"), end: d("2026-11-06") };

	it("starts a task the day after the task it follows ends", () => {
		expect(earliestStart(task, { milestone: false })).toBe(d("2026-11-07"));
	});

	it("lets a milestone fall on the day the task before it ends", () => {
		expect(earliestStart(task, { milestone: true })).toBe(d("2026-11-06"));
	});

	it("lets work start on the day of a milestone it follows", () => {
		expect(earliestStart(gate, { milestone: false })).toBe(d("2026-11-06"));
		expect(earliestStart(gate, { milestone: true })).toBe(d("2026-11-06"));
	});
});

describe("conflicts", () => {
	it("marks a task that starts before the task it follows ends", () => {
		const p = build([
			"| 1 | A | 2026-11-02 | 2026-11-10 | | |",
			"| 2 | B | 2026-11-08 | 2026-11-12 | 1 | |",
			"| 3 | C | 2026-11-11 | 2026-11-12 | 1 | |",
		]);
		expect(p.byWbs.get("2")?.conflict).toBe(true);
		expect(p.byWbs.get("3")?.conflict).toBe(false);
		expect(p.stats.conflicts).toBe(1);
	});

	it("does not mark a task that starts the day after", () => {
		const p = build(["| 1 | A | 2026-11-02 | 2026-11-10 | | |", "| 2 | B | 2026-11-11 | 2026-11-12 | 1 | |"]);
		expect(p.stats.conflicts).toBe(0);
	});

	it("drops a link that loops back and reports it", () => {
		const p = build([
			"| 1 | A | 2026-11-02 | 2026-11-03 | 2 | |",
			"| 2 | B | 2026-11-04 | 2026-11-05 | 1 | |",
		]);
		const remaining = p.tasks.flatMap((t) => t.after).length;
		expect(remaining).toBe(1);
		expect(p.issues.some((i) => i.message.includes("wait on each other"))).toBe(true);
	});

	it("handles a longer loop", () => {
		const p = build([
			"| 1 | A | 2026-11-02 | 2026-11-03 | 3 | |",
			"| 2 | B | 2026-11-04 | 2026-11-05 | 1 | |",
			"| 3 | C | 2026-11-06 | 2026-11-07 | 2 | |",
		]);
		expect(p.issues.filter((i) => i.message.includes("wait on each other"))).toHaveLength(1);
	});
});

describe("pushSuccessors", () => {
	const p = build([
		"| 1 | A | 2026-11-02 | 2026-11-06 | | |",
		"| 2 | B | 2026-11-09 | 2026-11-13 | 1 | |",
		"| 3 | C | 2026-11-16 | 2026-11-20 | 2 | |",
		"| 4 | ◆ Gate | 2026-11-20 | | 3 | |",
		"| 5 | Unrelated | 2026-11-09 | 2026-11-10 | | |",
	]);

	it("pushes the tasks that follow, all the way down the chain", () => {
		// A now ends on 11-11, so B (5 days) is pushed to 11-12 to 11-16, C (5 days) to 11-17 to 11-21,
		// and the gate, which can fall on the day C ends, to 11-21.
		const out = pushSuccessors(p, new Map([["1", { start: d("2026-11-02"), end: d("2026-11-11") }]]));
		expect(out.get("2")).toEqual({ start: d("2026-11-12"), end: d("2026-11-16") });
		expect(out.get("3")).toEqual({ start: d("2026-11-17"), end: d("2026-11-21") });
		expect(out.get("4")).toEqual({ start: d("2026-11-21"), end: d("2026-11-21") });
		expect(out.has("5")).toBe(false);
	});

	it("moves nothing when there is room", () => {
		const out = pushSuccessors(p, new Map([["1", { start: d("2026-11-03"), end: d("2026-11-07") }]]));
		expect(out.size).toBe(0);
	});

	it("never pulls tasks earlier", () => {
		const out = pushSuccessors(p, new Map([["1", { start: d("2026-10-20"), end: d("2026-10-24") }]]));
		expect(out.size).toBe(0);
	});

	it("leaves the moved tasks themselves alone", () => {
		const moved = new Map([
			["1", { start: d("2026-11-09"), end: d("2026-11-13") }],
			["2", { start: d("2026-11-16"), end: d("2026-11-20") }],
		]);
		const out = pushSuccessors(p, moved);
		expect(out.has("1")).toBe(false);
		expect(out.has("2")).toBe(false);
		expect(out.get("3")?.start).toBe(d("2026-11-21"));
	});

	it("stops with an error if a loop gets past the parser", () => {
		const loop = build([
			"| 3 | Start | 2026-11-02 | 2026-11-03 | | |",
			"| 1 | A | 2026-11-04 | 2026-11-05 | 3 | |",
			"| 2 | B | 2026-11-06 | 2026-11-07 | 1 | |",
		]);
		const a = loop.byWbs.get("1");
		if (!a) throw new Error("fixture missing");
		a.after = ["3", "2"]; // A and B now follow each other, which the parser would have removed
		expect(() => pushSuccessors(loop, new Map([["3", { start: d("2026-12-01"), end: d("2026-12-02") }]]))).toThrow(ScheduleError);
	});
});

describe("progress edits", () => {
	const NOTE = [
		"| WBS | Task | Start | End | Done |",
		"| --- | --- | --- | --- | --- |",
		"| 1 | Build | 2026-11-02 | 2026-11-13 | 40% |",
		"| 2 | Plain number | 2026-11-02 | 2026-11-13 | 40 |",
		"| 3 | Empty | 2026-11-02 | 2026-11-13 | |",
	].join("\n");

	it("keeps the percent sign when the cell had one", () => {
		const out = applyEdits(NOTE, [{ line: 2, name: "Build", wbs: "1", done: 65 }]);
		expect(out.split("\n")[2]).toBe("| 1 | Build | 2026-11-02 | 2026-11-13 | 65% |");
	});

	it("keeps a bare number bare", () => {
		const out = applyEdits(NOTE, [{ line: 3, name: "Plain number", wbs: "2", done: 70 }]);
		expect(out.split("\n")[3]).toBe("| 2 | Plain number | 2026-11-02 | 2026-11-13 | 70 |");
	});

	it("fills an empty cell with a percent", () => {
		const out = applyEdits(NOTE, [{ line: 4, name: "Empty", wbs: "3", done: 25 }]);
		expect(out.split("\n")[4]).toBe("| 3 | Empty | 2026-11-02 | 2026-11-13 | 25% |");
	});

	it("keeps the value between 0 and 100", () => {
		expect(formatDone(140, "40%")).toBe("100%");
		expect(formatDone(-5, "40%")).toBe("0%");
	});

	it("refuses when the table has no Done column", () => {
		const text = ["| Task | Start | End |", "| --- | --- | --- |", "| A | 2026-11-02 | 2026-11-05 |"].join("\n");
		expect(() => applyEdits(text, [{ line: 2, name: "A", wbs: "1", done: 50 }])).toThrow(EditError);
	});

	it("edits dates and progress of one row together", () => {
		const out = applyEdits(NOTE, [{ line: 2, name: "Build", wbs: "1", start: d("2026-11-04"), done: 50 }]);
		expect(out.split("\n")[2]).toBe("| 1 | Build | 2026-11-04 | 2026-11-13 | 50% |");
	});
});

describe("the example plan in docs/", () => {
	const text = readFileSync(resolve(__dirname, "../docs/example-level-up-plan.md"), "utf8");
	const table = findGanttTable(text);

	it("reads without problems", () => {
		expect(table).not.toBeNull();
		const p = buildProject(table as NonNullable<typeof table>, d("2026-11-05"));
		expect(p.issues).toEqual([]);
		expect(p.tasks.length).toBeGreaterThan(30);
	});

	it("has no schedule conflicts, so every task starts after the ones it follows", () => {
		const p = buildProject(table as NonNullable<typeof table>, d("2026-11-05"));
		expect(p.tasks.filter((t) => t.conflict).map((t) => t.wbs)).toEqual([]);
	});

	it("runs for six months and finishes on 28 March", () => {
		const p = buildProject(table as NonNullable<typeof table>, d("2026-11-05"));
		expect(p.start).toBe(d("2026-10-12"));
		expect(p.stats.finish).toBe(d("2027-03-28"));
	});
});
