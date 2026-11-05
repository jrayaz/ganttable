import { describe, expect, it } from "vitest";
import { ChartState, GanttChart, colorFor, computeRange, initials, linkPath, pixelsPerDay, rowHeightFor, traceChain } from "../src/chart";
import { buildProject, criticalPath, regroupByOwner } from "../src/model";
import { buildSvg } from "../src/export";
import { findTables } from "../src/parser";
import { parseDate, startOfWeek } from "../src/dates";

const d = (s: string): number => parseDate(s) as number;

const TABLE = [
	"| WBS | Task | Start | End | Done | After | Owner | Baseline |",
	"| - | - | - | - | - | - | - | - |",
	"| 1 | Phase one | | | | | | |",
	"| 1.1 | Survey | 2026-10-05 | 2026-10-23 | 100% | | Joshuva Mei | |",
	"| 1.2 | Build | 2026-10-19 | 2026-11-20 | 70% | 1.1 | Mei | 2026-11-13 |",
	"| 1.3 | ◆ Sign-off | 2026-11-27 | | | 1.2 | Joshuva | |",
	"| 2 | Phase two | 2026-12-01 | 2026-12-18 | | | Dale | |",
].join("\n");

const today = d("2026-11-05");
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
		title: "Hotel plan",
		editable: false,
		labelWidth: 468,
		...over,
	};
}

function mount(): { host: HTMLElement; chart: GanttChart; picked: (string | null)[]; toggled: string[]; edits: { wbs: string; mode: string; delta: number }[] } {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const picked: (string | null)[] = [];
	const toggled: string[] = [];
	const edits: { wbs: string; mode: string; delta: number }[] = [];
	const chart = new GanttChart(host, {
		onSelect: (w) => picked.push(w),
		onToggle: (w) => toggled.push(w),
		onEdit: (wbs, mode, delta) => edits.push({ wbs, mode, delta }),
		onDragEnd: () => undefined,
		onLabelWidth: () => undefined,
	});
	return { host, chart, picked, toggled, edits };
}

describe("timeline range", () => {
	it("starts on the Monday of the first week and covers whole weeks", () => {
		const r = computeRange(project);
		expect(r.start).toBe(startOfWeek(project.start));
		expect(r.days % 7).toBe(0);
		expect(r.start + r.days).toBeGreaterThan(project.end + 13);
	});

	it("uses fixed pixels for day, week and month and fills the width for fit", () => {
		expect(pixelsPerDay("day", 1000, 100)).toBe(24);
		expect(pixelsPerDay("week", 1000, 100)).toBe(8);
		expect(pixelsPerDay("month", 1000, 100)).toBe(2.6);
		expect(pixelsPerDay("fit", 1000, 100)).toBe(10);
		expect(pixelsPerDay("fit", 0, 100)).toBe(2);
	});
});

describe("colour and initials", () => {
	it("colours by status, owner and phase", () => {
		const build = project.byWbs.get("1.2");
		const phaseTwo = project.byWbs.get("2");
		if (!build || !phaseTwo) throw new Error("fixture missing");
		expect(colorFor(project, build, "status")).toBe("--color-orange"); // slipping past its baseline
		expect(colorFor(project, build, "owner")).not.toBe(colorFor(project, phaseTwo, "owner"));
		expect(colorFor(project, build, "phase")).not.toBe(colorFor(project, phaseTwo, "phase"));
	});

	it("makes initials from one or more words", () => {
		expect(initials("Joshuva")).toBe("JO");
		expect(initials("Mei Lin")).toBe("ML");
		expect(initials("")).toBe("");
	});
});

