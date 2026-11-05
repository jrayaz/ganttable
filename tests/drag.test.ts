import { afterEach, describe, expect, it, vi } from "vitest";
import { ChartState, GanttChart } from "../src/chart";
import { buildProject } from "../src/model";
import { findTables } from "../src/parser";
import { parseDate } from "../src/dates";

const d = (s: string): number => parseDate(s) as number;
const today = d("2026-11-05");

const TABLE = [
	"| WBS | Task | Start | End | Done |",
	"| - | - | - | - | - |",
	"| 1 | Phase | | | |",
	"| 1.1 | Survey | 2026-10-05 | 2026-10-23 | 100% |",
	"| 1.2 | Build | 2026-10-19 | 2026-11-20 | 70% |",
	"| 1.3 | ◆ Sign-off | 2026-11-27 | | |",
].join("\n");
const project = buildProject(findTables(TABLE)[0], today);

function state(over: Partial<ChartState> = {}): ChartState {
	return {
		zoom: "week",
		colorBy: "status",
		rowHeight: "normal",
		collapsed: new Set<string>(),
		selected: null,
		today,
		showToday: true,
		shadeWeekends: true,
		showLinks: true,
		showBaseline: true,
		critical: null,
		paper: false,
		title: "Plan",
		editable: true,
		labelWidth: 468,
		...over,
	};
}

interface Mounted {
	host: HTMLElement;
	edits: { wbs: string; mode: string; delta: number }[];
	picked: (string | null)[];
	ends: number;
	widths: number[];
	chart: GanttChart;
}

function mount(over: Partial<ChartState> = {}): Mounted {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const m = { host, edits: [], picked: [], ends: 0, widths: [] } as unknown as Mounted;
	m.chart = new GanttChart(host, {
		onSelect: (w) => m.picked.push(w),
		onToggle: () => undefined,
		onEdit: (wbs, mode, delta) => m.edits.push({ wbs, mode, delta }),
		onDragEnd: () => {
			m.ends++;
		},
		onLabelWidth: (w) => m.widths.push(w),
	});
	m.chart.render(project, state(over), false);
	return m;
}

function pointer(el: Element, type: string, clientX: number, extra: PointerEventInit = {}): void {
	el.dispatchEvent(
		new PointerEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 10, pointerId: 1, pointerType: "mouse", button: 0, ...extra })
	);
}

const PX = 8; // week zoom is 8 pixels per day

afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = "";
});

