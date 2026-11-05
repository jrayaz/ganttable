/**
 * Draws the Gantt chart: a left data table and a timeline, using DOM
 * elements and Obsidian CSS variables so it follows the user's theme.
 */
import { ColorBy, RowHeightSetting, ZoomSetting } from "./settings";
import { earliestStart } from "./schedule";
import { Project, Status, Task, ownerList, visibleTasks } from "./model";
import {
	dayOfMonth,
	formatShort,
	isoWeek,
	monthKey,
	monthName,
	monthYear,
	quarterKey,
	quarterLabel,
	startOfWeek,
} from "./dates";

export const ROW_HEIGHT: Record<Exclude<RowHeightSetting, "fit">, number> = { compact: 26, normal: 32, roomy: 40 };
const FIT_ROW_MIN = 18;
const FIT_ROW_MAX = 56;
const SCROLLBAR_ALLOWANCE = 14;
/** On a touch screen rows and bars get big enough for a finger. */
const COARSE_ROW_MIN = 36;
const COARSE_BAR_MIN = 20;
const ZOOM_PX = { day: 24, week: 8, month: 2.6 };
const WIDE_LABEL_WIDTH = 468;
const NARROW_LABEL_WIDTH = 236;
export const LABEL_WIDTH_MIN = 280;
export const LABEL_WIDTH_MAX = 720;
const HEADER_HEIGHT = 44;
const PAPER_PADDING = 20;

export const STATUS_COLOR: Record<Status, string> = {
	todo: "--text-faint",
	prog: "--interactive-accent",
	done: "--color-green",
	risk: "--color-orange",
	late: "--color-red",
};

export const STATUS_LABEL: Record<Status, string> = {
	todo: "Not started",
	prog: "In progress",
	done: "Done",
	risk: "At risk",
	late: "Late",
};

export const PALETTE = [
	"--color-purple",
	"--color-cyan",
	"--color-orange",
	"--color-pink",
	"--color-green",
	"--color-blue",
	"--color-yellow",
	"--color-red",
];

/** What a drag changes: the whole task, its start, its end, or its percent complete. */
export type DragMode = "move" | "start" | "end" | "progress";

const TOUCH_HOLD_MS = 350;
const TOUCH_SLOP_PX = 8;

export interface ChartState {
	zoom: ZoomSetting;
	colorBy: ColorBy;
	rowHeight: RowHeightSetting;
	collapsed: ReadonlySet<string>;
	selected: string | null;
	today: number;
	showToday: boolean;
	shadeWeekends: boolean;
	showLinks: boolean;
	showBaseline: boolean;
	/** WBS numbers on the critical path, or null when it should not be highlighted. */
	critical: ReadonlySet<string> | null;
	/** Print preview: a light sheet fitted to the width with a title block and legend. */
	paper: boolean;
	title: string;
	/** Bars can be dragged to change dates. */
	editable: boolean;
	/** Width of the task table on the left when the chart is wide enough for all its columns. */
	labelWidth: number;
}

export interface ChartCallbacks {
	onSelect(wbs: string | null): void;
	onToggle(wbs: string): void;
	/** A drag finished. `delta` is whole days for move, start and end, and percentage points for progress. */
	onEdit(wbs: string, mode: DragMode, delta: number): void;
	/** A drag ended, so a redraw that was held back can happen now. */
	onDragEnd(): void;
	/** The task column was resized by dragging its edge. */
	onLabelWidth(width: number): void;
}

export interface TimelineRange {
	start: number;
	days: number;
}

export interface LegendItem {
	label: string;
	colorVar: string;
}

/** The days the timeline covers: from the Monday of the first week to two weeks past the last task. */
export function computeRange(project: Project): TimelineRange {
	const start = startOfWeek(project.start);
	const end = project.end + 14;
	const days = Math.ceil((end - start + 1) / 7) * 7;
	return { start, days };
}

/**
 * Row height in pixels. "Fit" divides the height left under the header between
 * the visible rows, within limits so rows stay readable. With no height to go
 * on (print preview, or before the view is laid out) it falls back to normal.
 */
export function rowHeightFor(setting: RowHeightSetting, availableHeight: number, rowCount: number): number {
	if (setting !== "fit") return ROW_HEIGHT[setting];
	if (availableHeight <= 0 || rowCount <= 0) return ROW_HEIGHT.normal;
	const each = Math.floor((availableHeight - HEADER_HEIGHT - 2) / rowCount);
	return Math.max(FIT_ROW_MIN, Math.min(FIT_ROW_MAX, each));
}

export function pixelsPerDay(zoom: ZoomSetting, availableWidth: number, days: number): number {
	if (zoom === "fit") return Math.max(2, availableWidth / days);
	return ZOOM_PX[zoom];
}

