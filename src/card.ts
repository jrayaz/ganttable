import { MarkdownPostProcessorContext, MarkdownRenderChild, TFile } from "obsidian";
import type GanttablePlugin from "./main";
import { Project, buildProject } from "./model";
import { findGanttTable, parseBlockOptions } from "./parser";
import { formatShort, todayDay } from "./dates";

/**
 * The summary card shown in the note where a `gantt` code block sits.
 * It keeps itself up to date when the note is edited and opens the full view on click.
 */
export class GanttCard extends MarkdownRenderChild {
	constructor(
		containerEl: HTMLElement,
		private readonly plugin: GanttablePlugin,
		private readonly source: string,
		private readonly ctx: MarkdownPostProcessorContext
	) {
		super(containerEl);
	}

	onload(): void {
		void this.draw();
		this.registerEvent(
			this.plugin.app.vault.on("modify", (f) => {
				if (f.path === this.ctx.sourcePath) void this.draw();
			})
		);
	}

	private async draw(): Promise<void> {
		const el = this.containerEl;
		el.empty();
		el.addClass("gt-card");

		const file = this.plugin.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
		if (!(file instanceof TFile)) {
			el.createDiv({ cls: "gt-card-note", text: "Save this note to see its Gantt." });
			return;
		}
		const options = parseBlockOptions(this.source);
		const text = await this.plugin.app.vault.read(file);
		const info = this.ctx.getSectionInfo(el);
		const table = findGanttTable(text, info?.lineStart);
		if (!table) {
			el.createDiv({ cls: "gt-card-title", text: options.title ?? file.basename });
			el.createDiv({
				cls: "gt-card-note",
				text: "No table found. Add a table with Task and Start columns above this block, or run Insert gantt template.",
			});
			return;
		}

		const today = todayDay();
		const project = buildProject(table, today);
		el.createDiv({ cls: "gt-card-title", text: options.title ?? file.basename });
		if (project.tasks.length === 0) {
			el.createDiv({ cls: "gt-card-note", text: "The table has no rows with a valid Start date yet." });
		} else {
			el.createDiv({ cls: "gt-card-meta", text: this.summaryLine(project) });
			const next = this.nextMilestone(project, today);
			if (next) el.createDiv({ cls: "gt-card-meta", text: next });
		}
		if (project.issues.length > 0) {
			el.createDiv({
				cls: "gt-card-warn",
				text: `${project.issues.length} ${project.issues.length === 1 ? "problem" : "problems"} in the table`,
			});
		}
		const open = el.createEl("button", { cls: "mod-cta gt-card-open", text: "Open gantt" });
		open.addEventListener("click", () => void this.plugin.openGantt(file));
	}

	private summaryLine(project: Project): string {
		const s = project.stats;
		return `${formatShort(project.start, true)} to ${formatShort(project.end, true)} · ${s.taskCount} tasks · ${s.done}% done`;
	}

	private nextMilestone(project: Project, today: number): string | null {
		const next = project.tasks
			.filter((t) => t.milestone && t.start >= today)
			.sort((a, b) => a.start - b.start)[0];
		return next ? `Next milestone: ${next.name}, ${formatShort(next.start)}` : null;
	}
}
