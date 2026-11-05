/**
 * Turns a raw Markdown table into a validated project: a WBS tree with
 * rolled-up summary rows, milestones, progress and status.
 */
import { MILESTONE_MARK, mapColumns, RawTable } from "./parser";
import { parseDate } from "./dates";
import { earliestStart } from "./schedule";

export type Status = "todo" | "prog" | "done" | "risk" | "late";

export interface Task {
	/** WBS number, unique within the project, for example "1.2.3". */
	wbs: string;
	name: string;
	start: number;
	end: number;
	/** Percent complete, 0 to 100. Summary rows are weighted by task length. */
	done: number;
	owner: string;
	/** WBS numbers of predecessor tasks. */
	after: string[];
	baseline: number | null;
	milestone: boolean;
	summary: boolean;
	/** Depth in the tree. Top-level rows are 0. */
	level: number;
	parent: string | null;
	children: string[];
	/** Zero-based line of this row in the note. */
	line: number;
	status: Status;
	/** Days the finish has moved past the baseline. Zero when there is no baseline. */
	slip: number;
	/** True when the End cell is empty, so the task is a single day or a milestone. */
	endBlank: boolean;
	/** True when the task starts before a task it follows has finished. */
	conflict: boolean;
}

export interface Issue {
	/** Zero-based note line the problem is on. */
	line: number;
	message: string;
}

export interface Stats {
	done: number;
	counts: Record<Status, number>;
	finish: number;
	baselineFinish: number;
	finishSlip: number;
	taskCount: number;
	/** How many tasks start before a task they follow has finished. */
	conflicts: number;
}

export interface Project {
	tasks: Task[];
	byWbs: Map<string, Task>;
	issues: Issue[];
	start: number;
	end: number;
	stats: Stats;
}

const WBS_PATTERN = /^\d+(\.\d+)*$/;

interface Draft {
	wbs: string;
	name: string;
	start: number | null;
	end: number | null;
	done: number;
	owner: string;
	after: string[];
	baseline: number | null;
	milestone: boolean;
	line: number;
}

interface Resolved {
	valid: boolean;
	start: number;
	end: number;
	done: number;
	weight: number;
}

function emptyStats(day: number): Stats {
	return {
		done: 0,
		counts: { todo: 0, prog: 0, done: 0, risk: 0, late: 0 },
		finish: day,
		baselineFinish: day,
		finishSlip: 0,
		taskCount: 0,
		conflicts: 0,
	};
}

function emptyProject(issues: Issue[], today: number): Project {
	return { tasks: [], byWbs: new Map(), issues, start: today, end: today + 30, stats: emptyStats(today) };
}

function leafStatus(t: { milestone: boolean; start: number; end: number; done: number; slip: number }, today: number): Status {
	if (t.milestone) {
		if (t.start < today) return "done";
		return t.slip > 0 ? "risk" : "todo";
	}
	if (t.done >= 100) return "done";
	if (t.end < today) return "late";
	if (t.slip > 0) return "risk";
	if (t.done > 0 || t.start <= today) return "prog";
	return "todo";
}

function summaryStatus(children: Status[], done: number): Status {
	if (children.includes("late")) return "late";
	if (children.includes("risk")) return "risk";
	if (done >= 100) return "done";
	if (children.includes("prog") || children.includes("done")) return "prog";
	return "todo";
}

