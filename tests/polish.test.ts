import { afterEach, describe, expect, it } from "vitest";
import { ChartState, GanttChart, ownerBadges } from "../src/chart";
import { buildProject } from "../src/model";
import { findTables } from "../src/parser";
import { parseDate } from "../src/dates";

const d = (s: string): number => parseDate(s) as number;
const today = d("2026-11-05");

function build(rows: string[]) {
	const text = ["| WBS | Task | Start | End | Area |", "| - | - | - | - | - |", ...rows].join("\n");
	return buildProject(findTables(text)[0], today);
}

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
		editable: false,
		labelWidth: 468,
		...over,
	};
}

function mount(): { host: HTMLElement; chart: GanttChart; widths: number[] } {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const widths: number[] = [];
	const chart = new GanttChart(host, {
		onSelect: () => undefined,
		onToggle: () => undefined,
		onEdit: () => undefined,
		onDragEnd: () => undefined,
		onLabelWidth: (w) => widths.push(w),
	});
	return { host, chart, widths };
}

function pointer(el: Element, type: string, clientX: number): void {
	el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 5, pointerId: 1, pointerType: "mouse", button: 0 }));
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("owner badges", () => {
	it("gives names that share initials different badges", () => {
		const p = build([
			"| 1 | A | 2026-11-02 | 2026-11-03 | Hardware |",
			"| 2 | B | 2026-11-02 | 2026-11-03 | Habit |",
			"| 3 | C | 2026-11-02 | 2026-11-03 | Firmware |",
			"| 4 | D | 2026-11-02 | 2026-11-03 | Career |",
			"| 5 | E | 2026-11-02 | 2026-11-03 | Plan |",
		]);
		const badges = ownerBadges(p);
		expect(badges.get("Hardware")).toBe("HA");
		expect(badges.get("Habit")).toBe("HAB");
		expect(new Set(badges.values()).size).toBe(5);
	});

	it("uses first and last initials for a full name", () => {
		const p = build(["| 1 | A | 2026-11-02 | 2026-11-03 | Mei Lin |"]);
		expect(ownerBadges(p).get("Mei Lin")).toBe("ML");
	});

	it("shows the unique badge in the chart", () => {
		const p = build([
			"| 1 | A | 2026-11-02 | 2026-11-03 | Hardware |",
			"| 2 | B | 2026-11-02 | 2026-11-03 | Habit |",
		]);
		const { host, chart } = mount();
		chart.render(p, state(), false);
		expect(Array.from(host.querySelectorAll(".gt-av")).map((e) => e.textContent)).toEqual(["HA", "HAB"]);
	});
});

describe("milestone labels near the end of the timeline", () => {
	it("flips to the left of the diamond when there is no room on the right", () => {
		const p = build([
			"| 1 | Early work | 2026-11-02 | 2026-11-13 | A |",
			"| 2 | ◆ A milestone with a rather long name on the last day | 2026-11-13 | | A |",
			"| 3 | ◆ Early gate | 2026-11-03 | | A |",
		]);
		const { host, chart } = mount();
		chart.render(p, state({ zoom: "week" }), false);
		const labels = Array.from(host.querySelectorAll(".gt-after")).filter((e) => e.querySelector(".gt-mn"));
		const byText = (needle: string) => labels.find((e) => e.textContent?.includes(needle));
		expect(byText("Early gate")?.classList.contains("gt-flip")).toBe(false);
		expect(labels.some((e) => e.classList.contains("gt-flip"))).toBe(true);
	});
});

describe("resizing the task column", () => {
	it("follows the pointer while dragging and reports the final width once", () => {
		const p = build(["| 1 | A | 2026-11-02 | 2026-11-03 | A |"]);
		const { host, chart, widths } = mount();
		chart.render(p, state(), false);
		const handle = host.querySelector(".gt-resizer") as HTMLElement;
		pointer(handle, "pointerdown", 400);
		pointer(handle, "pointermove", 460);
		expect((host.querySelector(".gt-chart") as HTMLElement).style.getPropertyValue("--gt-lw")).toBe("528px");
		pointer(handle, "pointerup", 460);
		expect(widths).toEqual([528]);
	});

	it("keeps the width between 280 and 720 pixels", () => {
		const p = build(["| 1 | A | 2026-11-02 | 2026-11-03 | A |"]);
		const { host, chart, widths } = mount();
		chart.render(p, state(), false);
		const handle = host.querySelector(".gt-resizer") as HTMLElement;
		pointer(handle, "pointerdown", 400);
		pointer(handle, "pointermove", 4000);
		pointer(handle, "pointerup", 4000);
		pointer(handle, "pointerdown", 400);
		pointer(handle, "pointermove", -4000);
		pointer(handle, "pointerup", -4000);
		expect(widths).toEqual([720, 280]);
	});

	it("does not report a width when the handle was only clicked", () => {
		const p = build(["| 1 | A | 2026-11-02 | 2026-11-03 | A |"]);
		const { host, chart, widths } = mount();
		chart.render(p, state(), false);
		const handle = host.querySelector(".gt-resizer") as HTMLElement;
		pointer(handle, "pointerdown", 400);
		pointer(handle, "pointerup", 400);
		expect(widths).toEqual([]);
	});

	it("has no resize handle in the narrow layout", () => {
		const p = build(["| 1 | A | 2026-11-02 | 2026-11-03 | A |"]);
		const { host, chart } = mount();
		chart.render(p, state(), true);
		expect(host.querySelector(".gt-resizer")).toBeNull();
	});

	it("uses the saved width for the task column", () => {
		const p = build(["| 1 | A | 2026-11-02 | 2026-11-03 | A |"]);
		const { host, chart } = mount();
		chart.render(p, state({ labelWidth: 600 }), false);
		expect((host.querySelector(".gt-chart") as HTMLElement).style.getPropertyValue("--gt-lw")).toBe("600px");
	});
});

describe("touch screens", () => {
	const original = window.matchMedia;
	afterEach(() => {
		window.matchMedia = original;
	});

	it("keeps rows and bars big enough for a finger", () => {
		window.matchMedia = ((query: string) => ({ matches: query.includes("coarse"), media: query }) as MediaQueryList) as typeof window.matchMedia;
		const p = build(["| 1 | A | 2026-11-02 | 2026-11-03 | A |"]);
		const { host, chart } = mount();
		chart.render(p, state({ rowHeight: "compact" }), false);
		const root = host.querySelector(".gt-chart") as HTMLElement;
		expect(parseInt(root.style.getPropertyValue("--gt-rh"))).toBeGreaterThanOrEqual(36);
		expect(parseInt(root.style.getPropertyValue("--gt-bh"))).toBeGreaterThanOrEqual(20);
	});

	it("leaves the chosen row height alone with a mouse", () => {
		window.matchMedia = ((query: string) => ({ matches: false, media: query }) as MediaQueryList) as typeof window.matchMedia;
		const p = build(["| 1 | A | 2026-11-02 | 2026-11-03 | A |"]);
		const { host, chart } = mount();
		chart.render(p, state({ rowHeight: "compact" }), false);
		expect((host.querySelector(".gt-chart") as HTMLElement).style.getPropertyValue("--gt-rh")).toBe("26px");
	});
});
