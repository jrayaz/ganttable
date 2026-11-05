import { Debouncer, ItemView, Menu, Notice, TFile, ViewStateResult, WorkspaceLeaf, debounce, normalizePath } from "obsidian";
import type GanttablePlugin from "./main";
import { ChartState, DragMode, GanttChart, STATUS_COLOR, STATUS_LABEL, legendItems } from "./chart";
import { EditError, RowEdit, applyEdits } from "./edit";
import { Position, pushSuccessors } from "./schedule";
import { buildSvg, readPalette, svgToPng } from "./export";
import { ChartTheme, ColorBy, GanttableSettings, GroupBy, RowHeightSetting, ZoomSetting } from "./settings";
import { Project, Status, Task, buildProject, criticalPath, regroupByOwner } from "./model";
import { findGanttTable } from "./parser";
import { formatShort, todayDay } from "./dates";

export const VIEW_TYPE_GANTT = "ganttable-view";
const NARROW_BELOW = 760;
const THEME_CLASSES = ["gt-theme-light", "gt-theme-dark", "theme-light", "theme-dark"];
const THEME_LABEL: Record<ChartTheme, string> = { follow: "Theme: auto", light: "Theme: light", dark: "Theme: dark" };
const THEME_NEXT: Record<ChartTheme, ChartTheme> = { follow: "light", light: "dark", dark: "follow" };

/** Obsidian's leaf has an internal header refresh that is not in the public typings. */
interface HeaderLeaf {
	updateHeader?: () => void;
}

/** The view's header title element exists at runtime but not in the public typings. */
interface HeaderView {
	titleEl?: HTMLElement;
}

interface GanttViewState {
	file?: string | null;
}

