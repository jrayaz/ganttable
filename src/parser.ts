/**
 * Reads Markdown tables out of note text. Knows nothing about Gantt charts
 * except how to recognise the column headers.
 */

/**
 * What can start a task name to make it a milestone: a diamond, or something
 * easy to type on any keyboard: <>, (ms) or [ms].
 */
export const MILESTONE_MARK = /^(?:[◆♦◇⬥]|<>|\(ms\)|\[ms\])\s*/i;

export interface RawRow {
	cells: string[];
	/** Zero-based line number in the note. Needed later to write edits back. */
	line: number;
}

export interface RawTable {
	headers: string[];
	rows: RawRow[];
	/** Zero-based line of the header row. */
	startLine: number;
	/** Zero-based line of the last table row. */
	endLine: number;
}

export interface ColumnMap {
	wbs: number;
	task: number;
	start: number;
	end: number;
	done: number;
	after: number;
	owner: number;
	baseline: number;
}

const ALIASES: Record<keyof ColumnMap, string[]> = {
	wbs: ["wbs", "id", "no", "no.", "#", "ref"],
	task: ["task", "name", "activity", "title", "task name"],
	start: ["start", "begin", "from", "start date"],
	end: ["end", "finish", "due", "to", "end date"],
	done: ["done", "progress", "complete", "% complete", "%", "percent"],
	after: ["after", "depends", "depends on", "predecessor", "predecessors", "dep", "deps"],
	owner: ["owner", "assigned", "assignee", "resource", "who", "assigned to", "area", "track", "category", "skill", "team"],
	baseline: ["baseline", "baseline end", "planned end", "plan end"],
};

/** Split one table line into trimmed cells. Honours escaped pipes (\|). */
export function splitRow(line: string): string[] {
	let s = line.trim();
	if (s.startsWith("|")) s = s.slice(1);
	if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
	const cells: string[] = [];
	let cur = "";
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === "\\" && s[i + 1] === "|") {
			cur += "|";
			i++;
		} else if (ch === "|") {
			cells.push(cur.trim());
			cur = "";
		} else {
			cur += ch;
		}
	}
	cells.push(cur.trim());
	return cells;
}

export function isSeparator(line: string): boolean {
	const cells = splitRow(line);
	return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.replace(/\s/g, "")));
}

function isTableLine(line: string): boolean {
	return line.trim().startsWith("|");
}

/** Find every Markdown table in the text. Tables inside fenced code blocks are ignored. */
export function findTables(text: string): RawTable[] {
	const lines = text.split(/\r?\n/);
	const tables: RawTable[] = [];
	let inFence = false;
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			i++;
			continue;
		}
		if (!inFence && isTableLine(line) && i + 1 < lines.length && isTableLine(lines[i + 1]) && isSeparator(lines[i + 1])) {
			const headers = splitRow(line);
			const rows: RawRow[] = [];
			let j = i + 2;
			while (j < lines.length && isTableLine(lines[j])) {
				rows.push({ cells: splitRow(lines[j]), line: j });
				j++;
			}
			tables.push({ headers, rows, startLine: i, endLine: j - 1 });
			i = j;
			continue;
		}
		i++;
	}
	return tables;
}

/** Map header names to column indexes. A missing column is -1. */
export function mapColumns(headers: string[]): ColumnMap {
	const map: ColumnMap = { wbs: -1, task: -1, start: -1, end: -1, done: -1, after: -1, owner: -1, baseline: -1 };
	const keys = Object.keys(ALIASES) as (keyof ColumnMap)[];
	headers.forEach((h, idx) => {
		const name = h.trim().toLowerCase();
		for (const key of keys) {
			if (map[key] === -1 && ALIASES[key].includes(name)) {
				map[key] = idx;
				break;
			}
		}
	});
	return map;
}

export function isGanttTable(table: RawTable): boolean {
	const map = mapColumns(table.headers);
	return map.task !== -1 && map.start !== -1;
}

/**
 * Pick the table that holds the plan. Prefers the nearest Gantt-shaped table
 * above `beforeLine` (the line of a `gantt` code block), then the first one.
 */
export function findGanttTable(text: string, beforeLine?: number): RawTable | null {
	const candidates = findTables(text).filter(isGanttTable);
	if (candidates.length === 0) return null;
	if (beforeLine !== undefined) {
		const above = candidates.filter((t) => t.endLine < beforeLine);
		if (above.length > 0) return above[above.length - 1];
	}
	return candidates[0];
}

/** Settings written inside a `gantt` code block, one `key: value` per line. */
export function parseBlockOptions(source: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const raw of source.split(/\r?\n/)) {
		const m = /^\s*([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/.exec(raw);
		if (m) out[m[1].toLowerCase()] = m[2];
	}
	return out;
}