/** Colour variable name for a task under the chosen colour mode. */
export function colorFor(project: Project, task: Task, mode: ColorBy): string {
	if (mode === "status") return task.summary ? "--text-muted" : STATUS_COLOR[task.status];
	if (mode === "owner") {
		const idx = ownerList(project).indexOf(task.owner);
		return idx === -1 ? "--text-faint" : PALETTE[idx % PALETTE.length];
	}
	const roots = project.tasks.filter((t) => t.level === 0);
	let root: Task = task;
	while (root.parent !== null) root = project.byWbs.get(root.parent) ?? root;
	const idx = Math.max(0, roots.indexOf(root));
	return PALETTE[idx % PALETTE.length];
}

export function legendItems(project: Project, mode: ColorBy): LegendItem[] {
	if (mode === "status") {
		return (Object.keys(STATUS_LABEL) as Status[]).map((st) => ({ label: STATUS_LABEL[st], colorVar: STATUS_COLOR[st] }));
	}
	if (mode === "owner") {
		const out: LegendItem[] = [];
		for (const owner of ownerList(project)) {
			const sample = project.tasks.find((t) => t.owner === owner);
			if (sample) out.push({ label: owner, colorVar: colorFor(project, sample, "owner") });
		}
		return out;
	}
	return project.tasks.filter((t) => t.level === 0).map((t) => ({ label: t.name, colorVar: colorFor(project, t, "phase") }));
}

/**
 * Short badge text for each owner, made unique: Hardware and Habit would both
 * be "HA", so the second gets a longer prefix and becomes "HAB".
 */
export function ownerBadges(project: Project): Map<string, string> {
	const out = new Map<string, string>();
	const used = new Set<string>();
	for (const owner of ownerList(project)) {
		const compact = owner.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();
		const candidates = [initials(owner), compact.slice(0, 2), compact.slice(0, 3), compact.slice(0, 4)].filter((c) => c !== "");
		const pick = candidates.find((c) => !used.has(c)) ?? candidates[candidates.length - 1] ?? owner.slice(0, 2).toUpperCase();
		used.add(pick);
		out.set(owner, pick);
	}
	return out;
}

export function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter((p) => p !== "");
	if (parts.length === 0) return "";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Every task linked to `wbs` through After columns, in either direction, including the task itself. */
export function traceChain(project: Project, wbs: string): Set<string> {
	const ups = new Set<string>();
	const upStack = [wbs];
	while (upStack.length > 0) {
		const w = upStack.pop() as string;
		if (ups.has(w)) continue;
		ups.add(w);
		project.byWbs.get(w)?.after.forEach((a) => upStack.push(a));
	}
	const downs = new Set<string>();
	const downStack = [wbs];
	while (downStack.length > 0) {
		const w = downStack.pop() as string;
		if (downs.has(w)) continue;
		downs.add(w);
		for (const t of project.tasks) if (t.after.includes(w)) downStack.push(t.wbs);
	}
	return new Set([...ups, ...downs]);
}

/** SVG path for a finish-to-start link from (x1, y1) to (x2, y2), stepping around when the successor starts too early. */
export function linkPath(x1: number, y1: number, x2: number, y2: number, rowHeight: number): string {
	if (x2 >= x1 + 12) return `M${x1} ${y1}H${x1 + 6}V${y2}H${x2}`;
	const mid = y1 < y2 ? y2 - rowHeight / 2 : y2 + rowHeight / 2;
	return `M${x1} ${y1}H${x1 + 6}V${mid}H${x2 - 6}V${y2}H${x2}`;
}

interface Segment {
	start: number;
	end: number;
	label: string;
}

function segments(range: TimelineRange, keyOf: (day: number) => number, labelOf: (day: number) => string): Segment[] {
	const out: Segment[] = [];
	let cur: Segment | null = null;
	let curKey = 0;
	for (let i = 0; i < range.days; i++) {
		const day = range.start + i;
		const key = keyOf(day);
		if (cur === null || key !== curKey) {
			cur = { start: i, end: i + 1, label: labelOf(day) };
			curKey = key;
			out.push(cur);
		} else {
			cur.end = i + 1;
		}
	}
	return out;
}

/** Build a class list without empty entries, which the DOM helpers reject. */
function cls(...parts: (string | false | null | undefined)[]): string[] {
	return parts.filter((p): p is string => typeof p === "string" && p !== "");
}

function setBox(el: HTMLElement, left: number, width: number): void {
	el.setCssProps({ "--gt-l": `${left}px`, "--gt-w": `${width}px` });
}

export class GanttChart {
	readonly root: HTMLElement;
	private readonly overviewEl: HTMLElement;
	private readonly stage: HTMLElement;
	private readonly sheet: HTMLElement;
	private readonly titleBlock: HTMLElement;
	private readonly grid: HTMLElement;
	private readonly sheetFoot: HTMLElement;
	private range: TimelineRange = { start: 0, days: 7 };
	private px = ZOOM_PX.week;
	private labelWidth = WIDE_LABEL_WIDTH;
	private dragging = false;
	private taskDragging = false;
	private suppressClick = false;
	private tip: HTMLElement | null = null;
	private badges = new Map<string, string>();

