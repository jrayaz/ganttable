import { describe, expect, it } from "vitest";
import { EditError, applyEdits, formatLike, replaceCells } from "../src/edit";
import { buildProject } from "../src/model";
import { findTables } from "../src/parser";
import { parseDate } from "../src/dates";

const d = (s: string): number => parseDate(s) as number;

describe("replaceCells", () => {
	it("changes only the chosen cells and keeps the spacing", () => {
		const line = "| 1.1 | Survey | 2026-10-05 | 2026-10-23 | 100% |";
		expect(replaceCells(line, new Map([[2, "2026-10-07"]]))).toBe("| 1.1 | Survey | 2026-10-07 | 2026-10-23 | 100% |");
	});

	it("keeps padding in aligned tables", () => {
		const line = "|  1.1 |  Survey        |  2026-10-05  |";
		expect(replaceCells(line, new Map([[2, "2026-10-09"]]))).toBe("|  1.1 |  Survey        |  2026-10-09  |");
	});

	it("fills an empty cell", () => {
		expect(replaceCells("| 1 | A | 2026-11-02 | |", new Map([[3, "2026-11-09"]]))).toBe("| 1 | A | 2026-11-02 | 2026-11-09 |");
		expect(replaceCells("| 1 | A | 2026-11-02 |            |", new Map([[3, "2026-11-09"]]))).toBe("| 1 | A | 2026-11-02 | 2026-11-09 |");
	});

	it("edits two cells at once", () => {
		const out = replaceCells(
			"| A | 2026-11-02 | 2026-11-05 |",
			new Map([
				[1, "2026-11-04"],
				[2, "2026-11-07"],
			])
		);
		expect(out).toBe("| A | 2026-11-04 | 2026-11-07 |");
	});

	it("works when the row has no trailing pipe or has a carriage return", () => {
		expect(replaceCells("| A | 2026-11-02", new Map([[1, "2026-11-03"]]))).toBe("| A | 2026-11-03");
		expect(replaceCells("| A | 2026-11-02 |\r", new Map([[1, "2026-11-03"]]))).toBe("| A | 2026-11-03 |\r");
	});

	it("does not split on escaped pipes", () => {
		expect(replaceCells("| a \\| b | 2026-11-02 |", new Map([[1, "2026-11-03"]]))).toBe("| a \\| b | 2026-11-03 |");
	});

	it("refuses a column the row does not have", () => {
		expect(() => replaceCells("| A | 2026-11-02 |", new Map([[5, "2026-11-03"]]))).toThrow(EditError);
	});
});

describe("formatLike", () => {
	it("keeps slash dates as slash dates", () => {
		expect(formatLike(d("2026-11-02"), "2026/11/01")).toBe("2026/11/02");
		expect(formatLike(d("2026-11-02"), "2026-11-01")).toBe("2026-11-02");
		expect(formatLike(d("2026-11-02"), "")).toBe("2026-11-02");
	});
});

const NOTE = [
	"# Plan",
	"",
	"| WBS | Task | Start | End | Done |",
	"| --- | --- | --- | --- | --- |",
	"| 1 | Phase | | | |",
	"| 1.1 | Survey | 2026-10-05 | 2026-10-23 | 100% |",
	"| 1.2 | Build | 2026-10-19 | | 70% |",
	"| 1.3 | ◆ Sign-off | 2026-11-27 | | |",
	"",
	"Text after the table stays as it is.",
].join("\n");

