import { afterEach, describe, expect, it } from "vitest";
import { ChartState, GanttChart } from "../src/chart";
import { buildProject } from "../src/model";
import { findTables } from "../src/parser";
import { parseDate } from "../src/dates";

const d = (s: string): number => parseDate(s) as number;
const today = d("2026-11-05");

const TABLE = [
	"| WBS | Task | Start | End | Done | After |",
	"| - | - | - | - | - | - |",
	"| 1 | Survey | 2026-10-05 | 2026-10-23 | 100% | |",
	"| 2 | Build | 2026-10-19 | 2026-11-20 | 70% | 1 |",
	"| 3 | ◆ Sign-off | 2026-11-27 | | | 2 |",
	"| 4 | Tiny | 2026-11-02 | 2026-11-02 | 0% | |",
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

function mount(over: Partial<ChartState> = {}, p = project) {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const edits: { wbs: string; mode: string; delta: number }[] = [];
	const picked: (string | null)[] = [];
	const chart = new GanttChart(host, {
		onSelect: (w) => picked.push(w),
		onToggle: () => undefined,
		onEdit: (wbs, mode, delta) => edits.push({ wbs, mode, delta }),
		onDragEnd: () => undefined,
		onLabelWidth: () => undefined,
	});
	chart.render(p, state(over), false);
	return { host, chart, edits, picked };
}

function pointer(el: Element, type: string, clientX: number): void {
	el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 5, pointerId: 1, pointerType: "mouse", button: 0 }));
}

function key(el: Element, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
	const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
	el.dispatchEvent(ev);
	return ev;
}

afterEach(() => {
	document.body.innerHTML = "";
});

const PX = 8;
const BUILD_WIDTH = 33 * PX; // Build runs 33 days at 8 pixels a day

describe("dragging progress", () => {
	it("gives wide bars a progress grip and narrow ones none", () => {
		const { host } = mount();
		const grips = host.querySelectorAll(".gt-pg");
		// Survey and Build are wide enough, the one-day task is not.
		expect(grips).toHaveLength(2);
	});

	it("sets progress in steps of five percent across the width of the bar", () => {
		const { host, edits } = mount();
		const grip = host.querySelectorAll(".gt-bar")[1].querySelector(".gt-pg") as HTMLElement;
		pointer(grip, "pointerdown", 300);
		pointer(grip, "pointermove", 300 + BUILD_WIDTH * 0.1);
		pointer(grip, "pointerup", 300 + BUILD_WIDTH * 0.1);
		expect(edits).toEqual([{ wbs: "2", mode: "progress", delta: 10 }]);
	});

	it("can lower progress", () => {
		const { host, edits } = mount();
		const grip = host.querySelectorAll(".gt-bar")[1].querySelector(".gt-pg") as HTMLElement;
		pointer(grip, "pointerdown", 300);
		pointer(grip, "pointermove", 300 - BUILD_WIDTH * 0.25);
		pointer(grip, "pointerup", 300 - BUILD_WIDTH * 0.25);
		expect(edits).toEqual([{ wbs: "2", mode: "progress", delta: -25 }]);
	});

	it("stops at 0 and at 100", () => {
		const { host, edits } = mount();
		const grip = host.querySelectorAll(".gt-bar")[1].querySelector(".gt-pg") as HTMLElement;
		pointer(grip, "pointerdown", 300);
		pointer(grip, "pointermove", 300 + 5000);
		pointer(grip, "pointerup", 300 + 5000);
		pointer(grip, "pointerdown", 300);
		pointer(grip, "pointermove", 300 - 5000);
		pointer(grip, "pointerup", 300 - 5000);
		expect(edits).toEqual([
			{ wbs: "2", mode: "progress", delta: 30 },
			{ wbs: "2", mode: "progress", delta: -70 },
		]);
	});

	it("shows the new percentage while dragging and the bar fills to match", () => {
		const { host } = mount();
		const bar = host.querySelectorAll(".gt-bar")[1] as HTMLElement;
		const grip = bar.querySelector(".gt-pg") as HTMLElement;
		pointer(grip, "pointerdown", 300);
		pointer(grip, "pointermove", 300 + BUILD_WIDTH * 0.1);
		expect(host.querySelector(".gt-tip")?.textContent).toContain("Done 80%");
		expect(bar.style.getPropertyValue("--gt-d")).toBe("80%");
		pointer(grip, "pointercancel", 0);
		expect(bar.style.getPropertyValue("--gt-d")).toBe("70%");
	});

	it("does not move the bar or change its dates", () => {
		const { host, edits } = mount();
		const grip = host.querySelectorAll(".gt-bar")[1].querySelector(".gt-pg") as HTMLElement;
		pointer(grip, "pointerdown", 300);
		pointer(grip, "pointermove", 300 + BUILD_WIDTH * 0.2);
		pointer(grip, "pointerup", 300 + BUILD_WIDTH * 0.2);
		expect(edits.every((e) => e.mode === "progress")).toBe(true);
	});

	it("has no grip when the chart is read-only", () => {
		const { host } = mount({ editable: false });
		expect(host.querySelectorAll(".gt-pg")).toHaveLength(0);
	});
});