	constructor(parent: HTMLElement, private readonly callbacks: ChartCallbacks) {
		this.root = parent.createDiv({ cls: "gt-chart" });
		this.overviewEl = this.root.createDiv({ cls: "gt-over", attr: { "aria-label": "Timeline overview" } });
		this.stage = this.root.createDiv({ cls: "gt-stage" });
		this.sheet = this.stage.createDiv({ cls: "gt-sheet" });
		this.titleBlock = this.sheet.createDiv({ cls: "gt-titleblock" });
		this.grid = this.sheet.createDiv({ cls: "gt-grid" });
		this.sheetFoot = this.sheet.createDiv({ cls: "gt-sheetfoot" });

		this.stage.addEventListener("scroll", () => this.updateViewport());
		this.overviewEl.addEventListener("pointerdown", (ev) => {
			this.dragging = true;
			this.overviewEl.setPointerCapture(ev.pointerId);
			this.jumpTo(ev.clientX);
		});
		this.overviewEl.addEventListener("pointermove", (ev) => {
			if (this.dragging) this.jumpTo(ev.clientX);
		});
		this.overviewEl.addEventListener("pointerup", () => {
			this.dragging = false;
		});
	}

	/** True while a bar is being dragged. The view holds back redraws until it ends. */
	get isDragging(): boolean {
		return this.taskDragging;
	}

	/** Show or hide the overview strip. */
	setOverviewVisible(visible: boolean): void {
		this.overviewEl.toggleClass("gt-hidden", !visible);
	}

	/** Scroll so today sits about a third of the way across the visible timeline. */
	scrollToToday(today: number): void {
		const x = (today - this.range.start) * this.px;
		const visible = Math.max(0, this.stage.clientWidth - this.labelWidth);
		this.stage.scrollTo({ left: Math.max(0, x - visible * 0.3), behavior: "smooth" });
	}

	scrollToStart(): void {
		this.stage.scrollLeft = 0;
	}

	render(project: Project, state: ChartState, narrow: boolean): void {
		this.labelWidth = narrow ? NARROW_LABEL_WIDTH : Math.min(LABEL_WIDTH_MAX, Math.max(LABEL_WIDTH_MIN, state.labelWidth || WIDE_LABEL_WIDTH));
		this.badges = ownerBadges(project);
		this.range = computeRange(project);
		const fit = state.paper ? "fit" : state.zoom;
		const pad = state.paper ? PAPER_PADDING * 2 : 0;
		this.px = pixelsPerDay(fit, this.stage.clientWidth - pad - this.labelWidth - 2, this.range.days);
		const tasks = visibleTasks(project, state.collapsed);
		// The outer height does not change when a scrollbar appears, so Fit cannot chase its own tail.
		const available = state.paper ? 0 : Math.max(0, this.stage.offsetHeight - SCROLLBAR_ALLOWANCE);
		const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
		const rh = Math.max(coarse ? COARSE_ROW_MIN : 0, rowHeightFor(state.rowHeight, available, tasks.length));
		const px = this.px;
		const range = this.range;

		this.root.toggleClass("gt-narrow", narrow);
		this.root.toggleClass("gt-editable", state.editable);
		this.stage.toggleClass("gt-paper", state.paper);
		this.sheet.toggleClass("gt-paper-sheet", state.paper);
		this.sheet.toggleClass("theme-light", state.paper);
		this.root.setCssProps({
			"--gt-lw": `${this.labelWidth}px`,
			"--gt-rh": `${rh}px`,
			"--gt-bh": `${Math.max(coarse ? COARSE_BAR_MIN : 10, Math.round(rh * 0.56))}px`,
			"--gt-tw": `${range.days * px}px`,
			"--gt-px": `${px}px`,
			"--gt-head": `${HEADER_HEIGHT}px`,
		});
		this.grid.empty();

		const chain = state.selected && project.byWbs.has(state.selected) ? traceChain(project, state.selected) : null;
		const trace = chain && chain.size > 1 ? chain : null;

		this.renderHeader(range, px, state, narrow);
		this.renderOverlay(range, px, state, tasks.length * rh);
		const rows = this.grid.createDiv({ cls: "gt-rows" });
		for (const task of tasks) this.renderRow(rows, project, task, state, range, px, trace);
		if (state.showLinks) this.renderLinks(tasks, project, state, range, px, rh, trace);
		this.renderOverview(project, tasks, state);
		this.renderSheetText(project, state);
		this.updateViewport();
	}