describe("applyEdits", () => {
	it("moves a task by rewriting Start and End", () => {
		const out = applyEdits(NOTE, [{ line: 5, name: "Survey", wbs: "1.1", start: d("2026-10-07"), end: d("2026-10-25") }]);
		expect(out.split("\n")[5]).toBe("| 1.1 | Survey | 2026-10-07 | 2026-10-25 | 100% |");
		expect(out.split("\n").filter((_, i) => i !== 5)).toEqual(NOTE.split("\n").filter((_, i) => i !== 5));
	});

	it("moves a milestone by its Start only and keeps the marker", () => {
		const out = applyEdits(NOTE, [{ line: 7, name: "Sign-off", wbs: "1.3", start: d("2026-11-30") }]);
		expect(out.split("\n")[7]).toBe("| 1.3 | ◆ Sign-off | 2026-11-30 | | |");
	});

	it("fills in End when a one-day task is resized", () => {
		const out = applyEdits(NOTE, [{ line: 6, name: "Build", wbs: "1.2", end: d("2026-10-30") }]);
		expect(out.split("\n")[6]).toBe("| 1.2 | Build | 2026-10-19 | 2026-10-30 | 70% |");
	});

	it("edits several rows in one go", () => {
		const out = applyEdits(NOTE, [
			{ line: 5, name: "Survey", wbs: "1.1", start: d("2026-10-06"), end: d("2026-10-24") },
			{ line: 6, name: "Build", wbs: "1.2", start: d("2026-10-20") },
		]);
		const lines = out.split("\n");
		expect(lines[5]).toContain("2026-10-06");
		expect(lines[6]).toContain("2026-10-20");
	});

	it("keeps the line endings of a Windows note", () => {
		const crlf = NOTE.replace(/\n/g, "\r\n");
		const out = applyEdits(crlf, [{ line: 5, name: "Survey", wbs: "1.1", start: d("2026-10-07") }]);
		expect(out.split("\r\n")).toHaveLength(NOTE.split("\n").length);
		expect(out.split("\r\n")[5]).toBe("| 1.1 | Survey | 2026-10-07 | 2026-10-23 | 100% |");
	});

	it("refuses when the row at that line is now a different task", () => {
		expect(() => applyEdits(NOTE, [{ line: 5, name: "Something else", wbs: "1.1", start: d("2026-10-07") }])).toThrow(/changed/);
		expect(() => applyEdits(NOTE, [{ line: 5, name: "Survey", wbs: "9.9", start: d("2026-10-07") }])).toThrow(/changed/);
		expect(() => applyEdits(NOTE, [{ line: 40, name: "Survey", wbs: "1.1", start: d("2026-10-07") }])).toThrow(/changed/);
	});

	it("changes nothing when any edit in the batch is refused", () => {
		expect(() =>
			applyEdits(NOTE, [
				{ line: 5, name: "Survey", wbs: "1.1", start: d("2026-10-06") },
				{ line: 6, name: "Nope", wbs: "1.2", start: d("2026-10-20") },
			])
		).toThrow(EditError);
	});

	it("refuses to resize when there is no End column", () => {
		const text = ["| Task | Start |", "| --- | --- |", "| A | 2026-11-02 |"].join("\n");
		expect(() => applyEdits(text, [{ line: 2, name: "A", wbs: "1", end: d("2026-11-09") }])).toThrow(/End column/);
	});

	it("writes dates that read back correctly through the model", () => {
		const out = applyEdits(NOTE, [{ line: 5, name: "Survey", wbs: "1.1", start: d("2026-10-07"), end: d("2026-10-25") }]);
		const project = buildProject(findTables(out)[0], d("2026-11-05"));
		expect(project.byWbs.get("1.1")?.start).toBe(d("2026-10-07"));
		expect(project.byWbs.get("1.1")?.end).toBe(d("2026-10-25"));
		expect(project.byWbs.get("1.2")?.endBlank).toBe(true);
		expect(project.byWbs.get("1.1")?.endBlank).toBe(false);
	});
});

describe("applyEdits with typed milestone markers", () => {
	it("finds a row whose name starts with <>", () => {
		const note = ["| WBS | Task | Start | End |", "| --- | --- | --- | --- |", "| 1 | <> Gate | 2026-12-01 | |"].join("\n");
		const out = applyEdits(note, [{ line: 2, name: "Gate", wbs: "1", start: d("2026-12-03") }]);
		expect(out.split("\n")[2]).toBe("| 1 | <> Gate | 2026-12-03 | |");
	});
});
