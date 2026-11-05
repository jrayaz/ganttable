/**
 * Writes date changes back into the Markdown table. Only the Start and End
 * cells of the rows being edited are touched, and their spacing is kept.
 */
import { MILESTONE_MARK, findGanttTable, mapColumns } from "./parser";
import { parseDate, toISO } from "./dates";

export class EditError extends Error {}

export interface RowEdit {
	/** Zero-based line of the row in the note when the chart was drawn. */
	line: number;
	/** Name and WBS the row had then. The edit is refused if the row now says something else. */
	name: string;
	wbs: string;
	start?: number;
	end?: number;
	/** New percent complete, 0 to 100. */
	done?: number;
}

/** Date text in the same style (dashes or slashes) as the cell it replaces. */
export function formatLike(day: number, original: string): string {
	const iso = toISO(day);
	return original.includes("/") ? iso.replace(/-/g, "/") : iso;
}

/** Progress text in the same style as the cell it replaces: "40%" or a bare "40". */
export function formatDone(value: number, original: string): string {
	const n = Math.round(Math.min(100, Math.max(0, value)));
	return original.trim() !== "" && !original.includes("%") ? String(n) : `${n}%`;
}

/** Positions of the unescaped pipe characters in a table line. */
function pipePositions(line: string): number[] {
	const out: number[] = [];
	for (let i = 0; i < line.length; i++) {
		if (line[i] === "\\" && line[i + 1] === "|") {
			i++;
		} else if (line[i] === "|") {
			out.push(i);
		}
	}
	return out;
}

/**
 * Replace the content of chosen cells in one table line, keeping the spacing
 * around them. Cell numbers match the order returned by splitRow.
 */
export function replaceCells(line: string, edits: Map<number, string>): string {
	const pipes = pipePositions(line);
	const endsWithPipe = line.trimEnd().endsWith("|");
	const cellCount = endsWithPipe ? pipes.length - 1 : pipes.length;
	let result = line;
	const indexes = Array.from(edits.keys()).sort((a, b) => b - a);
	for (const k of indexes) {
		if (k < 0 || k >= cellCount) throw new EditError("This row does not have that column.");
		const from = pipes[k] + 1;
		const to = k + 1 < pipes.length ? pipes[k + 1] : line.trimEnd().length;
		const original = line.slice(from, to);
		const value = edits.get(k) as string;
		let replacement: string;
		if (original.trim() === "") {
			const pad = Math.max(2, original.length - value.length);
			replacement = ` ${value}${" ".repeat(pad - 1)}`;
		} else {
			const lead = /^\s*/.exec(original)?.[0] ?? " ";
			const trail = /\s*$/.exec(original)?.[0] ?? " ";
			replacement = `${lead}${value}${trail}`;
		}
		result = result.slice(0, from) + replacement + result.slice(to);
	}
	return result;
}

/**
 * Apply edits to the note text and return the new text. Throws EditError,
 * without changing anything, if the table no longer matches what was drawn.
 */
export function applyEdits(text: string, edits: RowEdit[]): string {
	const table = findGanttTable(text);
	if (!table) throw new EditError("The table could not be found. Press refresh and try again.");
	const cols = mapColumns(table.headers);
	if (cols.start === -1) throw new EditError("The table needs a Start column.");

	// Split on \n only, so the \r of a Windows line ending stays on its line and is written back untouched.
	const lines = text.split("\n");
	for (const edit of edits) {
		const row = table.rows.find((r) => r.line === edit.line);
		const taskCell = row ? (row.cells[cols.task] ?? "").replace(MILESTONE_MARK, "").trim() : null;
		const wbsCell = row && cols.wbs !== -1 ? (row.cells[cols.wbs] ?? "").trim() : "";
		if (!row || taskCell !== edit.name || (wbsCell !== "" && wbsCell !== edit.wbs)) {
			throw new EditError("The note has changed since the chart was drawn. Press refresh and try again.");
		}
		if (edit.end !== undefined && cols.end === -1) {
			throw new EditError("Add an End column to the table to resize tasks.");
		}
		if (edit.done !== undefined && cols.done === -1) {
			throw new EditError("Add a Done column to the table to change progress.");
		}
		const cells = new Map<number, string>();
		const dates: string[] = [];
		if (edit.start !== undefined) {
			const v = formatLike(edit.start, row.cells[cols.start] ?? "");
			cells.set(cols.start, v);
			dates.push(v);
		}
		if (edit.end !== undefined) {
			const v = formatLike(edit.end, row.cells[cols.end] ?? "");
			cells.set(cols.end, v);
			dates.push(v);
		}
		if (edit.done !== undefined) cells.set(cols.done, formatDone(edit.done, row.cells[cols.done] ?? ""));
		if (cells.size === 0) continue;
		if (!dates.every((v) => parseDate(v) !== null)) {
			throw new EditError("The new date could not be written.");
		}
		lines[edit.line] = replaceCells(lines[edit.line], cells);
	}
	return lines.join("\n");
}