describe("GanttChart.render", () => {
	it("draws a row per task and the right kind of mark for each", () => {
		const { host, chart } = mount();
		chart.render(project, state(), false);
		expect(host.querySelectorAll(".gt-row")).toHaveLength(5);
		expect(host.querySelectorAll(".gt-bar")).toHaveLength(3);
		expect(host.querySelectorAll(".gt-ms")).toHaveLength(1);
		expect(host.querySelectorAll(".gt-sum")).toHaveLength(1);
	});

	it("draws the today line and header pill when today is in range", () => {
		const { host, chart } = mount();
		chart.render(project, state(), false);
		expect(host.querySelector(".gt-today")).not.toBeNull();
		expect(host.querySelector(".gt-pill-today")).not.toBeNull();
		chart.render(project, state({ showToday: false }), false);
		expect(host.querySelector(".gt-today")).toBeNull();
	});

	it("hides children of a collapsed row", () => {
		const { host, chart } = mount();
		chart.render(project, state({ collapsed: new Set(["1"]) }), false);
		expect(host.querySelectorAll(".gt-row")).toHaveLength(2);
	});

	it("shows a slip chip when a task finishes after its baseline", () => {
		const { host, chart } = mount();
		chart.render(project, state(), false);
		expect(host.querySelector(".gt-slip")?.textContent).toBe("+7d");
	});

	it("marks the selected row and bar", () => {
		const { host, chart } = mount();
		chart.render(project, state({ selected: "1.2" }), false);
		expect(host.querySelectorAll(".gt-sel")).toHaveLength(2);
	});

	it("reports clicks and chevron toggles through the callbacks", () => {
		const { host, chart, picked, toggled } = mount();
		chart.render(project, state(), false);
		(host.querySelectorAll(".gt-task")[0] as HTMLElement).click();
		expect(picked).toEqual(["1.1"]);
		(host.querySelector(".gt-chev") as HTMLElement).click();
		expect(toggled).toEqual(["1"]);
		expect(picked).toEqual(["1.1"]);
	});

	it("re-renders cleanly without leaving old rows behind", () => {
		const { host, chart } = mount();
		chart.render(project, state(), false);
		chart.render(project, state({ zoom: "day" }), true);
		expect(host.querySelectorAll(".gt-row")).toHaveLength(5);
		expect(host.querySelector(".gt-chart")?.classList.contains("gt-narrow")).toBe(true);
	});

	it("uses day-level header cells when zoomed in", () => {
		const { host, chart } = mount();
		chart.render(project, state({ zoom: "day" }), false);
		const range = computeRange(project);
		expect(host.querySelectorAll(".gt-t2")).toHaveLength(range.days);
	});
});

describe("links, baseline, critical path and trace", () => {
	it("draws one arrow per valid predecessor", () => {
		const { host, chart } = mount();
		chart.render(project, state(), false);
		// 1.1 -> 1.2 and 1.2 -> 1.3
		expect(host.querySelectorAll(".gt-link")).toHaveLength(2);
		expect(host.querySelectorAll(".gt-arrow")).toHaveLength(2);
	});

	it("leaves out arrows when links are off", () => {
		const { host, chart } = mount();
		chart.render(project, state({ showLinks: false }), false);
		expect(host.querySelectorAll(".gt-link")).toHaveLength(0);
	});

	it("draws a baseline line only for tasks that moved, and hides it when off", () => {
		const { host, chart } = mount();
		chart.render(project, state(), false);
		expect(host.querySelectorAll(".gt-base")).toHaveLength(1);
		chart.render(project, state({ showBaseline: false }), false);
		expect(host.querySelectorAll(".gt-base")).toHaveLength(0);
		expect(host.querySelector(".gt-slip")).toBeNull();
	});

	it("outlines critical tasks and links", () => {
		const rows = [
			"| WBS | Task | Start | End | After |",
			"| - | - | - | - | - |",
			"| 1 | A | 2026-11-02 | 2026-11-06 | |",
			"| 2 | B | 2026-11-09 | 2026-11-13 | 1 |",
			"| 3 | C | 2026-11-16 | 2026-11-20 | 2 |",
			"| 4 | Side job | 2026-11-02 | 2026-11-04 | |",
		].join("\n");
		const chain = buildProject(findTables(rows)[0], today);
		const critical = criticalPath(chain);
		expect([...critical].sort()).toEqual(["1", "2", "3"]);
		const { host, chart } = mount();
		chart.render(chain, state({ critical }), false);
		expect(host.querySelectorAll(".gt-bar.gt-crit")).toHaveLength(3);
		expect(host.querySelectorAll(".gt-link-crit")).toHaveLength(2);
	});

	it("dims rows outside the selected task's chain", () => {
		const { host, chart } = mount();
		chart.render(project, state({ selected: "1.2" }), false);
		const dimmed = Array.from(host.querySelectorAll(".gt-row.gt-dim")).map((r) => r.textContent);
		expect(dimmed).toHaveLength(1);
		expect(dimmed[0]).toContain("Phase two");
	});

	it("does not dim anything when the selected task has no links", () => {
		const { host, chart } = mount();
		chart.render(project, state({ selected: "2" }), false);
		expect(host.querySelectorAll(".gt-row.gt-dim")).toHaveLength(0);
	});

	it("finds the chain in both directions", () => {
		expect([...traceChain(project, "1.2")].sort()).toEqual(["1.1", "1.2", "1.3"]);
		expect([...traceChain(project, "2")]).toEqual(["2"]);
	});

	it("steps a link around when the successor starts before the predecessor ends", () => {
		expect(linkPath(100, 10, 140, 50, 32)).toBe("M100 10H106V50H140");
		expect(linkPath(100, 10, 90, 50, 32)).toBe("M100 10H106V34H84V50H90");
	});
});

