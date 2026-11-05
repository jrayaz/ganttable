import { describe, expect, it } from "vitest";
import { findGanttTable, findTables, isSeparator, mapColumns, parseBlockOptions, splitRow } from "../src/parser";

const SAMPLE = [
	"# Plan",
	"",
	"| WBS | Task | Start | End | Done |",
	"| --- | --- | --- | --- | --- |",
	"| 1 | Setup | 2026-10-05 | 2026-10-09 | 50% |",
	"| 2 | Build | 2026-10-12 | 2026-10-16 | |",
	"",
	"```gantt",
	"```",
].join("\n");

describe("splitRow", () => {
	it("trims cells and drops the outer pipes", () => {
		expect(splitRow("| a | b |  c |")).toEqual(["a", "b", "c"]);
	});

	it("keeps empty cells", () => {
		expect(splitRow("| 1 | | 3 |")).toEqual(["1", "", "3"]);
	});

	it("honours escaped pipes", () => {
		expect(splitRow("| a \\| b | c |")).toEqual(["a | b", "c"]);
	});
});

describe("isSeparator", () => {
	it("recognises alignment rows", () => {
		expect(isSeparator("| --- | :---: | ---: |")).toBe(true);
		expect(isSeparator("|---|---|")).toBe(true);
	});

	it("rejects ordinary rows", () => {
		expect(isSeparator("| a | b |")).toBe(false);
	});
});

describe("findTables", () => {
	it("finds a table with its rows and line numbers", () => {
		const [table] = findTables(SAMPLE);
		expect(table.headers).toEqual(["WBS", "Task", "Start", "End", "Done"]);
		expect(table.rows).toHaveLength(2);
		expect(table.rows[0].line).toBe(4);
		expect(table.startLine).toBe(2);
		expect(table.endLine).toBe(5);
	});

	it("ignores tables inside code fences", () => {
		const text = ["```", "| a | b |", "| - | - |", "| 1 | 2 |", "```"].join("\n");
		expect(findTables(text)).toHaveLength(0);
	});

	it("ignores a pipe line with no separator row", () => {
		expect(findTables("| just | text |\nnot a table")).toHaveLength(0);
	});
});

describe("mapColumns", () => {
	it("maps headers case-insensitively and by alias", () => {
		const map = mapColumns(["No.", "Activity", "BEGIN", "Finish", "% Complete", "Depends on", "Assigned to"]);
		expect(map.wbs).toBe(0);
		expect(map.task).toBe(1);
		expect(map.start).toBe(2);
		expect(map.end).toBe(3);
		expect(map.done).toBe(4);
		expect(map.after).toBe(5);
		expect(map.owner).toBe(6);
		expect(map.baseline).toBe(-1);
	});
});

describe("mapColumns for personal plans", () => {
	it("treats Area, Track, Skill, Category and Team as the owner column", () => {
		for (const name of ["Area", "track", "SKILL", "Category", "Team"]) {
			expect(mapColumns(["Task", "Start", name]).owner).toBe(2);
		}
	});
});

describe("findGanttTable", () => {
	it("returns null when no table has Task and Start", () => {
		expect(findGanttTable("| a | b |\n| - | - |\n| 1 | 2 |")).toBeNull();
	});

	it("prefers the nearest table above the block", () => {
		const text = [
			"| Task | Start |",
			"| --- | --- |",
			"| First | 2026-01-01 |",
			"",
			"| Task | Start |",
			"| --- | --- |",
			"| Second | 2026-02-01 |",
			"",
			"```gantt",
			"```",
		].join("\n");
		const table = findGanttTable(text, 8);
		expect(table?.rows[0].cells[0]).toBe("Second");
	});

	it("falls back to the first table when the block is above all tables", () => {
		const table = findGanttTable(SAMPLE, 0);
		expect(table?.rows[0].cells[1]).toBe("Setup");
	});
});

describe("parseBlockOptions", () => {
	it("reads key: value lines", () => {
		expect(parseBlockOptions("title: My plan\nView: week\nnot an option")).toEqual({ title: "My plan", view: "week" });
	});
});
