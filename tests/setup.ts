/**
 * jsdom does not provide Obsidian's DOM helpers. These shims mirror the parts
 * the plugin uses so the rendering code can run under test.
 */

interface DomInfo {
	cls?: string | string[];
	text?: string;
	attr?: Record<string, string | number | boolean | null>;
	value?: string;
	title?: string;
	type?: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Obsidian's createEl splits a string class on spaces, but createSvg hands the
 * whole string to classList.add, which throws if it contains a space. The shim
 * copies that difference so tests catch it.
 */
function applyInfo(el: Element, info?: string | DomInfo, svg = false): void {
	if (info === undefined) return;
	const o: DomInfo = typeof info === "string" ? { cls: info } : info;
	if (o.cls !== undefined) {
		if (svg && typeof o.cls === "string" && /\s/.test(o.cls)) {
			throw new Error(`InvalidCharacterError: the class token "${o.cls}" contains a space (createSvg needs an array)`);
		}
		const list = Array.isArray(o.cls) ? o.cls : o.cls.split(/\s+/).filter((c) => c !== "");
		if (list.some((c) => c === "")) throw new Error("Empty class name passed to a DOM helper");
		el.classList.add(...list);
	}
	if (o.text !== undefined) el.textContent = o.text;
	if (o.title !== undefined) el.setAttribute("title", o.title);
	if (o.type !== undefined) el.setAttribute("type", o.type);
	if (o.value !== undefined) (el as HTMLInputElement).value = o.value;
	if (o.attr) {
		for (const [k, v] of Object.entries(o.attr)) {
			if (v !== null) el.setAttribute(k, String(v));
		}
	}
}

export function createEl(tag: string, info?: string | DomInfo): HTMLElement {
	const el = document.createElement(tag);
	applyInfo(el, info);
	return el;
}

const proto = Element.prototype as unknown as Record<string, unknown>;

proto.createEl = function (this: Element, tag: string, info?: string | DomInfo): HTMLElement {
	const el = createEl(tag, info);
	this.appendChild(el);
	return el;
};
proto.createDiv = function (this: Element, info?: string | DomInfo): HTMLElement {
	return (this as unknown as { createEl: typeof createEl }).createEl("div", info);
};
proto.createSpan = function (this: Element, info?: string | DomInfo): HTMLElement {
	return (this as unknown as { createEl: typeof createEl }).createEl("span", info);
};
proto.createSvg = function (this: Element, tag: string, info?: string | DomInfo): SVGElement {
	const el = document.createElementNS(SVG_NS, tag);
	applyInfo(el, info, true);
	this.appendChild(el);
	return el as SVGElement;
};
proto.empty = function (this: Element): void {
	while (this.firstChild) this.removeChild(this.firstChild);
};
proto.addClass = function (this: Element, ...c: string[]): void {
	this.classList.add(...c);
};
proto.removeClass = function (this: Element, ...c: string[]): void {
	this.classList.remove(...c);
};
proto.toggleClass = function (this: Element, c: string | string[], on: boolean): void {
	for (const name of Array.isArray(c) ? c : [c]) this.classList.toggle(name, on);
};
proto.setText = function (this: Element, text: string): void {
	this.textContent = text;
};
proto.setAttr = function (this: Element, name: string, value: string | number | boolean | null): void {
	if (value === null) this.removeAttribute(name);
	else this.setAttribute(name, String(value));
};
proto.setCssProps = function (this: HTMLElement, props: Record<string, string>): void {
	for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
};

const g = globalThis as unknown as Record<string, unknown>;
g.createEl = createEl;
g.createDiv = (info?: string | DomInfo) => createEl("div", info);
g.createSpan = (info?: string | DomInfo) => createEl("span", info);
g.createFragment = () => document.createDocumentFragment();

/** jsdom has no PointerEvent. This stand-in carries the fields the plugin reads. */
if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === "undefined") {
	class PointerEventShim extends MouseEvent {
		readonly pointerId: number;
		readonly pointerType: string;
		constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
			super(type, init);
			this.pointerId = init.pointerId ?? 0;
			this.pointerType = init.pointerType ?? "mouse";
		}
	}
	(globalThis as unknown as Record<string, unknown>).PointerEvent = PointerEventShim;
}
