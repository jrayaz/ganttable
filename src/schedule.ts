/**
 * Scheduling rules for finish-to-start links. Pure functions, so the same
 * rules drive conflict warnings and pushing dependent tasks later.
 */
import type { Project, Task } from "./model";

export interface Position {
	start: number;
	end: number;
}

interface Timed {
	milestone: boolean;
	start: number;
	end: number;
}

/**
 * The first day `succ` may start when it follows `pred`. A task starts the day
 * after the task it follows ends. A milestone can fall on the day its
 * predecessor ends, and work can start on the day of a milestone it follows.
 */
export function earliestStart(pred: Timed, succ: { milestone: boolean }): number {
	if (succ.milestone) return pred.milestone ? pred.start : pred.end;
	return pred.milestone ? pred.start : pred.end + 1;
}

export class ScheduleError extends Error {}

/**
 * Work out which later tasks have to move so every task still starts after the
 * tasks it follows, given that some tasks have been moved. Tasks are only ever
 * pushed later, never pulled earlier. The moved tasks themselves are left alone.
 */
export function pushSuccessors(project: Project, moved: ReadonlyMap<string, Position>): Map<string, Position> {
	const pos = new Map<string, Position>(moved);
	const at = (t: Task): Position => pos.get(t.wbs) ?? { start: t.start, end: t.end };
	const pushed = new Map<string, Position>();
	const queue = Array.from(moved.keys());
	let steps = 0;
	const limit = project.tasks.length * project.tasks.length + 100;

	while (queue.length > 0) {
		if (++steps > limit) throw new ScheduleError("These tasks depend on each other in a loop.");
		const predWbs = queue.shift() as string;
		const pred = project.byWbs.get(predWbs);
		if (!pred) continue;
		const predPos = at(pred);
		for (const succ of project.tasks) {
			if (succ.summary || moved.has(succ.wbs) || !succ.after.includes(predWbs)) continue;
			const current = at(succ);
			const need = earliestStart({ milestone: pred.milestone, start: predPos.start, end: predPos.end }, succ);
			if (current.start < need) {
				const shift = need - current.start;
				const next = { start: current.start + shift, end: current.end + shift };
				pos.set(succ.wbs, next);
				pushed.set(succ.wbs, next);
				queue.push(succ.wbs);
			}
		}
	}
	return pushed;
}