export function buildProject(table: RawTable, today: number): Project {
	const issues: Issue[] = [];
	const cols = mapColumns(table.headers);
	if (cols.task === -1 || cols.start === -1) {
		issues.push({ line: table.startLine, message: "The table needs a Task column and a Start column." });
		return emptyProject(issues, today);
	}

	const cell = (cells: string[], idx: number): string => (idx >= 0 ? (cells[idx] ?? "").trim() : "");

	// 1. Read every row into a draft, reporting problems per row.
	const drafts: Draft[] = [];
	const seen = new Set<string>();
	let autoWbs = 0;
	for (const row of table.rows) {
		if (row.cells.every((c) => c.trim() === "")) continue;
		let name = cell(row.cells, cols.task);
		let milestone = false;
		if (MILESTONE_MARK.test(name)) {
			milestone = true;
			name = name.replace(MILESTONE_MARK, "");
		}
		if (name === "") {
			issues.push({ line: row.line, message: "This row has no task name." });
			continue;
		}

		let wbs = cell(row.cells, cols.wbs);
		if (wbs !== "" && !WBS_PATTERN.test(wbs)) {
			issues.push({ line: row.line, message: `"${wbs}" is not a valid WBS number. Use 1, 1.1, 1.2.1 and so on.` });
			wbs = "";
		}
		if (wbs === "") {
			do {
				autoWbs++;
			} while (seen.has(String(autoWbs)));
			wbs = String(autoWbs);
		}
		if (seen.has(wbs)) {
			issues.push({ line: row.line, message: `WBS ${wbs} is used more than once. This row is skipped.` });
			continue;
		}
		seen.add(wbs);

		const startRaw = cell(row.cells, cols.start);
		const endRaw = cell(row.cells, cols.end);
		const start = startRaw === "" ? null : parseDate(startRaw);
		const end = endRaw === "" ? null : parseDate(endRaw);
		if (startRaw !== "" && start === null) {
			issues.push({ line: row.line, message: `Start "${startRaw}" is not a date. Use YYYY-MM-DD.` });
		}
		if (endRaw !== "" && end === null) {
			issues.push({ line: row.line, message: `End "${endRaw}" is not a date. Use YYYY-MM-DD.` });
		}

		let done = 0;
		const doneRaw = cell(row.cells, cols.done).replace("%", "").trim();
		if (doneRaw !== "") {
			const n = Number(doneRaw);
			if (Number.isNaN(n)) issues.push({ line: row.line, message: `Done "${doneRaw}" is not a number.` });
			else done = Math.min(100, Math.max(0, Math.round(n)));
		}

		const baselineRaw = cell(row.cells, cols.baseline);
		const baseline = baselineRaw === "" ? null : parseDate(baselineRaw);
		if (baselineRaw !== "" && baseline === null) {
			issues.push({ line: row.line, message: `Baseline "${baselineRaw}" is not a date. Use YYYY-MM-DD.` });
		}

		drafts.push({
			wbs,
			name,
			start,
			end,
			done,
			owner: cell(row.cells, cols.owner),
			after: cell(row.cells, cols.after)
				.split(/[,;\s]+/)
				.filter((s) => s !== ""),
			baseline,
			milestone,
			line: row.line,
		});
	}

	// 2. Work out the tree. A row's parent is its nearest existing WBS ancestor.
	const draftByWbs = new Map<string, Draft>();
	drafts.forEach((d) => draftByWbs.set(d.wbs, d));
	const parentOf = (wbs: string): string | null => {
		const parts = wbs.split(".");
		while (parts.length > 1) {
			parts.pop();
			const candidate = parts.join(".");
			if (draftByWbs.has(candidate)) return candidate;
		}
		return null;
	};
	const childrenOf = new Map<string, string[]>();
	drafts.forEach((d) => {
		const p = parentOf(d.wbs);
		if (p !== null) {
			const list = childrenOf.get(p) ?? [];
			list.push(d.wbs);
			childrenOf.set(p, list);
		}
	});

	// 3. Resolve dates and progress bottom-up. Leaf rows without a start date are dropped.
	const resolved = new Map<string, Resolved>();
	const resolve = (wbs: string): Resolved => {
		const cached = resolved.get(wbs);
		if (cached) return cached;
		const d = draftByWbs.get(wbs) as Draft;
		const kids = childrenOf.get(wbs) ?? [];
		let out: Resolved;
		if (kids.length === 0) {
			if (d.start === null) {
				if (!issues.some((i) => i.line === d.line)) {
					issues.push({ line: d.line, message: "Start date is missing. This row is not drawn." });
				}
				out = { valid: false, start: 0, end: 0, done: 0, weight: 0 };
			} else {
				let end = d.end ?? d.start;
				if (end < d.start) {
					issues.push({ line: d.line, message: "End is before Start. The End date was ignored." });
					end = d.start;
				}
				const len = end - d.start + 1;
				out = { valid: true, start: d.start, end: d.milestone ? d.start : end, done: d.milestone ? 0 : d.done, weight: d.milestone ? 0 : len };
			}
		} else {
			const parts = kids.map(resolve).filter((r) => r.valid);
			if (parts.length === 0) {
				out = { valid: false, start: 0, end: 0, done: 0, weight: 0 };
			} else {
				const weight = parts.reduce((sum, r) => sum + r.weight, 0);
				const doneSum = parts.reduce((sum, r) => sum + r.done * r.weight, 0);
				out = {
					valid: true,
					start: Math.min(...parts.map((r) => r.start)),
					end: Math.max(...parts.map((r) => r.end)),
					done: weight > 0 ? Math.round(doneSum / weight) : 0,
					weight,
				};
			}
		}
		resolved.set(wbs, out);
		return out;
	};
	drafts.forEach((d) => resolve(d.wbs));

	const validWbs = new Set(drafts.filter((d) => resolved.get(d.wbs)?.valid).map((d) => d.wbs));
	const levelOf = (wbs: string): number => {
		let level = 0;
		let p = parentOf(wbs);
		while (p !== null) {
			level++;
			p = parentOf(p);
		}
		return level;
	};

	// 4. Create the final tasks in the order the rows appear in the note.
	const tasks: Task[] = [];
	const byWbs = new Map<string, Task>();
	for (const d of drafts) {
		if (!validWbs.has(d.wbs)) continue;
		const r = resolved.get(d.wbs) as Resolved;
		const kids = (childrenOf.get(d.wbs) ?? []).filter((k) => validWbs.has(k));
		const after: string[] = [];
		for (const a of d.after) {
			if (a === d.wbs) issues.push({ line: d.line, message: `${d.wbs} cannot come after itself.` });
			else if (!draftByWbs.has(a)) issues.push({ line: d.line, message: `After "${a}" does not match any WBS number.` });
			else if (validWbs.has(a)) after.push(a);
		}
		const summary = kids.length > 0;
		const slip = d.baseline !== null ? r.end - d.baseline : 0;
		const task: Task = {
			wbs: d.wbs,
			name: d.name,
			start: r.start,
			end: r.end,
			done: r.done,
			owner: d.owner,
			after,
			baseline: d.baseline,
			milestone: d.milestone && !summary,
			summary,
			level: levelOf(d.wbs),
			parent: parentOf(d.wbs),
			children: kids,
			line: d.line,
			status: "todo",
			slip: summary ? 0 : slip,
			endBlank: d.end === null,
			conflict: false,
		};
		tasks.push(task);
		byWbs.set(task.wbs, task);
	}

	// 4b. Links that loop back on themselves are dropped, and tasks that start too early are marked.
	const state = new Map<string, 0 | 1 | 2>();
	const visit = (t: Task): void => {
		state.set(t.wbs, 1);
		const keep: string[] = [];
		for (const a of t.after) {
			const p = byWbs.get(a);
			if (!p) continue;
			if (state.get(a) === 1) {
				issues.push({ line: t.line, message: `${t.wbs} and ${a} wait on each other, so the link from ${t.wbs} to ${a} is ignored.` });
				continue;
			}
			keep.push(a);
			if (!state.has(a)) visit(p);
		}
		t.after = keep;
		state.set(t.wbs, 2);
	};
	tasks.filter((t) => !t.summary).forEach((t) => {
		if (!state.has(t.wbs)) visit(t);
	});
	tasks.filter((t) => !t.summary).forEach((t) => {
		t.conflict = t.after.some((a) => {
			const p = byWbs.get(a);
			return p !== undefined && !p.summary && t.start < earliestStart(p, t);
		});
	});

	// 5. Status. Leaves first, then summaries from their descendants.
	const leafStatuses = (t: Task): Status[] =>
		t.summary ? t.children.flatMap((c) => leafStatuses(byWbs.get(c) as Task)) : [t.status];
	tasks.filter((t) => !t.summary).forEach((t) => (t.status = leafStatus(t, today)));
	tasks.filter((t) => t.summary).forEach((t) => (t.status = summaryStatus(leafStatuses(t), t.done)));

	if (tasks.length === 0) return emptyProject(issues, today);

	// 6. Project-wide numbers.
	const leaves = tasks.filter((t) => !t.summary && !t.milestone);
	const counts: Record<Status, number> = { todo: 0, prog: 0, done: 0, risk: 0, late: 0 };
	leaves.forEach((t) => counts[t.status]++);
	const weight = leaves.reduce((s, t) => s + (t.end - t.start + 1), 0);
	const doneSum = leaves.reduce((s, t) => s + t.done * (t.end - t.start + 1), 0);
	const finish = Math.max(...tasks.map((t) => t.end));
	// Summary rows have no baseline of their own, so only real tasks and milestones count.
	const baselineFinish = Math.max(...tasks.filter((t) => !t.summary).map((t) => t.baseline ?? t.end));

	return {
		tasks,
		byWbs,
		issues,
		start: Math.min(...tasks.map((t) => t.start)),
		end: finish,
		stats: {
			done: weight > 0 ? Math.round(doneSum / weight) : 0,
			counts,
			finish,
			baselineFinish,
			finishSlip: finish - baselineFinish,
			taskCount: leaves.length,
			conflicts: tasks.filter((t) => t.conflict).length,
		},
	};
}