describe("print preview", () => {
	it("switches to the light sheet and fills the width", () => {
		const { host, chart } = mount();
		chart.render(project, state({ paper: true }), false);
		const sheet = host.querySelector(".gt-sheet");
		expect(sheet?.classList.contains("gt-paper-sheet")).toBe(true);
		expect(sheet?.classList.contains("theme-light")).toBe(true);
		expect(host.querySelector(".gt-titleblock h2")?.textContent).toBe("Hotel plan");
		expect(host.querySelectorAll(".gt-sheetfoot .gt-legend span").length).toBeGreaterThan(0);
	});

	it("hides the overview strip when asked", () => {
		const { host, chart } = mount();
		chart.render(project, state(), false);
		chart.setOverviewVisible(false);
		expect(host.querySelector(".gt-over")?.classList.contains("gt-hidden")).toBe(true);
		chart.setOverviewVisible(true);
		expect(host.querySelector(".gt-over")?.classList.contains("gt-hidden")).toBe(false);
	});
});

describe("group by owner", () => {
	const grouped = regroupByOwner(project);

	it("makes one summary row per owner with their tasks beneath", () => {
		const groups = grouped.tasks.filter((t) => t.summary);
		expect(groups.map((g) => g.name)).toEqual(["Joshuva Mei", "Mei", "Joshuva", "Dale"]);
		expect(grouped.tasks.filter((t) => !t.summary)).toHaveLength(project.tasks.filter((t) => !t.summary).length);
	});

	it("keeps WBS numbers on tasks so links still resolve", () => {
		const { host, chart } = mount();
		chart.render(grouped, state(), false);
		expect(host.querySelectorAll(".gt-link")).toHaveLength(2);
		expect(host.querySelectorAll(".gt-row")).toHaveLength(grouped.tasks.length);
	});

	it("does not show group keys as WBS numbers", () => {
		const { host, chart } = mount();
		chart.render(grouped, state(), false);
		const first = host.querySelector(".gt-group .gt-c-w");
		expect(first?.textContent).toBe("");
	});
});

describe("buildSvg", () => {
	const palette = { "--background-primary": "#ffffff", "--text-normal": "#111111", "--color-green": "#2c9a6c" };

	it("returns a self-contained SVG with the title and every task", () => {
		const out = buildSvg(project, state({ paper: true, critical: criticalPath(project) }), palette);
		expect(out.svg.startsWith("<svg")).toBe(true);
		expect(out.svg).toContain("Hotel plan");
		for (const name of ["Survey", "Build", "Sign-off", "Phase two"]) expect(out.svg).toContain(name);
		expect(out.width).toBeGreaterThan(1000);
		expect(out.height).toBeGreaterThan(100);
	});

	it("escapes task names", () => {
		const t = buildProject(
			findTables(["| Task | Start |", "| - | - |", "| A & <B> | 2026-11-02 |"].join("\n"))[0],
			today
		);
		const out = buildSvg(t, state(), palette);
		expect(out.svg).toContain("A &amp; &lt;B&gt;");
		expect(out.svg).not.toContain("<B>");
	});
});

describe("row height", () => {
	it("uses the fixed sizes for compact, normal and roomy", () => {
		expect(rowHeightFor("compact", 800, 18)).toBe(26);
		expect(rowHeightFor("normal", 800, 18)).toBe(32);
		expect(rowHeightFor("roomy", 800, 18)).toBe(40);
	});

	it("fit divides the height under the header between the rows", () => {
		// (500 - 44 header - 2) / 10 rows = 45
		expect(rowHeightFor("fit", 500, 10)).toBe(45);
	});

	it("fit stays between 18 and 56 pixels", () => {
		expect(rowHeightFor("fit", 400, 100)).toBe(18);
		expect(rowHeightFor("fit", 900, 2)).toBe(56);
	});

	it("fit falls back to normal when there is no height or no rows", () => {
		expect(rowHeightFor("fit", 0, 10)).toBe(32);
		expect(rowHeightFor("fit", 500, 0)).toBe(32);
	});

	it("the chart accepts the fit setting without a measured height", () => {
		const { host, chart } = mount();
		chart.render(project, state({ rowHeight: "fit" }), false);
		expect(host.querySelectorAll(".gt-row")).toHaveLength(5);
	});
});