	private renderSheetText(project: Project, state: ChartState): void {
		this.titleBlock.empty();
		const left = this.titleBlock.createDiv();
		left.createEl("h2", { text: state.title });
		left.createEl("p", {
			text: `${formatShort(project.start, true)} to ${formatShort(project.end, true)} · ${project.stats.taskCount} tasks · ${project.stats.done}% done`,
		});
		const meta = this.titleBlock.createDiv({ cls: "gt-meta" });
		meta.createDiv({ text: `Printed ${formatShort(state.today, true)}` });
		meta.createDiv({ text: "Fit to width" });

		this.sheetFoot.empty();
		const legend = this.sheetFoot.createDiv({ cls: "gt-legend" });
		for (const item of legendItems(project, state.colorBy)) {
			const entry = legend.createSpan();
			entry.setCssProps({ "--gt-c": `var(${item.colorVar})` });
			entry.createEl("i");
			entry.createSpan({ text: item.label });
		}
		this.sheetFoot.createSpan({ cls: "gt-foot-note", text: "Made with Ganttable" });
	}

	private renderHeader(range: TimelineRange, px: number, state: ChartState, narrow: boolean): void {
		const head = this.grid.createDiv({ cls: "gt-head" });
		const corner = head.createDiv({ cls: "gt-corner" });
		corner.createSpan({ cls: "gt-c-w", text: "WBS" });
		corner.createSpan({ cls: "gt-nm", text: "Task" });
		corner.createSpan({ cls: "gt-c-s", text: "Start" });
		corner.createSpan({ cls: "gt-c-e", text: "End" });
		corner.createSpan({ cls: "gt-c-d", text: "Done" });
		corner.createSpan({ cls: "gt-av-space" });
		if (!narrow) this.attachResizer(corner.createDiv({ cls: "gt-resizer", attr: { title: "Drag to resize the task column" } }));

		const thead = head.createDiv({ cls: "gt-thead" });
		const days = px >= 14;
		const weeks = px >= 3;

		const topSeg = weeks ? segments(range, monthKey, monthYear) : segments(range, quarterKey, quarterLabel);
		for (const seg of topSeg) {
			const cell = thead.createDiv({ cls: "gt-hc gt-t1", text: seg.label });
			setBox(cell, seg.start * px, (seg.end - seg.start) * px);
		}

		if (days) {
			for (let i = 0; i < range.days; i++) {
				const day = range.start + i;
				const weekend = i % 7 > 4;
				const cell = thead.createDiv({ cls: cls("gt-hc", "gt-t2", weekend && "gt-we"), text: String(dayOfMonth(day)) });
				setBox(cell, i * px, px);
			}
		} else if (weeks) {
			for (let i = 0; i < range.days; i += 7) {
				const label = px * 7 >= 40 ? `W${isoWeek(range.start + i)}` : String(isoWeek(range.start + i));
				const cell = thead.createDiv({ cls: "gt-hc gt-t2", text: label });
				setBox(cell, i * px, Math.min(7, range.days - i) * px);
			}
		} else {
			for (const seg of segments(range, (d) => monthKey(d), (d) => monthName(d))) {
				const cell = thead.createDiv({ cls: "gt-hc gt-t2", text: seg.label });
				setBox(cell, seg.start * px, (seg.end - seg.start) * px);
			}
		}

		if (state.showToday && state.today >= range.start && state.today < range.start + range.days) {
			const pill = thead.createDiv({ cls: "gt-pill-today", attr: { title: "Today" } });
			pill.setCssProps({ "--gt-x": `${(state.today - range.start + 0.5) * px}px` });
		}
	}

	private renderOverlay(range: TimelineRange, px: number, state: ChartState, height: number): void {
		const back = this.grid.createDiv({ cls: "gt-ov" });
		back.setCssProps({ "--gt-h": `${height}px` });
		const svg = back.createSvg("svg", { attr: { width: range.days * px, height: height } });
		for (let i = 1; i < range.days; i++) {
			const day = range.start + i;
			const isMonth = dayOfMonth(day) === 1;
			const isWeek = i % 7 === 0;
			if (isMonth || (isWeek && px >= 3)) {
				svg.createSvg("line", {
					// createSvg adds a string class with classList.add, so a class list must be an array.
					cls: isMonth ? ["gt-gl", "gt-gl-month"] : "gt-gl",
					attr: { x1: i * px, x2: i * px, y1: 0, y2: height },
				});
			}
		}
		if (state.showToday && state.today >= range.start && state.today < range.start + range.days) {
			const line = back.createDiv({ cls: "gt-today" });
			line.setCssProps({ "--gt-x": `${(state.today - range.start + 0.5) * px}px` });
		}
	}