/** Tasks that are on screen once the collapsed summary rows are taken into account. */
export function visibleTasks(project: Project, collapsed: ReadonlySet<string>): Task[] {
	return project.tasks.filter((t) => {
		let p = t.parent;
		while (p !== null) {
			if (collapsed.has(p)) return false;
			p = project.byWbs.get(p)?.parent ?? null;
		}
		return true;
	});
}

/** Distinct owners in order of first appearance. Used to give each owner a stable colour. */
export function ownerList(project: Project): string[] {
	const out: string[] = [];
	for (const t of project.tasks) {
		if (t.owner !== "" && !out.includes(t.owner)) out.push(t.owner);
	}
	return out;
}

/**
 * The critical path, simplified: start from the task that finishes last and
 * walk back through the predecessor that finishes last at each step.
 */
export function criticalPath(project: Project): Set<string> {
	const out = new Set<string>();
	const leaves = project.tasks.filter((t) => !t.summary);
	if (leaves.length === 0) return out;
	let cur: Task | undefined = leaves.reduce((a, b) => (b.end > a.end ? b : a));
	while (cur && !out.has(cur.wbs)) {
		out.add(cur.wbs);
		let best: Task | undefined;
		for (const w of cur.after) {
			const p = project.byWbs.get(w);
			if (p && !p.summary && (!best || p.end > best.end)) best = p;
		}
		cur = best;
	}
	return out;
}

