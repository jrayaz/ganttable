/**
 * Builds a standalone SVG of the chart for saving or printing. It does not
 * touch the DOM: colours come in as a palette read from the theme.
 */
import { ChartState, colorFor, computeRange, initials, legendItems, linkPath, ownerBadges } from "./chart";
import { Project, Task, visibleTasks } from "./model";
import { dayOfMonth, formatShort, isoWeek, monthKey, monthYear } from "./dates";

/** Obsidian variables the export needs, resolved to real colour values. */
export const EXPORT_VARS = [
	"--background-primary",
	"--background-secondary",
	"--background-modifier-border",
	"--background-modifier-border-hover",
	"--text-normal",
	"--text-muted",
	"--text-faint",
	"--interactive-accent",
	"--color-green",
	"--color-orange",
	"--color-red",
	"--color-purple",
	"--color-cyan",
	"--color-pink",
	"--color-blue",
	"--color-yellow",
];

export type Palette = Record<string, string>;

export function readPalette(el: Element): Palette {
	const cs = getComputedStyle(el);
	const out: Palette = {};
	for (const name of EXPORT_VARS) out[name] = cs.getPropertyValue(name).trim();
	return out;
}

export interface ExportResult {
	svg: string;
	width: number;
	height: number;
}

const LEFT_WIDTH = 380;
const TIMELINE_WIDTH = 1100;
const ROW_H = 26;
const TITLE_H = 62;
const HEAD_H = 40;
const FOOT_H = 44;
const FONT = "Segoe UI, system-ui, -apple-system, sans-serif";