	private renderLinks(
		tasks: Task[],
		project: Project,
		state: ChartState,
		range: TimelineRange,
		px: number,
		rh: number,
		trace: Set<string> | null
	): void {
		const front = this.grid.createDiv({ cls: "gt-ov gt-ov-front" });
		front.setCssProps({ "--gt-h": `${tasks.length * rh}px` });
		const svg = front.createSvg("svg", { attr: { width: range.days * px, height: tasks.length * rh } });
		const rowOf = new Map<string, number>();
		tasks.forEach((t, i) => rowOf.set(t.wbs, i));
		for (const task of tasks) {
			const toRow = rowOf.get(task.wbs);
			if (toRow === undefined || task.summary) continue;
			for (const pid of task.after) {
				const pred = project.byWbs.get(pid);
				const fromRow = rowOf.get(pid);
				if (!pred || fromRow === undefined || pred.summary) continue;
				const x1 = pred.milestone ? (pred.start - range.start + 0.5) * px + 8 : (pred.end + 1 - range.start) * px;
				const x2 = task.milestone ? (task.start - range.start + 0.5) * px - 8 : (task.start - range.start) * px;
				const y1 = fromRow * rh + rh / 2;
				const y2 = toRow * rh + rh / 2;
				const hot = trace !== null && trace.has(task.wbs) && trace.has(pid);
				const crit = state.critical !== null && state.critical.has(task.wbs) && state.critical.has(pid);
				const clash = task.start < earliestStart(pred, task);
				const kind = cls("gt-link", hot && "gt-link-hot", !hot && crit && "gt-link-crit", clash && "gt-link-clash", trace !== null && !hot && "gt-link-dim");
				svg.createSvg("path", { cls: kind, attr: { d: linkPath(x1, y1, x2, y2, rh), fill: "none" } });
				svg.createSvg("path", {
					cls: cls("gt-arrow", hot && "gt-arrow-hot", !hot && crit && "gt-arrow-crit", clash && "gt-arrow-clash", trace !== null && !hot && "gt-link-dim"),
					attr: { d: `M${x2} ${y2}l-5 -3.5v7z` },
				});
			}
		}
	}