export class GanttView extends ItemView {
	private file: TFile | null = null;
	private project: Project | null = null;
	private critical: Set<string> = new Set();
	private chart: GanttChart | null = null;
	private message: HTMLElement | null = null;
	private issuesEl: HTMLElement | null = null;
	private stripEl: HTMLElement | null = null;
	private inspEl: HTMLElement | null = null;
	private liveEl: HTMLElement | null = null;
	private refreshBtn: HTMLElement | null = null;
	private themeBtn: HTMLElement | null = null;
	private zoomButtons = new Map<ZoomSetting, HTMLElement>();
	private toggles = new Map<string, HTMLElement>();
	private reloadSoon: Debouncer<[], void> | null = null;
	private renderSoon: Debouncer<[], void> | null = null;
	private state: ChartState;
	private groupBy: GroupBy;
	private criticalOn: boolean;
	private undoStack: { path: string; before: string; after: string }[] = [];
	private undoBtn: HTMLElement | null = null;
	private renderPending = false;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: GanttablePlugin) {
		super(leaf);
		const s = plugin.settings;
		this.groupBy = s.groupBy;
		this.criticalOn = s.criticalPath;
		this.state = {
			zoom: s.defaultZoom,
			colorBy: s.colorBy,
			rowHeight: s.rowHeight,
			collapsed: new Set<string>(),
			selected: null,
			today: todayDay(),
			showToday: s.showToday,
			shadeWeekends: s.shadeWeekends,
			showLinks: s.showLinks,
			showBaseline: s.showBaseline,
			critical: s.criticalPath ? this.critical : null,
			paper: false,
			title: "",
			editable: s.allowDragEdit,
			labelWidth: s.labelWidth,
		};
	}

	getViewType(): string {
		return VIEW_TYPE_GANTT;
	}

	getDisplayText(): string {
		return this.file ? `${this.file.basename} (Gantt)` : "Gantt";
	}

	getIcon(): string {
		return "chart-gantt";
	}

	getState(): Record<string, unknown> {
		return { file: this.file?.path ?? null };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const path = (state as GanttViewState | null)?.file;
		if (typeof path === "string") {
			const found = this.app.vault.getAbstractFileByPath(path);
			this.file = found instanceof TFile ? found : null;
		}
		await super.setState(state, result);
		this.refreshTitle();
		await this.reload();
	}

	/** Ask Obsidian to redraw the tab and view header after the note changes. */
	private refreshTitle(): void {
		(this.leaf as unknown as HeaderLeaf).updateHeader?.();
		(this as unknown as HeaderView).titleEl?.setText(this.getDisplayText());
		this.state.title = this.file?.basename ?? "Gantt";
	}

	/** The note this view is showing, so the plugin can reuse an open view instead of making a second one. */
	get sourcePath(): string | null {
		return this.file?.path ?? null;
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("gt-view");

		this.stripEl = root.createDiv({ cls: "gt-strip" });
		this.buildToolbar(root);
		this.issuesEl = root.createDiv({ cls: "gt-issues" });
		this.message = root.createDiv({ cls: "gt-message" });
		this.chart = new GanttChart(root, {
			onSelect: (wbs) => {
				this.state.selected = wbs;
				this.renderAll();
			},
			onToggle: (wbs) => {
				const next = new Set(this.state.collapsed);
				if (next.has(wbs)) next.delete(wbs);
				else next.add(wbs);
				this.state.collapsed = next;
				this.renderAll();
			},
			onEdit: (wbs, mode, delta) => void this.commitEdit(wbs, mode, delta),
			onLabelWidth: (width) => this.changeSetting("labelWidth", width),
			onDragEnd: () => {
				if (this.renderPending) {
					this.renderPending = false;
					this.renderAll();
				}
			},
		});
		this.inspEl = root.createDiv({ cls: "gt-insp" });

		this.applySettings();

		this.registerEvent(
			this.app.vault.on("modify", (f) => {
				if (this.file && f.path === this.file.path) this.onSourceChanged();
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (f, oldPath) => {
				if (this.file && oldPath === this.file.path && f instanceof TFile) {
					this.file = f;
					this.refreshTitle();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (f) => {
				if (this.file && f.path === this.file.path) {
					this.file = null;
					this.project = null;
					this.renderAll();
				}
			})
		);

		// Ctrl or Cmd+Z undoes the last drag while the chart has focus.
		root.setAttr("tabindex", "-1");
		this.registerDomEvent(root, "pointerdown", () => root.focus({ preventScroll: true }));
		this.registerDomEvent(root, "keydown", (ev) => {
			const target = ev.target as HTMLElement;
			if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z" && !ev.shiftKey && target.tagName !== "SELECT") {
				ev.preventDefault();
				void this.undo();
			}
		});

		this.renderSoon = debounce(() => this.renderAll(), 80, true);
		const observer = new ResizeObserver(() => this.renderSoon?.());
		observer.observe(root);
		this.register(() => observer.disconnect());

		await this.reload();
	}

	async onClose(): Promise<void> {
		this.reloadSoon?.cancel();
		this.renderSoon?.cancel();
	}

	/** Called by the plugin when a setting changes. */
	applySettings(): void {
		const s = this.plugin.settings;
		this.state.colorBy = s.colorBy;
		this.state.rowHeight = s.rowHeight;
		this.state.showToday = s.showToday;
		this.state.shadeWeekends = s.shadeWeekends;
		this.state.showLinks = s.showLinks;
		this.state.showBaseline = s.showBaseline;
		this.state.labelWidth = s.labelWidth;
		this.criticalOn = s.criticalPath;
		this.groupBy = s.groupBy;
		this.applyTheme();
		this.reloadSoon?.cancel();
		this.reloadSoon = debounce(() => void this.reload(), s.updateDelay, true);
		this.renderAll();
	}

	/** Light or dark for the chart alone, using Obsidian's own palette for that scheme. */
	private applyTheme(): void {
		const theme = this.plugin.settings.chartTheme;
		this.contentEl.removeClass(...THEME_CLASSES);
		if (theme === "light") this.contentEl.addClass("gt-theme-light", "theme-light");
		if (theme === "dark") this.contentEl.addClass("gt-theme-dark", "theme-dark");
		this.themeBtn?.setText(THEME_LABEL[theme]);
	}

	private onSourceChanged(): void {
		if (this.plugin.settings.liveUpdate) {
			this.reloadSoon?.();
		} else {
			this.refreshBtn?.addClass("gt-stale");
			this.liveEl?.setText("Note changed. Press refresh.");
		}
	}

	/** Make the toolbar controls match the current state. */
	private syncToolbar(): void {
		this.toggles.get("critical")?.setAttr("aria-pressed", String(this.criticalOn));
		this.toggles.get("links")?.setAttr("aria-pressed", String(this.state.showLinks));
		this.toggles.get("baseline")?.setAttr("aria-pressed", String(this.state.showBaseline));
		this.toggles.get("paper")?.setAttr("aria-pressed", String(this.state.paper));
		this.zoomButtons.forEach((btn, zoom) => btn.setAttr("aria-pressed", String(!this.state.paper && this.state.zoom === zoom)));
		this.undoBtn?.toggleAttribute("disabled", this.undoStack.length === 0);
		this.chart?.setOverviewVisible(this.plugin.settings.showOverview && !this.state.paper);
		const values: [string, string][] = [
			["colour", this.state.colorBy],
			["group", this.groupBy],
			["rows", this.state.rowHeight],
		];
		for (const [id, value] of values) {
			const select = this.contentEl.querySelector<HTMLSelectElement>(`select[data-gt="${id}"]`);
			if (select) select.value = value;
		}
	}

	/** Toolbar choices are saved as settings, so they stay put and every open Gantt follows. */
	private changeSetting<K extends keyof GanttableSettings>(key: K, value: GanttableSettings[K]): void {
		this.plugin.settings[key] = value;
		void this.plugin.saveSettings();
	}

	private toggleButton(parent: HTMLElement, id: string, label: string, onToggle: () => void): void {
		const btn = parent.createEl("button", { text: label, cls: "gt-btn", attr: { "aria-pressed": "false" } });
		btn.addEventListener("click", onToggle);
		this.toggles.set(id, btn);
	}

	private selectControl<T extends string>(
		parent: HTMLElement,
		id: string,
		label: string,
		options: [T, string][],
		onChange: (value: T) => void
	): void {
		const select = parent.createEl("select", { cls: "dropdown", attr: { "aria-label": label, "data-gt": id } });
		for (const [value, text] of options) select.createEl("option", { value, text });
		select.addEventListener("change", () => onChange(select.value as T));
	}

	private buildToolbar(root: HTMLElement): void {
		const tools = root.createDiv({ cls: "gt-tools" });

		const seg = tools.createDiv({ cls: "gt-seg", attr: { role: "group", "aria-label": "Zoom" } });
		const zooms: [ZoomSetting, string][] = [
			["day", "Day"],
			["week", "Week"],
			["month", "Month"],
			["fit", "Fit"],
		];
		for (const [zoom, label] of zooms) {
			const btn = seg.createEl("button", { text: label, attr: { "aria-pressed": "false" } });
			btn.addEventListener("click", () => {
				this.state.zoom = zoom;
				this.state.paper = false;
				this.renderAll();
				this.chart?.scrollToStart();
			});
			this.zoomButtons.set(zoom, btn);
		}

		const today = tools.createEl("button", { text: "Today", cls: "gt-btn" });
		today.addEventListener("click", () => {
			this.state.today = todayDay();
			this.chart?.scrollToToday(this.state.today);
		});

		tools.createSpan({ cls: "gt-lab", text: "Colour" });
		this.selectControl<ColorBy>(
			tools,
			"colour",
			"Colour bars by",
			[
				["status", "Status"],
				["phase", "Phase"],
				["owner", "Owner"],
			],
			(value) => this.changeSetting("colorBy", value)
		);

		tools.createSpan({ cls: "gt-lab", text: "Group" });
		this.selectControl<GroupBy>(
			tools,
			"group",
			"Group rows by",
			[
				["wbs", "WBS"],
				["owner", "Owner"],
			],
			(value) => {
				this.state.collapsed = new Set();
				this.state.selected = null;
				this.changeSetting("groupBy", value);
			}
		);

		this.toggleButton(tools, "critical", "Critical path", () => this.changeSetting("criticalPath", !this.plugin.settings.criticalPath));
		this.toggleButton(tools, "links", "Links", () => this.changeSetting("showLinks", !this.plugin.settings.showLinks));
		this.toggleButton(tools, "baseline", "Baseline", () => this.changeSetting("showBaseline", !this.plugin.settings.showBaseline));

		tools.createDiv({ cls: "gt-spacer" });

		this.selectControl<RowHeightSetting>(
			tools,
			"rows",
			"Row height",
			[
				["compact", "Compact"],
				["normal", "Normal"],
				["roomy", "Roomy"],
				["fit", "Fit"],
			],
			(value) => this.changeSetting("rowHeight", value)
		);

		const collapse = tools.createEl("button", { text: "Collapse all", cls: "gt-btn" });
		collapse.addEventListener("click", () => {
			const shown = this.shownProject();
			if (!shown) return;
			const parents = shown.tasks.filter((t) => t.summary).map((t) => t.wbs);
			const allClosed = parents.every((w) => this.state.collapsed.has(w));
			this.state.collapsed = new Set(allClosed ? [] : parents);
			collapse.setText(allClosed ? "Collapse all" : "Expand all");
			this.renderAll();
		});

		const live = tools.createDiv({ cls: "gt-live-wrap" });
		this.liveEl = live.createSpan({ cls: "gt-live", text: "" });
		this.refreshBtn = live.createEl("button", { text: "Refresh", cls: "gt-btn", attr: { title: "Re-read the note" } });
		this.refreshBtn.addEventListener("click", () => void this.reload());

		this.undoBtn = tools.createEl("button", { text: "Undo", cls: "gt-btn", attr: { title: "Undo the last change made by dragging", disabled: "true" } });
		this.undoBtn.addEventListener("click", () => void this.undo());

		this.toggleButton(tools, "paper", "Print preview", () => {
			this.state.paper = !this.state.paper;
			this.renderAll();
			this.chart?.scrollToStart();
		});

		const exportBtn = tools.createEl("button", { text: "Export", cls: "gt-btn" });
		exportBtn.addEventListener("click", (ev) => {
			const menu = new Menu();
			menu.addItem((item) => item.setTitle("Save as SVG").setIcon("image").onClick(() => void this.exportChart("svg")));
			menu.addItem((item) => item.setTitle("Save as PNG").setIcon("image").onClick(() => void this.exportChart("png")));
			menu.showAtMouseEvent(ev);
		});

		this.themeBtn = tools.createEl("button", {
			text: THEME_LABEL[this.plugin.settings.chartTheme],
			cls: "gt-btn",
			attr: { title: "Switch the chart between auto, light and dark" },
		});
		this.themeBtn.addEventListener("click", () => this.changeSetting("chartTheme", THEME_NEXT[this.plugin.settings.chartTheme]));
	}

	/** The project as it is currently arranged: by WBS, or regrouped by owner. */
	private shownProject(): Project | null {
		if (!this.project || this.project.tasks.length === 0) return null;
		return this.groupBy === "owner" ? regroupByOwner(this.project) : this.project;
	}

	private async exportChart(kind: "svg" | "png"): Promise<void> {
		const shown = this.shownProject();
		if (!shown || !this.file) {
			new Notice("There is no chart to export yet.");
			return;
		}
		try {
			// A hidden element with the light print theme, used only to read real colour values.
			const probe = this.contentEl.createDiv({ cls: "gt-paper-sheet theme-light gt-hidden" });
			const palette = readPalette(probe);
			probe.remove();
			const state: ChartState = { ...this.state, paper: true, selected: null, critical: this.criticalOn ? this.critical : null };
			const { svg, width, height } = buildSvg(shown, state, palette);
			const folder = this.file.parent && this.file.parent.path !== "/" ? `${this.file.parent.path}/` : "";
			const path = normalizePath(`${folder}${this.file.basename} gantt.${kind}`);
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (kind === "svg") {
				if (existing instanceof TFile) await this.app.vault.modify(existing, svg);
				else await this.app.vault.create(path, svg);
			} else {
				const bytes = await svgToPng(svg, width, height);
				if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, bytes);
				else await this.app.vault.createBinary(path, bytes);
			}
			new Notice(`Saved ${path}`);
		} catch (err) {
			new Notice(`Could not export the chart. ${err instanceof Error ? err.message : ""}`);
		}
	}

	/** The rows that hold dates: the task itself, or every task beneath a summary row. */
	private leavesOf(project: Project, task: Task): Task[] {
		if (!task.summary) return [task];
		return task.children.flatMap((c) => {
			const child = project.byWbs.get(c);
			return child ? this.leavesOf(project, child) : [];
		});
	}

	/** Write a finished drag into the note's table. */
	private async commitEdit(wbs: string, mode: DragMode, delta: number): Promise<void> {
		const shown = this.shownProject();
		const task = shown?.byWbs.get(wbs);
		const file = this.file;
		if (!shown || !task || !file || delta === 0) return;
		if (mode === "progress" && task.summary) return;
		const leaves = this.leavesOf(shown, task).filter((t) => t.line >= 0);
		const edits: RowEdit[] = leaves.map((t) => {
			const edit: RowEdit = { line: t.line, name: t.name, wbs: t.wbs };
			if (mode === "progress") {
				edit.done = Math.min(100, Math.max(0, t.done + delta));
			} else if (mode === "end") {
				edit.end = t.end + delta;
			} else {
				edit.start = t.start + delta;
				if (mode === "move" && !t.endBlank) edit.end = t.end + delta;
			}
			return edit;
		});
		if (edits.length === 0) return;

		// Optionally push tasks that follow the moved ones later, so they still start after them.
		let pushedCount = 0;
		if (this.plugin.settings.pushDependents && this.project && (mode === "move" || mode === "end")) {
			try {
				const moved = new Map<string, Position>();
				for (const t of leaves) {
					moved.set(t.wbs, mode === "end" ? { start: t.start, end: t.end + delta } : { start: t.start + delta, end: t.end + delta });
				}
				const original = this.project;
				for (const [pwbs, pos] of pushSuccessors(original, moved)) {
					const t = original.byWbs.get(pwbs);
					if (!t || t.line < 0) continue;
					const edit: RowEdit = { line: t.line, name: t.name, wbs: t.wbs, start: pos.start };
					if (!t.endBlank) edit.end = pos.end;
					edits.push(edit);
					pushedCount++;
				}
			} catch (err) {
				new Notice(err instanceof Error ? err.message : "The later tasks could not be moved.");
				return;
			}
		}

		try {
			let before = "";
			let after = "";
			await this.app.vault.process(file, (text) => {
				before = text;
				after = applyEdits(text, edits);
				return after;
			});
			this.undoStack.push({ path: file.path, before, after });
			if (this.undoStack.length > 20) this.undoStack.shift();
			const sign = delta > 0 ? "+" : "";
			const what =
				mode === "move"
					? `Moved ${task.name} by ${sign}${delta} days`
					: mode === "start"
						? `Changed the start of ${task.name} by ${sign}${delta} days`
						: mode === "end"
							? `Changed the end of ${task.name} by ${sign}${delta} days`
							: `Set progress of ${task.name} to ${Math.min(100, Math.max(0, task.done + delta))}%`;
			const pushed = pushedCount > 0 ? ` and pushed ${pushedCount} later ${pushedCount === 1 ? "task" : "tasks"}` : "";
			new Notice(`${what}${pushed}. Use undo to revert.`);
		} catch (err) {
			new Notice(err instanceof EditError ? err.message : "The change could not be saved.");
		}
		await this.reload();
	}

	/** Put the note back as it was before the last drag, but only if nothing else has changed it since. */
	private async undo(): Promise<void> {
		const last = this.undoStack[this.undoStack.length - 1];
		const file = this.file;
		if (!last || !file || last.path !== file.path) return;
		try {
			await this.app.vault.process(file, (text) => {
				if (text !== last.after) throw new EditError("The note was edited after that change, so it cannot be undone here.");
				return last.before;
			});
			this.undoStack.pop();
			new Notice("Change undone.");
		} catch (err) {
			this.undoStack = [];
			new Notice(err instanceof EditError ? err.message : "The change could not be undone.");
		}
		await this.reload();
	}

	private async reload(): Promise<void> {
		if (!this.chart) return;
		this.state.today = todayDay();
		this.refreshBtn?.removeClass("gt-stale");
		if (!this.file) {
			this.project = null;
			this.setMessage("Open a note and choose Open gantt for the current note.");
			this.renderAll();
			return;
		}
		const text = await this.app.vault.read(this.file);
		const table = findGanttTable(text);
		if (!table) {
			this.setMessage("This note has no table with a Task column and a Start column.");
			this.renderAll();
			return;
		}
		const next = buildProject(table, this.state.today);
		if (next.tasks.length === 0 && this.project) {
			// Keep the last good chart on screen while the table has errors.
			this.project = { ...this.project, issues: next.issues };
		} else {
			this.project = next;
		}
		this.critical = criticalPath(this.project);
		this.setMessage(null);
		const now = new Date();
		this.liveEl?.setText(`Updated ${now.toTimeString().slice(0, 5)}`);
		this.renderAll();
	}

	private setMessage(text: string | null): void {
		if (!this.message) return;
		this.message.setText(text ?? "");
		this.message.toggleClass("gt-on", text !== null);
	}

	private renderAll(): void {
		if (!this.chart || !this.stripEl || !this.inspEl || !this.issuesEl) return;
		if (this.chart.isDragging) {
			this.renderPending = true;
			return;
		}
		const shown = this.shownProject();
		const hasProject = shown !== null;
		this.chart.root.toggleClass("gt-hidden", !hasProject);
		this.stripEl.toggleClass("gt-hidden", !hasProject);
		this.inspEl.toggleClass("gt-hidden", !hasProject);
		this.syncToolbar();
		this.renderIssues();
		if (!shown) return;
		this.state.critical = this.criticalOn ? this.critical : null;
		this.state.editable = this.plugin.settings.allowDragEdit && !this.state.paper && this.file !== null;
		const narrow = this.contentEl.clientWidth > 0 && this.contentEl.clientWidth < NARROW_BELOW;
		this.chart.render(shown, this.state, narrow);
		this.renderStrip(shown);
		this.renderInspector(shown);
	}

	private renderIssues(): void {
		const el = this.issuesEl;
		if (!el) return;
		el.empty();
		const issues = this.project?.issues ?? [];
		el.toggleClass("gt-on", issues.length > 0);
		if (issues.length === 0) return;
		el.createDiv({ cls: "gt-issues-title", text: `${issues.length} ${issues.length === 1 ? "problem" : "problems"} in the table` });
		const list = el.createEl("ul");
		for (const issue of issues.slice(0, 5)) {
			list.createEl("li", { text: `Line ${issue.line + 1}: ${issue.message}` });
		}
		if (issues.length > 5) list.createEl("li", { text: `and ${issues.length - 5} more` });
	}

	private renderStrip(project: Project): void {
		const el = this.stripEl;
		if (!el) return;
		el.empty();
		const s = project.stats;
		const prog = el.createDiv({ cls: "gt-prog" });
		prog.createSpan({ cls: "gt-big", text: `${s.done}%` });
		const track = prog.createSpan({ cls: "gt-track" });
		track.createEl("b").setCssProps({ "--gt-d": `${s.done}%` });
		prog.createSpan({ cls: "gt-dim", text: "complete" });

		const order: Status[] = ["done", "prog", "risk", "late", "todo"];
		for (const st of order) {
			const dot = el.createSpan({ cls: "gt-sdot" });
			dot.setCssProps({ "--gt-c": `var(${STATUS_COLOR[st]})` });
			dot.createEl("i");
			dot.createEl("b", { text: String(s.counts[st]) });
			dot.createSpan({ text: ` ${STATUS_LABEL[st].toLowerCase()}` });
		}

		if (s.conflicts > 0) {
			el.createSpan({ cls: "gt-warn", text: `${s.conflicts} schedule ${s.conflicts === 1 ? "conflict" : "conflicts"}`, attr: { title: "Tasks that start before a task they follow has finished" } });
		}

		const fin = el.createSpan({ cls: "gt-fin" });
		fin.createSpan({ text: "Finish " });
		fin.createEl("b", { text: formatShort(s.finish, true) });
		if (s.finishSlip > 0) fin.createSpan({ cls: "gt-bad", text: ` ${s.finishSlip} days after baseline` });
		else if (project.tasks.some((t) => t.baseline !== null)) fin.createSpan({ text: " on baseline" });
	}

	private renderInspector(project: Project): void {
		const el = this.inspEl;
		if (!el) return;
		el.empty();
		const task: Task | undefined = this.state.selected ? project.byWbs.get(this.state.selected) : undefined;
		if (!task) {
			el.createSpan({ cls: "gt-dim", text: "Select a bar or row for details." });
		} else {
			el.createSpan({ cls: "gt-ttl", text: `${task.wbs.startsWith("~") ? "" : `${task.wbs} `}${task.name}` });
			const pill = el.createSpan({ cls: "gt-spill", text: STATUS_LABEL[task.status] });
			pill.setCssProps({ "--gt-c": `var(${STATUS_COLOR[task.status]})` });
			const kv = (k: string, v: string): void => {
				const span = el.createSpan({ cls: "gt-kv", text: `${k} ` });
				span.createEl("b", { text: v });
			};
			kv("Dates", task.milestone ? formatShort(task.start) : `${formatShort(task.start)} to ${formatShort(task.end)}`);
			if (!task.milestone) {
				kv("Duration", `${task.end - task.start + 1}d`);
				kv("Done", `${task.done}%`);
			}
			if (task.owner !== "" && !task.summary) kv("Owner", task.owner);
			if (task.after.length > 0) kv("After", task.after.join(", "));
			if (task.slip > 0) kv("Slip", `+${task.slip}d`);
			if (task.conflict) kv("Conflict", "starts before a task it follows has finished");
		}
		const legend = el.createDiv({ cls: "gt-legend" });
		for (const item of legendItems(project, this.state.colorBy)) {
			const entry = legend.createSpan();
			entry.setCssProps({ "--gt-c": `var(${item.colorVar})` });
			entry.createEl("i");
			entry.createSpan({ text: item.label });
		}
	}
}