describe("dragging a bar", () => {
	it("moves a task by whole days", () => {
		const m = mount();
		const bar = m.host.querySelectorAll(".gt-bar")[1];
		pointer(bar, "pointerdown", 100);
		pointer(bar, "pointermove", 100 + PX * 3 + 2);
		pointer(bar, "pointerup", 100 + PX * 3 + 2);
		expect(m.edits).toEqual([{ wbs: "1.2", mode: "move", delta: 3 }]);
	});

	it("moves earlier with a negative number of days", () => {
		const m = mount();
		const bar = m.host.querySelectorAll(".gt-bar")[1];
		pointer(bar, "pointerdown", 300);
		pointer(bar, "pointermove", 300 - PX * 2);
		pointer(bar, "pointerup", 300 - PX * 2);
		expect(m.edits).toEqual([{ wbs: "1.2", mode: "move", delta: -2 }]);
	});

	it("shows the new dates in a tooltip while dragging and removes it afterwards", () => {
		const m = mount();
		const bar = m.host.querySelectorAll(".gt-bar")[1];
		pointer(bar, "pointerdown", 100);
		pointer(bar, "pointermove", 100 + PX * 2);
		expect(m.host.querySelector(".gt-tip")?.textContent).toContain("+2d");
		expect(m.chart.isDragging).toBe(true);
		pointer(bar, "pointerup", 100 + PX * 2);
		expect(m.host.querySelector(".gt-tip")).toBeNull();
		expect(m.chart.isDragging).toBe(false);
		expect(m.ends).toBe(1);
	});

	it("ignores a movement of less than half a day", () => {
		const m = mount();
		const bar = m.host.querySelectorAll(".gt-bar")[1];
		pointer(bar, "pointerdown", 100);
		pointer(bar, "pointermove", 103);
		pointer(bar, "pointerup", 103);
		expect(m.edits).toEqual([]);
	});

	it("treats a press with no movement as a click that selects the task", () => {
		const m = mount();
		const bar = m.host.querySelectorAll(".gt-bar")[1];
		pointer(bar, "pointerdown", 100);
		pointer(bar, "pointerup", 100);
		(bar as HTMLElement).click();
		expect(m.picked).toEqual(["1.2"]);
		expect(m.edits).toEqual([]);
	});

	it("does not select the task when the click comes at the end of a real drag", () => {
		const m = mount();
		const bar = m.host.querySelectorAll(".gt-bar")[1];
		pointer(bar, "pointerdown", 100);
		pointer(bar, "pointermove", 100 + PX * 2);
		pointer(bar, "pointerup", 100 + PX * 2);
		(bar as HTMLElement).click();
		expect(m.picked).toEqual([]);
	});

	it("cancels with Escape and reports nothing", () => {
		const m = mount();
		const bar = m.host.querySelectorAll(".gt-bar")[1];
		pointer(bar, "pointerdown", 100);
		pointer(bar, "pointermove", 100 + PX * 4);
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		pointer(bar, "pointerup", 100 + PX * 4);
		expect(m.edits).toEqual([]);
		expect(m.chart.isDragging).toBe(false);
	});

	it("cancels when the browser cancels the pointer", () => {
		const m = mount();
		const bar = m.host.querySelectorAll(".gt-bar")[1];
		pointer(bar, "pointerdown", 100);
		pointer(bar, "pointermove", 100 + PX * 4);
		pointer(bar, "pointercancel", 100 + PX * 4);
		expect(m.edits).toEqual([]);
	});

	it("puts the bar back where it was after a cancelled drag", () => {
		const m = mount();
		const bar = m.host.querySelectorAll(".gt-bar")[1] as HTMLElement;
		const before = bar.style.getPropertyValue("--gt-l");
		pointer(bar, "pointerdown", 100);
		pointer(bar, "pointermove", 100 + PX * 4);
		expect(bar.style.getPropertyValue("--gt-l")).toBe(`${parseFloat(before) + PX * 4}px`); // the bar follows the pointer
		pointer(bar, "pointercancel", 100);
		expect(bar.style.getPropertyValue("--gt-l")).toBe(before);
	});
});

describe("resizing", () => {
	it("drags the right edge to change the end", () => {
		const m = mount();
		const handle = m.host.querySelectorAll(".gt-bar")[1].querySelector(".gt-h-r") as HTMLElement;
		pointer(handle, "pointerdown", 500);
		pointer(handle, "pointermove", 500 + PX * 2);
		pointer(handle, "pointerup", 500 + PX * 2);
		expect(m.edits).toEqual([{ wbs: "1.2", mode: "end", delta: 2 }]);
	});

	it("drags the left edge to change the start", () => {
		const m = mount();
		const handle = m.host.querySelectorAll(".gt-bar")[1].querySelector(".gt-h-l") as HTMLElement;
		pointer(handle, "pointerdown", 300);
		pointer(handle, "pointermove", 300 + PX);
		pointer(handle, "pointerup", 300 + PX);
		expect(m.edits).toEqual([{ wbs: "1.2", mode: "start", delta: 1 }]);
	});

	it("does not let the start pass the end or the end pass the start", () => {
		const m = mount();
		const bar = m.host.querySelectorAll(".gt-bar")[1]; // Oct 19 to Nov 20, 32 days long
		const left = bar.querySelector(".gt-h-l") as HTMLElement;
		pointer(left, "pointerdown", 0);
		pointer(left, "pointermove", PX * 500);
		pointer(left, "pointerup", PX * 500);
		const right = bar.querySelector(".gt-h-r") as HTMLElement;
		pointer(right, "pointerdown", 1000);
		pointer(right, "pointermove", 1000 - PX * 500);
		pointer(right, "pointerup", 1000 - PX * 500);
		expect(m.edits).toEqual([
			{ wbs: "1.2", mode: "start", delta: 32 },
			{ wbs: "1.2", mode: "end", delta: -32 },
		]);
	});

	it("does not also move the whole bar when an edge is dragged", () => {
		const m = mount();
		const handle = m.host.querySelectorAll(".gt-bar")[1].querySelector(".gt-h-r") as HTMLElement;
		pointer(handle, "pointerdown", 500);
		pointer(handle, "pointermove", 500 + PX);
		pointer(handle, "pointerup", 500 + PX);
		expect(m.edits).toHaveLength(1);
	});
});