	private renderRow(
		parent: HTMLElement,
		project: Project,
		task: Task,
		state: ChartState,
		range: TimelineRange,
		px: number,
		trace: Set<string> | null
	): void {
		const dim = trace !== null && !(task.summary ? task.children.some((c) => trace.has(c)) : trace.has(task.wbs));
		const row = parent.createDiv({
			cls: cls("gt-row", task.summary ? "gt-group" : "gt-task", state.selected === task.wbs && "gt-sel", dim && "gt-dim", task.conflict && "gt-conflict"),
		});
		row.addEventListener("click", () => {
			if (this.suppressClick) return;
			this.callbacks.onSelect(state.selected === task.wbs ? null : task.wbs);
		});

		const left = row.createDiv({ cls: "gt-lcell" });
		left.setCssProps({ "--gt-lvl": String(task.level) });
		if (task.summary) {
			const open = !state.collapsed.has(task.wbs);
			const chev = left.createEl("button", {
				cls: "gt-chev clickable-icon",
				attr: { "aria-expanded": String(open), "aria-label": `${open ? "Collapse" : "Expand"} ${task.name}` },
			});
			const svg = chev.createSvg("svg", { attr: { viewBox: "0 0 12 12", width: 12, height: 12 } });
			svg.createSvg("path", { attr: { d: "M2.5 4.5 6 8l3.5-3.5" } });
			chev.addEventListener("click", (ev) => {
				ev.stopPropagation();
				this.callbacks.onToggle(task.wbs);
			});
		} else {
			left.createSpan({ cls: "gt-chev-space" });
		}
		left.createSpan({ cls: "gt-c-w", text: task.wbs.startsWith("~") ? "" : task.wbs });
		if (!task.summary) {
			const dot = left.createSpan({ cls: "gt-dot" });
			dot.setCssProps({ "--gt-c": `var(${STATUS_COLOR[task.status]})` });
		}
		left.createSpan({ cls: "gt-nm", text: task.name, attr: { title: task.conflict ? `${task.name}\nStarts before a task it follows has finished.` : task.name } });
		left.createSpan({ cls: "gt-c-s", text: formatShort(task.start) });
		left.createSpan({ cls: "gt-c-e", text: task.milestone ? "" : formatShort(task.end) });
		const doneCell = left.createSpan({ cls: "gt-c-d" });
		if (!task.milestone) {
			const track = doneCell.createEl("i");
			const fill = track.createEl("b");
			fill.setCssProps({ "--gt-d": `${task.done}%` });
			doneCell.createSpan({ text: String(task.done) });
		}
		if (task.owner !== "" && !task.summary) {
			const av = left.createSpan({ cls: "gt-av", text: this.badges.get(task.owner) ?? initials(task.owner), attr: { title: task.owner } });
			av.setCssProps({ "--gt-c": `var(${colorFor(project, task, "owner")})` });
		} else {
			left.createSpan({ cls: "gt-av-space" });
		}

		const cell = row.createDiv({ cls: cls("gt-tcell", state.shadeWeekends && px >= 14 && "gt-wk") });
		const color = `var(${colorFor(project, task, state.colorBy)})`;
		const x0 = (task.start - range.start) * px;
		const label = `${task.wbs} ${task.name}, ${formatShort(task.start)}${task.milestone ? "" : ` to ${formatShort(task.end)}, ${task.done}% done`}`;
		const crit = state.critical !== null && state.critical.has(task.wbs);
		const showSlip = state.showBaseline && task.slip > 0;

		if (task.summary) {
			const sum = cell.createDiv({ cls: "gt-sum" });
			setBox(sum, x0, (task.end + 1 - task.start) * px);
			sum.setCssProps({ "--gt-c": color });
			if (state.editable) this.attachDrag(sum, row, task, "move", px, x0, (task.end + 1 - task.start) * px);
		} else if (task.milestone) {
			const ms = cell.createDiv({
				cls: cls("gt-ms", crit && "gt-crit", task.conflict && "gt-clash", state.selected === task.wbs && "gt-sel"),
				attr: { role: "button", tabindex: "0", "aria-label": label },
			});
			ms.setCssProps({ "--gt-l": `${x0 + px / 2 - 7}px`, "--gt-c": color });
			this.bindKey(ms, task.wbs, state, true);
			if (state.editable) this.attachDrag(ms, row, task, "move", px, x0 + px / 2 - 7, 0);
			// Near the end of the timeline the label goes to the left of the diamond so it is not cut off.
			const flip = x0 + px / 2 + 14 + task.name.length * 7 + 70 > range.days * px;
			const after = cell.createDiv({ cls: cls("gt-after", flip && "gt-flip") });
			after.setCssProps({ "--gt-l": `${flip ? x0 + px / 2 - 14 : x0 + px / 2 + 14}px` });
			const name = after.createSpan({ cls: "gt-mn", text: task.name });
			name.createSpan({ text: formatShort(task.start) });
			if (showSlip) after.createSpan({ cls: "gt-slip", text: `+${task.slip}d` });
		} else {
			const bar = cell.createDiv({
				cls: cls("gt-bar", crit && "gt-crit", task.conflict && "gt-clash", state.selected === task.wbs && "gt-sel"),
				attr: { role: "button", tabindex: "0", "aria-label": label },
			});
			setBox(bar, x0, Math.max(4, (task.end + 1 - task.start) * px));
			bar.setCssProps({ "--gt-c": color, "--gt-d": `${task.done}%` });
			bar.createSpan({ cls: "gt-fill" });
			this.bindKey(bar, task.wbs, state);
			if (state.editable) {
				const barWidth = Math.max(4, (task.end + 1 - task.start) * px);
				const leftHandle = bar.createSpan({ cls: "gt-h gt-h-l", attr: { "aria-hidden": "true" } });
				const rightHandle = bar.createSpan({ cls: "gt-h gt-h-r", attr: { "aria-hidden": "true" } });
				this.attachDrag(bar, row, task, "move", px, x0, barWidth);
				this.attachDrag(leftHandle, row, task, "start", px, x0, barWidth, bar);
				this.attachDrag(rightHandle, row, task, "end", px, x0, barWidth, bar);
				if (barWidth >= 36) {
					const grip = bar.createSpan({ cls: "gt-pg", attr: { "aria-hidden": "true", title: "Drag to set progress" } });
					this.attachDrag(grip, row, task, "progress", px, x0, barWidth, bar);
				}
			}
			if (state.showBaseline && task.baseline !== null && task.baseline !== task.end) {
				const ghost = cell.createDiv({ cls: "gt-base", attr: { title: `Baseline finish ${formatShort(task.baseline)}` } });
				setBox(ghost, x0, Math.max(4, (task.baseline + 1 - task.start) * px));
			}
			const after = cell.createDiv({ cls: "gt-after" });
			after.setCssProps({ "--gt-l": `${(task.end + 1 - range.start) * px + 8}px` });
			after.createSpan({ text: `${task.end - task.start + 1}d` });
			if (showSlip) after.createSpan({ cls: "gt-slip", text: `+${task.slip}d` });
		}
	}

	/** Let the right edge of the task table be dragged to make it wider or narrower. */
	private attachResizer(handle: HTMLElement): void {
		handle.addEventListener("pointerdown", (ev: PointerEvent) => {
			if (ev.pointerType === "mouse" && ev.button !== 0) return;
			ev.preventDefault();
			ev.stopPropagation();
			const doc = handle.ownerDocument;
			const startX = ev.clientX;
			const startWidth = this.labelWidth;
			let width = startWidth;
			const onMove = (e: PointerEvent): void => {
				if (e.pointerId !== ev.pointerId) return;
				width = Math.round(Math.min(LABEL_WIDTH_MAX, Math.max(LABEL_WIDTH_MIN, startWidth + e.clientX - startX)));
				this.root.setCssProps({ "--gt-lw": `${width}px` });
			};
			const finish = (e: PointerEvent): void => {
				if (e.pointerId !== ev.pointerId) return;
				doc.removeEventListener("pointermove", onMove);
				doc.removeEventListener("pointerup", finish);
				doc.removeEventListener("pointercancel", finish);
				if (width !== startWidth) this.callbacks.onLabelWidth(width);
			};
			doc.addEventListener("pointermove", onMove);
			doc.addEventListener("pointerup", finish);
			doc.addEventListener("pointercancel", finish);
		});
	}