/** Re-organise the same tasks into one group per owner. Group keys start with "~" so they never clash with WBS numbers. */
export function regroupByOwner(project: Project): Project {
	const leaves = project.tasks.filter((t) => !t.summary);
	const owners: string[] = [];
	for (const t of leaves) if (!owners.includes(t.owner)) owners.push(t.owner);

	const tasks: Task[] = [];
	const byWbs = new Map<string, Task>();
	for (const owner of owners) {
		const members = leaves.filter((t) => t.owner === owner).sort((a, b) => a.start - b.start);
		const key = `~owner:${owner}`;
		const weight = members.filter((m) => !m.milestone).reduce((s, m) => s + (m.end - m.start + 1), 0);
		const doneSum = members.filter((m) => !m.milestone).reduce((s, m) => s + m.done * (m.end - m.start + 1), 0);
		const done = weight > 0 ? Math.round(doneSum / weight) : 0;
		const group: Task = {
			wbs: key,
			name: owner === "" ? "Unassigned" : owner,
			start: Math.min(...members.map((m) => m.start)),
			end: Math.max(...members.map((m) => m.end)),
			done,
			owner,
			after: [],
			baseline: null,
			milestone: false,
			summary: true,
			level: 0,
			parent: null,
			children: members.map((m) => m.wbs),
			line: -1,
			status: summaryStatus(members.map((m) => m.status), done),
			slip: 0,
			endBlank: true,
			conflict: false,
		};
		tasks.push(group);
		byWbs.set(key, group);
		for (const m of members) {
			const copy: Task = { ...m, level: 1, parent: key, children: [] };
			tasks.push(copy);
			byWbs.set(copy.wbs, copy);
		}
	}
	return { ...project, tasks, byWbs };
}