function esc(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function num(n: number): string {
	return String(Math.round(n * 100) / 100);
}

export function buildSvg(project: Project, state: ChartState, pal: Palette): ExportResult {
	const color = (v: string): string => pal[v] || "#888888";
	const badges = ownerBadges(project);
	const range = computeRange(project);
	const px = TIMELINE_WIDTH / range.days;
	const tasks = visibleTasks(project, state.collapsed);
	const width = LEFT_WIDTH + TIMELINE_WIDTH;
	const bodyTop = TITLE_H + HEAD_H;
	const height = bodyTop + tasks.length * ROW_H + FOOT_H;
	const xOf = (day: number): number => LEFT_WIDTH + (day - range.start) * px;
	const parts: string[] = [];
	const text = (x: number, y: number, value: string, opts: { size?: number; fill?: string; weight?: number; anchor?: string; mono?: boolean } = {}): void => {
		parts.push(
			`<text x="${num(x)}" y="${num(y)}" font-family="${opts.mono ? "Consolas, monospace" : FONT}" font-size="${opts.size ?? 11}" fill="${opts.fill ?? color("--text-normal")}"${opts.weight ? ` font-weight="${opts.weight}"` : ""}${opts.anchor ? ` text-anchor="${opts.anchor}"` : ""}>${esc(value)}</text>`
		);
	};
	const rect = (x: number, y: number, w: number, h: number, fill: string, extra = ""): void => {
		parts.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(Math.max(0, w))}" height="${num(h)}" fill="${fill}" ${extra}/>`);
	};
	const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, w = 1): void => {
		parts.push(`<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" stroke="${stroke}" stroke-width="${w}"/>`);
	};

	rect(0, 0, width, height, color("--background-primary"));

	// Title block
	text(16, 28, state.title, { size: 18, weight: 600 });
	text(16, 48, `${formatShort(project.start, true)} to ${formatShort(project.end, true)} · ${project.stats.taskCount} tasks · ${project.stats.done}% done`, { size: 11, fill: color("--text-muted") });
	text(width - 16, 28, `Printed ${formatShort(state.today, true)}`, { size: 11, fill: color("--text-muted"), anchor: "end" });
	line(0, TITLE_H - 2, width, TITLE_H - 2, color("--text-normal"), 2);

	// Header: months on top, weeks below
	rect(0, TITLE_H, width, HEAD_H, color("--background-primary"));
	text(10, TITLE_H + 32, "WBS", { size: 9, fill: color("--text-faint") });
	text(54, TITLE_H + 32, "TASK", { size: 9, fill: color("--text-faint") });
	text(232, TITLE_H + 32, "START", { size: 9, fill: color("--text-faint") });
	text(282, TITLE_H + 32, "END", { size: 9, fill: color("--text-faint") });
	text(332, TITLE_H + 32, "DONE", { size: 9, fill: color("--text-faint") });
	let monthStart = 0;
	for (let i = 1; i <= range.days; i++) {
		if (i === range.days || monthKey(range.start + i) !== monthKey(range.start + monthStart)) {
			line(xOf(range.start + monthStart), TITLE_H, xOf(range.start + monthStart), TITLE_H + HEAD_H, color("--background-modifier-border"));
			text(xOf(range.start + monthStart) + 4, TITLE_H + 14, monthYear(range.start + monthStart), { size: 10, weight: 600, mono: true });
			monthStart = i;
		}
	}
	const everyOther = px * 7 < 22;
	for (let i = 0, k = 0; i < range.days; i += 7, k++) {
		if (everyOther && k % 2 === 1) continue;
		text(xOf(range.start + i) + (px * 7) / 2, TITLE_H + 32, String(isoWeek(range.start + i)), { size: 9, fill: color("--text-muted"), anchor: "middle", mono: true });
	}
	line(0, bodyTop, width, bodyTop, color("--background-modifier-border-hover"), 1.5);

	// Row backgrounds and grid
	tasks.forEach((t, i) => {
		const y = bodyTop + i * ROW_H;
		if (t.summary) rect(0, y, width, ROW_H, color("--background-secondary"));
		line(0, y + ROW_H, width, y + ROW_H, color("--background-modifier-border"));
	});
	const gridBottom = bodyTop + tasks.length * ROW_H;
	for (let i = 1; i < range.days; i++) {
		const day = range.start + i;
		const month = dayOfMonth(day) === 1;
		if (month || (i % 7 === 0 && px >= 3)) {
			line(xOf(day), bodyTop, xOf(day), gridBottom, month ? color("--background-modifier-border-hover") : color("--background-modifier-border"), month ? 1 : 0.6);
		}
	}
	line(LEFT_WIDTH, TITLE_H, LEFT_WIDTH, gridBottom, color("--background-modifier-border-hover"), 1.5);

	// Today
	if (state.showToday && state.today >= range.start && state.today < range.start + range.days) {
		const x = xOf(state.today) + px / 2;
		line(x, bodyTop, x, gridBottom, color("--interactive-accent"), 1.5);
		parts.push(`<polygon points="${num(x - 5)},${bodyTop - 7} ${num(x + 5)},${bodyTop - 7} ${num(x)},${bodyTop}" fill="${color("--interactive-accent")}"/>`);
	}

	// Rows
	const rowOf = new Map<string, number>();
	tasks.forEach((t, i) => rowOf.set(t.wbs, i));
	tasks.forEach((t, i) => drawRow(t, i));

	function drawRow(t: Task, i: number): void {
		const y = bodyTop + i * ROW_H;
		const cy = y + ROW_H / 2;
		const indent = t.level * 10;
		const c = color(colorFor(project, t, state.colorBy));
		text(10 + indent, cy + 4, t.wbs.startsWith("~") ? "" : t.wbs, { size: 10, fill: color("--text-faint"), mono: true });
		text(54 + indent, cy + 4, clip(t.name, 28 - Math.floor(indent / 6)), { size: 11.5, weight: t.summary ? 600 : 400 });
		text(232, cy + 4, formatShort(t.start), { size: 10, fill: color("--text-muted"), mono: true });
		if (!t.milestone) {
			text(282, cy + 4, formatShort(t.end), { size: 10, fill: color("--text-muted"), mono: true });
			text(332, cy + 4, `${t.done}%`, { size: 10, fill: color("--text-muted"), mono: true });
		}
		if (t.owner !== "" && !t.summary) {
			const ox = 362;
			parts.push(`<rect x="${ox - 14}" y="${num(cy - 8)}" width="28" height="16" rx="8" fill="${color(colorFor(project, t, "owner"))}" fill-opacity="0.22"/>`);
			text(ox, cy + 3, badges.get(t.owner) ?? initials(t.owner), { size: 7.5, anchor: "middle", fill: color(colorFor(project, t, "owner")), weight: 600 });
		}

		const x0 = xOf(t.start);
		const crit = state.critical !== null && state.critical.has(t.wbs);
		if (t.summary) {
			const w = (t.end + 1 - t.start) * px;
			parts.push(`<polygon points="${num(x0)},${num(cy - 4)} ${num(x0 + w)},${num(cy - 4)} ${num(x0 + w)},${num(cy + 4)} ${num(x0 + w - 5)},${num(cy)} ${num(x0 + 5)},${num(cy)} ${num(x0)},${num(cy + 4)}" fill="${c}" fill-opacity="0.9"/>`);
		} else if (t.milestone) {
			const cx = x0 + px / 2;
			parts.push(`<polygon points="${num(cx)},${num(cy - 7)} ${num(cx + 7)},${num(cy)} ${num(cx)},${num(cy + 7)} ${num(cx - 7)},${num(cy)}" fill="${c}"${crit ? ` stroke="${color("--color-red")}" stroke-width="1.5"` : ""}/>`);
			text(cx + 12, cy + 4, t.name, { size: 11, weight: 600 });
			text(cx + 14 + t.name.length * 5.6 + 6, cy + 4, formatShort(t.start), { size: 9.5, fill: color("--text-faint"), mono: true });
		} else {
			const w = Math.max(4, (t.end + 1 - t.start) * px);
			const bh = 14;
			const by = cy - bh / 2;
			parts.push(`<rect x="${num(x0)}" y="${num(by)}" width="${num(w)}" height="${bh}" rx="3" fill="${c}" fill-opacity="0.2" stroke="${crit ? color("--color-red") : c}" stroke-opacity="${crit ? 1 : 0.6}" stroke-width="${crit ? 1.5 : 1}"/>`);
			if (t.done > 0) parts.push(`<rect x="${num(x0)}" y="${num(by)}" width="${num((w * t.done) / 100)}" height="${bh}" rx="3" fill="${c}"/>`);
			if (state.showBaseline && t.baseline !== null && t.baseline !== t.end) {
				rect(x0, by + bh + 1.5, Math.max(4, (t.baseline + 1 - t.start) * px), 2.5, color("--text-faint"), 'rx="1"');
			}
			const lx = x0 + w + 6;
			text(lx, cy + 4, `${t.end - t.start + 1}d`, { size: 9.5, fill: color("--text-faint"), mono: true });
			if (state.showBaseline && t.slip > 0) {
				parts.push(`<rect x="${num(lx + 26)}" y="${num(cy - 7)}" width="30" height="14" rx="7" fill="${color("--color-red")}" fill-opacity="0.16"/>`);
				text(lx + 41, cy + 3, `+${t.slip}d`, { size: 9, anchor: "middle", fill: color("--color-red"), weight: 600, mono: true });
			}
		}
	}

	// Links
	if (state.showLinks) {
		for (const t of tasks) {
			const toRow = rowOf.get(t.wbs);
			if (toRow === undefined || t.summary) continue;
			for (const pid of t.after) {
				const p = project.byWbs.get(pid);
				const fromRow = rowOf.get(pid);
				if (!p || fromRow === undefined || p.summary) continue;
				const x1 = p.milestone ? xOf(p.start) + px / 2 + 8 : xOf(p.end + 1);
				const x2 = t.milestone ? xOf(t.start) + px / 2 - 8 : xOf(t.start);
				const y1 = bodyTop + fromRow * ROW_H + ROW_H / 2;
				const y2 = bodyTop + toRow * ROW_H + ROW_H / 2;
				const crit = state.critical !== null && state.critical.has(t.wbs) && state.critical.has(pid);
				const stroke = crit ? color("--color-red") : color("--text-faint");
				parts.push(`<path d="${linkPath(x1, y1, x2, y2, ROW_H)}" fill="none" stroke="${stroke}" stroke-width="${crit ? 1.6 : 1}" stroke-linejoin="round"/>`);
				parts.push(`<path d="M${num(x2)} ${num(y2)}l-5 -3.5v7z" fill="${stroke}"/>`);
			}
		}
	}

	// Legend footer
	let lx = 16;
	const fy = gridBottom + 28;
	line(0, gridBottom + 6, width, gridBottom + 6, color("--background-modifier-border-hover"));
	for (const item of legendItems(project, state.colorBy)) {
		rect(lx, fy - 9, 10, 10, color(item.colorVar), 'rx="2"');
		text(lx + 15, fy, item.label, { size: 10.5, fill: color("--text-muted") });
		lx += 15 + item.label.length * 6 + 18;
	}
	text(width - 16, fy, "Made with Ganttable", { size: 10, fill: color("--text-faint"), anchor: "end" });

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
	return { svg, width, height };
}

/** Rasterise an SVG string to PNG bytes. Runs in the app's own web view, so it works on desktop and mobile. */
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<ArrayBuffer> {
	const img = new Image();
	const loaded = new Promise<void>((resolve, reject) => {
		img.onload = () => resolve();
		img.onerror = () => reject(new Error("The chart image could not be drawn."));
	});
	img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	await loaded;
	const canvas = createEl("canvas");
	canvas.width = width * scale;
	canvas.height = height * scale;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas is not available.");
	ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
	if (!blob) throw new Error("The PNG could not be created.");
	return blob.arrayBuffer();
}