	/** Dates a drag would give, for the tooltip and for keeping the drag inside valid ranges. */
	private draggedDates(task: Task, mode: DragMode, delta: number): { start: number; end: number } {
		if (mode === "move") return { start: task.start + delta, end: task.end + delta };
		if (mode === "start") return { start: task.start + delta, end: task.end };
		return { start: task.start, end: task.end + delta };
	}

	/** Obsidian clips fixed positioning to the view, so the tooltip is placed relative to the chart itself. */
	private showTip(clientX: number, clientY: number, text: string): void {
		if (!this.tip) this.tip = this.root.createDiv({ cls: "gt-tip" });
		const box = this.root.getBoundingClientRect();
		const x = clientX - box.left;
		this.tip.setText(text);
		this.tip.toggleClass("gt-tip-left", x > box.width - 230);
		this.tip.setCssProps({ "--gt-x": `${x}px`, "--gt-y": `${clientY - box.top}px` });
	}

	private hideTip(): void {
		this.tip?.remove();
		this.tip = null;
	}

	/**
	 * Let a bar, milestone or summary row be dragged. A mouse or pen drags at once;
	 * a finger has to hold for a moment first so that swiping still scrolls the chart.
	 * `target` is the element that moves on screen while dragging (the bar, when a handle is dragged).
	 */
	private attachDrag(
		el: HTMLElement,
		row: HTMLElement,
		task: Task,
		mode: DragMode,
		px: number,
		baseLeft: number,
		baseWidth: number,
		target: HTMLElement = el
	): void {
		// A browser decides whether a touch can scroll as the finger lands, so these listeners must already be
		// in place then. They only act once a press-and-hold has turned the touch into a drag.
		let touchDragActive = false;
		el.addEventListener(
			"touchmove",
			(e: TouchEvent) => {
				if (touchDragActive && e.cancelable) e.preventDefault();
			},
			{ passive: false }
		);
		el.addEventListener("contextmenu", (e: Event) => {
			if (touchDragActive) e.preventDefault();
		});

		el.addEventListener("pointerdown", (ev: PointerEvent) => {
			if (ev.pointerType === "mouse" && ev.button !== 0) return;
			if (mode !== "move") ev.stopPropagation();
			const doc = el.ownerDocument;
			const startX = ev.clientX;
			const startY = ev.clientY;
			const isTouch = ev.pointerType === "touch";
			const span = task.end - task.start;
			let active = false;
			let delta = 0;
			let timer = 0;

			const preview = (): void => {
				if (mode === "progress") {
					target.setCssProps({ "--gt-d": `${task.done + delta}%` });
				} else if (mode === "move") {
					target.setCssProps({ "--gt-l": `${baseLeft + delta * px}px` });
				} else if (mode === "start") {
					target.setCssProps({ "--gt-l": `${baseLeft + delta * px}px`, "--gt-w": `${Math.max(4, baseWidth - delta * px)}px` });
				} else {
					target.setCssProps({ "--gt-w": `${Math.max(4, baseWidth + delta * px)}px` });
				}
			};
			const restore = (): void => {
				delta = 0;
				preview();
			};
			const tipText = (): string => {
				if (mode === "progress") return `Done ${task.done + delta}%  (${delta > 0 ? "+" : ""}${delta})`;
				const dates = this.draggedDates(task, mode, delta);
				const range = task.milestone ? formatShort(dates.start) : `${formatShort(dates.start)} to ${formatShort(dates.end)}`;
				return `${range}  (${delta > 0 ? "+" : ""}${delta}d)`;
			};
			const begin = (): void => {
				active = true;
				touchDragActive = isTouch;
				this.taskDragging = true;
				row.addClass("gt-dragging");
				try {
					el.setPointerCapture(ev.pointerId);
				} catch {
					// Capture is a convenience; the drag still works without it.
				}
			};
			const onMove = (e: PointerEvent): void => {
				if (e.pointerId !== ev.pointerId) return;
				const dx = e.clientX - startX;
				if (!active) {
					if (Math.abs(dx) > TOUCH_SLOP_PX || Math.abs(e.clientY - startY) > TOUCH_SLOP_PX) finish(false);
					return;
				}
				let next: number;
				if (mode === "progress") {
					// Steps of 5 percent across the width of the bar, kept between 0 and 100.
					next = Math.round(((dx / Math.max(1, baseWidth)) * 100) / 5) * 5;
					next = Math.max(-task.done, Math.min(100 - task.done, next));
				} else {
					next = Math.round(dx / px);
					if (mode === "start") next = Math.min(next, span);
					if (mode === "end") next = Math.max(next, -span);
				}
				if (next !== delta) {
					delta = next;
					preview();
				}
				this.showTip(e.clientX, e.clientY, tipText());
			};
			const onUp = (e: PointerEvent): void => {
				if (e.pointerId === ev.pointerId) finish(true);
			};
			const onCancel = (e: PointerEvent): void => {
				if (e.pointerId === ev.pointerId) finish(false);
			};
			const onKey = (e: KeyboardEvent): void => {
				if (e.key === "Escape") finish(false);
			};
			const finish = (commit: boolean): void => {
				window.clearTimeout(timer);
				doc.removeEventListener("pointermove", onMove);
				doc.removeEventListener("pointerup", onUp);
				doc.removeEventListener("pointercancel", onCancel);
				doc.removeEventListener("keydown", onKey);
				touchDragActive = false;
				const moved = active && delta !== 0;
				const finalDelta = delta;
				if (active) {
					this.taskDragging = false;
					row.removeClass("gt-dragging");
					this.hideTip();
					if (moved) {
						this.suppressClick = true;
						window.setTimeout(() => {
							this.suppressClick = false;
						}, 0);
					}
					if (!commit || !moved) restore();
				}
				if (active && commit && moved) this.callbacks.onEdit(task.wbs, mode, finalDelta);
				active = false;
				this.callbacks.onDragEnd();
			};

			// The listeners live on the document, not the bar: the browser can lose pointer capture,
			// and a drag must still end when the button is released anywhere.
			doc.addEventListener("pointermove", onMove);
			doc.addEventListener("pointerup", onUp);
			doc.addEventListener("pointercancel", onCancel);
			doc.addEventListener("keydown", onKey);
			if (isTouch) {
				timer = window.setTimeout(begin, TOUCH_HOLD_MS);
			} else {
				begin();
			}
		});
	}