describe("keyboard editing", () => {
	it("moves a focused bar by a day with the arrow keys and by a week with Shift", () => {
		const { host, edits } = mount();
		const bar = host.querySelectorAll(".gt-bar")[1];
		key(bar, "ArrowRight");
		key(bar, "ArrowLeft");
		key(bar, "ArrowRight", { shiftKey: true });
		key(bar, "ArrowLeft", { shiftKey: true });
		expect(edits.map((e) => e.delta)).toEqual([1, -1, 7, -7]);
		expect(edits.every((e) => e.mode === "move" && e.wbs === "2")).toBe(true);
	});

	it("changes the end with Ctrl or Cmd and an arrow key", () => {
		const { host, edits } = mount();
		const bar = host.querySelectorAll(".gt-bar")[1];
		key(bar, "ArrowRight", { ctrlKey: true });
		key(bar, "ArrowLeft", { metaKey: true });
		expect(edits).toEqual([
			{ wbs: "2", mode: "end", delta: 1 },
			{ wbs: "2", mode: "end", delta: -1 },
		]);
	});

	it("only moves a milestone, even with Ctrl held", () => {
		const { host, edits } = mount();
		const ms = host.querySelector(".gt-ms") as HTMLElement;
		key(ms, "ArrowRight", { ctrlKey: true });
		expect(edits).toEqual([{ wbs: "3", mode: "move", delta: 1 }]);
	});

	it("does nothing with the arrow keys when the chart is read-only", () => {
		const { host, edits } = mount({ editable: false });
		const bar = host.querySelectorAll(".gt-bar")[1];
		const ev = key(bar, "ArrowRight");
		expect(edits).toEqual([]);
		expect(ev.defaultPrevented).toBe(false);
	});

	it("still selects with Enter", () => {
		const { host, picked } = mount();
		key(host.querySelectorAll(".gt-bar")[1], "Enter");
		expect(picked).toEqual(["2"]);
	});
});

describe("schedule conflicts in the chart", () => {
	const clash = buildProject(
		findTables(
			[
				"| WBS | Task | Start | End | After |",
				"| - | - | - | - | - |",
				"| 1 | First | 2026-11-02 | 2026-11-10 | |",
				"| 2 | Too early | 2026-11-08 | 2026-11-12 | 1 |",
				"| 3 | Fine | 2026-11-11 | 2026-11-13 | 1 |",
			].join("\n")
		)[0],
		today
	);

	it("outlines a task that starts early and draws its link as a dashed red line", () => {
		const { host } = mount({}, clash);
		const bars = host.querySelectorAll(".gt-bar");
		expect(bars[1].classList.contains("gt-clash")).toBe(true);
		expect(bars[2].classList.contains("gt-clash")).toBe(false);
		expect(host.querySelectorAll(".gt-link-clash")).toHaveLength(1);
		expect(host.querySelectorAll(".gt-arrow-clash")).toHaveLength(1);
	});

	it("marks the row of a task that starts early", () => {
		const { host } = mount({}, clash);
		const rows = host.querySelectorAll(".gt-row.gt-conflict");
		expect(rows).toHaveLength(1);
		expect(rows[0].textContent).toContain("Too early");
	});

	it("draws no warnings for a clean schedule", () => {
		const clean = buildProject(
			findTables(
				[
					"| WBS | Task | Start | End | After |",
					"| - | - | - | - | - |",
					"| 1 | First | 2026-11-02 | 2026-11-10 | |",
					"| 2 | Next | 2026-11-11 | 2026-11-12 | 1 |",
					"| 3 | ◆ Gate | 2026-11-12 | | 2 |",
				].join("\n")
			)[0],
			today
		);
		const { host } = mount({}, clean);
		expect(host.querySelectorAll(".gt-clash, .gt-link-clash, .gt-conflict")).toHaveLength(0);
	});
});
