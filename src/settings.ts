import { PluginSettingTab, SettingDefinitionItem } from "obsidian";
import type GanttablePlugin from "./main";

export type ZoomSetting = "day" | "week" | "month" | "fit";
export type ColorBy = "status" | "phase" | "owner";
export type RowHeightSetting = "compact" | "normal" | "roomy" | "fit";
export type OpenIn = "tab" | "split" | "window";
export type GroupBy = "wbs" | "owner";
export type ChartTheme = "follow" | "light" | "dark";

export interface GanttableSettings {
	liveUpdate: boolean;
	updateDelay: number;
	openIn: OpenIn;
	defaultZoom: ZoomSetting;
	colorBy: ColorBy;
	rowHeight: RowHeightSetting;
	shadeWeekends: boolean;
	showToday: boolean;
	showOverview: boolean;
	labelWidth: number;
	allowDragEdit: boolean;
	pushDependents: boolean;
	showLinks: boolean;
	showBaseline: boolean;
	criticalPath: boolean;
	groupBy: GroupBy;
	chartTheme: ChartTheme;
}

export const DEFAULT_SETTINGS: GanttableSettings = {
	liveUpdate: true,
	updateDelay: 500,
	openIn: "tab",
	defaultZoom: "week",
	colorBy: "status",
	rowHeight: "normal",
	shadeWeekends: true,
	showToday: true,
	showOverview: true,
	labelWidth: 468,
	allowDragEdit: true,
	pushDependents: false,
	showLinks: true,
	showBaseline: true,
	criticalPath: false,
	groupBy: "wbs",
	chartTheme: "follow",
};

export class GanttableSettingTab extends PluginSettingTab {
	constructor(private readonly plugin: GanttablePlugin) {
		super(plugin.app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: "group",
				heading: "General",
				items: [
					{
						name: "Live update",
						desc: "Redraw the chart shortly after you edit the table. Turn this off to refresh by hand.",
						control: { type: "toggle", key: "liveUpdate" },
					},
					{
						name: "Update delay",
						desc: "How long to wait after you stop typing, in milliseconds.",
						control: { type: "slider", key: "updateDelay", min: 200, max: 2000, step: 100 },
						visible: () => this.plugin.settings.liveUpdate,
					},
					{
						name: "Drag bars to change dates",
						desc: "Move or resize a bar to rewrite the Start and End cells in your table. Turn this off to keep the chart read-only.",
						control: { type: "toggle", key: "allowDragEdit" },
					},
					{
						name: "Push later tasks when moving",
						desc: "When you move a task or extend its end past a task that follows it, move the following tasks later too, so every task still starts after the ones it follows. Tasks are only pushed later, never pulled earlier.",
						control: { type: "toggle", key: "pushDependents" },
						visible: () => this.plugin.settings.allowDragEdit,
					},
					{
						name: "Open gantt in",
						control: {
							type: "dropdown",
							key: "openIn",
							options: { tab: "New tab", split: "Split to the right", window: "New pop-up window" },
						},
					},
				],
			},
			{
				type: "group",
				heading: "Timeline",
				items: [
					{
						name: "Default zoom",
						control: {
							type: "dropdown",
							key: "defaultZoom",
							options: { day: "Day", week: "Week", month: "Month", fit: "Fit to width" },
						},
					},
					{
						name: "Shade weekends",
						desc: "Tint Saturday and Sunday columns when zoomed in to days.",
						control: { type: "toggle", key: "shadeWeekends" },
					},
					{
						name: "Show today line",
						control: { type: "toggle", key: "showToday" },
					},
				],
			},
			{
				type: "group",
				heading: "Appearance",
				items: [
					{
						name: "Show overview strip",
						desc: "The small strip above the chart that shows the whole timeline. Turn it off for more room.",
						control: { type: "toggle", key: "showOverview" },
					},
					{
						name: "Task column width",
						desc: "Width of the task table on the left, in pixels. You can also drag its right edge in the chart.",
						control: { type: "slider", key: "labelWidth", min: 280, max: 720, step: 10 },
					},
					{
						name: "Show dependency links",
						desc: "Draw arrows from each task to the tasks listed in its After column.",
						control: { type: "toggle", key: "showLinks" },
					},
					{
						name: "Show baseline",
						desc: "Mark each task's original finish and show how many days it has slipped.",
						control: { type: "toggle", key: "showBaseline" },
					},
					{
						name: "Highlight critical path",
						desc: "Outline the chain of linked tasks that sets the finish date.",
						control: { type: "toggle", key: "criticalPath" },
					},
					{
						name: "Group rows by",
						control: { type: "dropdown", key: "groupBy", options: { wbs: "WBS", owner: "Owner" } },
					},
					{
						name: "Chart theme",
						desc: "Show the chart in light or dark without changing Obsidian's theme.",
						control: {
							type: "dropdown",
							key: "chartTheme",
							options: { follow: "Follow Obsidian", light: "Light", dark: "Dark" },
						},
					},
					{
						name: "Colour bars by",
						control: {
							type: "dropdown",
							key: "colorBy",
							options: { status: "Status", phase: "Phase (top-level WBS row)", owner: "Owner" },
						},
					},
					{
						name: "Row height",
						control: {
							type: "dropdown",
							key: "rowHeight",
							options: { compact: "Compact", normal: "Normal", roomy: "Roomy", fit: "Fit to window" },
						},
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		return (this.plugin.settings as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings();
		this.update();
	}
}