	/**
	 * Keyboard support for a bar or milestone: Enter selects it. When editing is on,
	 * the arrow keys move it by a day (a week with Shift) and Ctrl or Cmd with an
	 * arrow key moves the end of a bar.
	 */
	private bindKey(el: HTMLElement, wbs: string, state: ChartState, milestone = false): void {
		el.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter" || ev.key === " ") {
				ev.preventDefault();
				this.callbacks.onSelect(state.selected === wbs ? null : wbs);
				return;
			}
			if (!state.editable || (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight")) return;
			ev.preventDefault();
			const step = (ev.shiftKey ? 7 : 1) * (ev.key === "ArrowLeft" ? -1 : 1);
			const resizeEnd = (ev.ctrlKey || ev.metaKey) && !milestone;
			this.callbacks.onEdit(wbs, resizeEnd ? "end" : "move", step);
		});
	}

	private renderOverview(project: Project, tasks: Task[], state: ChartState): void {
		this.overviewEl.empty();
		const range = this.range;
		const leaves = tasks.filter((t) => !t.summary);
		const n = Math.max(leaves.length, 1);
		leaves.forEach((task, i) => {
			const bar = this.overviewEl.createDiv({ cls: "gt-mb" });
			bar.setCssProps({
				"--gt-l": `${((task.start - range.start) / range.days) * 100}%`,
				"--gt-w": `${Math.max(0.6, ((task.end + 1 - task.start) / range.days) * 100)}%`,
				"--gt-t": `${((i + 0.5) / n) * 100}%`,
				"--gt-c": `var(${colorFor(project, task, state.colorBy)})`,
			});
		});
		if (state.showToday && state.today >= range.start && state.today < range.start + range.days) {
			const mark = this.overviewEl.createDiv({ cls: "gt-mt" });
			mark.setCssProps({ "--gt-l": `${((state.today - range.start + 0.5) / range.days) * 100}%` });
		}
		for (const seg of segments(range, (d) => monthKey(d), (d) => monthName(d))) {
			if (seg.end - seg.start < 14) continue;
			const label = this.overviewEl.createDiv({ cls: "gt-ml", text: seg.label });
			label.setCssProps({ "--gt-l": `${(seg.start / range.days) * 100}%` });
		}
		this.overviewEl.createDiv({ cls: "gt-vp" });
	}

	private updateViewport(): void {
		const vp = this.overviewEl.querySelector<HTMLElement>(".gt-vp");
		if (!vp) return;
		const total = this.range.days * this.px;
		const visible = Math.max(0, this.stage.clientWidth - this.labelWidth);
		const left = Math.min(1, Math.max(0, this.stage.scrollLeft / total));
		const width = Math.min(1 - left, visible / total);
		vp.setCssProps({ "--gt-l": `${left * 100}%`, "--gt-w": `${width * 100}%` });
	}

	private jumpTo(clientX: number): void {
		const rect = this.overviewEl.getBoundingClientRect();
		if (rect.width === 0) return;
		const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		const visible = Math.max(0, this.stage.clientWidth - this.labelWidth);
		this.stage.scrollLeft = f * this.range.days * this.px - visible / 2;
	}
}