describe("milestones and summary rows", () => {
	it("moves a milestone", () => {
		const m = mount();
		const ms = m.host.querySelector(".gt-ms") as HTMLElement;
		pointer(ms, "pointerdown", 100);
		pointer(ms, "pointermove", 100 + PX * 5);
		pointer(ms, "pointerup", 100 + PX * 5);
		expect(m.edits).toEqual([{ wbs: "1.3", mode: "move", delta: 5 }]);
	});

	it("moves a whole summary row", () => {
		const m = mount();
		const sum = m.host.querySelector(".gt-sum") as HTMLElement;
		pointer(sum, "pointerdown", 100);
		pointer(sum, "pointermove", 100 + PX * 7);
		pointer(sum, "pointerup", 100 + PX * 7);
		expect(m.edits).toEqual([{ wbs: "1", mode: "move", delta: 7 }]);
	});
});

describe("a read-only chart", () => {
	it("has no edge handles and ignores dragging", () => {
		const m = mount({ editable: false });
		expect(m.host.querySelectorAll(".gt-h")).toHaveLength(0);
		const bar = m.host.querySelectorAll(".gt-bar")[1];
		pointer(bar, "pointerdown", 100);
		pointer(bar, "pointermove", 100 + PX * 3);
		pointer(bar, "pointerup", 100 + PX * 3);
		expect(m.edits).toEqual([]);
		expect(m.host.querySelector(".gt-chart")?.classList.contains("gt-editable")).toBe(false);
	});
});

describe("touch", () => {
	it("needs a short hold before a finger starts a drag", () => {
		vi.useFakeTimers();
		const m = mount();
		const bar = m.host.querySelectorAll(".gt-bar")[1];
		pointer(bar, "pointerdown", 100, { pointerType: "touch" });
		vi.advanceTimersByTime(400);
		pointer(bar, "pointermove", 100 + PX * 3, { pointerType: "touch" });
		pointer(bar, "pointerup", 100 + PX * 3, { pointerType: "touch" });
		expect(m.edits).toEqual([{ wbs: "1.2", mode: "move", delta: 3 }]);
	});

	it("leaves a quick swipe to scroll the chart instead", () => {
		vi.useFakeTimers();
		const m = mount();
		const bar = m.host.querySelectorAll(".gt-bar")[1];
		pointer(bar, "pointerdown", 100, { pointerType: "touch" });
		pointer(bar, "pointermove", 100 + PX * 3, { pointerType: "touch" });
		vi.advanceTimersByTime(400);
		pointer(bar, "pointerup", 100 + PX * 3, { pointerType: "touch" });
		expect(m.edits).toEqual([]);
		expect(m.chart.isDragging).toBe(false);
	});
});

describe("a drag that loses its pointer capture", () => {
	it("still finishes when the button is released somewhere else", () => {
		const m = mount();
		const handle = m.host.querySelectorAll(".gt-bar")[1].querySelector(".gt-h-r") as HTMLElement;
		pointer(handle, "pointerdown", 500);
		pointer(handle, "pointermove", 500 + PX * 2);
		// The release lands on the chart background instead of the handle.
		pointer(m.host.querySelector(".gt-stage") as HTMLElement, "pointerup", 500 + PX * 2);
		expect(m.edits).toEqual([{ wbs: "1.2", mode: "end", delta: 2 }]);
		expect(m.chart.isDragging).toBe(false);
	});

	it("ignores events from a different pointer", () => {
		const m = mount();
		const bar = m.host.querySelectorAll(".gt-bar")[1];
		pointer(bar, "pointerdown", 100, { pointerId: 1 });
		pointer(bar, "pointermove", 100 + PX * 3, { pointerId: 2 });
		pointer(bar, "pointerup", 100 + PX * 3, { pointerId: 2 });
		expect(m.edits).toEqual([]);
		expect(m.chart.isDragging).toBe(true);
		pointer(bar, "pointerup", 100, { pointerId: 1 });
		expect(m.chart.isDragging).toBe(false);
	});
});

describe("the drag tooltip", () => {
	it("sits inside the chart and flips to the left of the pointer near the right edge", () => {
		const m = mount();
		const bar = m.host.querySelectorAll(".gt-bar")[1];
		pointer(bar, "pointerdown", 100);
		pointer(bar, "pointermove", 100 + PX * 2);
		const tip = m.host.querySelector(".gt-tip") as HTMLElement;
		expect(tip.parentElement?.classList.contains("gt-chart")).toBe(true);
		expect(tip.style.getPropertyValue("--gt-x")).toBe(`${100 + PX * 2}px`);
		pointer(bar, "pointerup", 100 + PX * 2);
	});
});
