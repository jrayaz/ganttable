import { Editor, Notice, Platform, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { GanttCard } from "./card";
import { DEFAULT_SETTINGS, GanttableSettings, GanttableSettingTab } from "./settings";
import { GanttView, VIEW_TYPE_GANTT } from "./view";
import { todayDay, toISO } from "./dates";

export default class GanttablePlugin extends Plugin {
	settings: GanttableSettings = { ...DEFAULT_SETTINGS };

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_GANTT, (leaf) => new GanttView(leaf, this));

		this.registerMarkdownCodeBlockProcessor("gantt", (source, el, ctx) => {
			ctx.addChild(new GanttCard(el, this, source, ctx));
		});

		this.addRibbonIcon("chart-gantt", "Open gantt for the current note", () => {
			void this.openForActiveNote();
		});

		this.addCommand({
			id: "open-gantt",
			name: "Open gantt for the current note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.openGantt(file);
				return true;
			},
		});

		this.addCommand({
			id: "insert-template",
			name: "Insert gantt template",
			editorCallback: (editor: Editor) => {
				editor.replaceSelection(this.template());
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (file instanceof TFile && file.extension === "md") {
					menu.addItem((item) =>
						item
							.setTitle("Open gantt")
							.setIcon("chart-gantt")
							.onClick(() => void this.openGantt(file))
					);
				}
			})
		);

		this.addSettingTab(new GanttableSettingTab(this));
	}

	async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<GanttableSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
	}

	async saveSettings(): Promise<void> {
		// Update the open views first so the screen never waits on the disk write.
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GANTT)) {
			if (leaf.view instanceof GanttView) leaf.view.applySettings();
		}
		await this.saveData(this.settings);
	}

	private async openForActiveNote(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") {
			new Notice("Open a Markdown note first.");
			return;
		}
		await this.openGantt(file);
	}

	/** Show the Gantt for a note. Reuses an open view for the same note. */
	async openGantt(file: TFile): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_GANTT).find((leaf) => {
			return leaf.view instanceof GanttView && leaf.view.sourcePath === file.path;
		});
		if (existing) {
			await workspace.revealLeaf(existing);
			return;
		}
		const leaf = this.newLeaf();
		await leaf.setViewState({ type: VIEW_TYPE_GANTT, active: true, state: { file: file.path } });
		await workspace.revealLeaf(leaf);
	}

	/**
	 * A leaf to show the chart in. Phones only have tabs, so the split and pop-up
	 * choices apply on desktop. If Obsidian cannot make the leaf asked for (for
	 * example when no tab is open), fall back to whatever leaf it offers.
	 */
	private newLeaf(): WorkspaceLeaf {
		const { workspace } = this.app;
		const where = Platform.isMobile ? "tab" : this.settings.openIn;
		try {
			if (where === "split") return workspace.getLeaf("split", "vertical");
			if (where === "window") return workspace.getLeaf("window");
			return workspace.getLeaf("tab");
		} catch {
			return workspace.getLeaf();
		}
	}

	private template(): string {
		const t = todayDay();
		const d = (n: number): string => toISO(t + n);
		return [
			"| WBS | Task | Start | End | Done | After | Area |",
			"| --- | --- | --- | --- | --- | --- | --- |",
			"| 1 | Foundations | | | | | |",
			`| 1.1 | Learn the basics | ${d(0)} | ${d(13)} | 100% | | Study |`,
			`| 1.2 | Practice project | ${d(7)} | ${d(27)} | 40% | 1.1 | Build |`,
			`| 1.3 | ◆ Level up: basics done | ${d(27)} | | | 1.2 | Plan |`,
			"| 2 | Portfolio | | | | | |",
			`| 2.1 | Build the main project | ${d(28)} | ${d(70)} | | 1.3 | Build |`,
			`| 2.2 | Write it up | ${d(63)} | ${d(84)} | | 2.1 | Career |`,
			`| 2.3 | ◆ Portfolio live | ${d(84)} | | | 2.2 | Plan |`,
			"",
			"```gantt",
			"title: My plan",
			"```",
			"",
		].join("\n");
	}
}
