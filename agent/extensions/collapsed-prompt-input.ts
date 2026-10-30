/**
 * Show submitted prompt-template commands instead of their expanded instructions.
 * /reload to activate. Ctrl+O uses Pi's existing app.tools.expand action.
 * Only transcript rendering is transformed; model messages remain untouched.
 * Original inputs are saved as non-context metadata for reload/resume.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

const METADATA_TYPE = "collapsed-prompt-input";
interface InputRecord {
	version: 1;
	original: string;
	expanded: string;
	userTimestamp?: number;
}

export default function collapsedPromptInput(pi: ExtensionAPI) {
	const pending: string[] = [];
	const records: InputRecord[] = [];
	let active: InputRecord | undefined;
	let context: ExtensionContext | undefined;
	let tui: TUI | undefined;
	let unsubscribe: (() => void) | undefined;
	let generation = 0;

	const redraw = () => {
		// Markdown caches transformed output by source and width. A render
		// request alone will not refresh a collapsed user message.
		tui?.invalidate();
		tui?.requestRender();
	};

	pi.registerMarkdownTransformer((markdown, renderContext) => {
		if (renderContext.messageType !== "user" || context?.ui.getToolsExpanded()) return markdown;
		// Renderer timestamps belong to session entries, not necessarily the
		// message itself. Match the message timestamp recorded in metadata.
		const entry = renderContext.messageId ? context?.sessionManager.getEntries().find(
			(item) => item.id === renderContext.messageId,
		) : undefined;
		const timestamp = entry?.type === "message" && entry.message.role === "user"
			? entry.message.timestamp : undefined;
		const matches = records.filter((record) =>
			record.expanded === markdown &&
			(timestamp === undefined || record.userTimestamp === timestamp),
		);
		if (matches.length === 0) return markdown;
		// Do not choose an arbitrary original if different commands expand to
		// the same text and this live renderer has no message identity yet.
		const original = matches[0].original;
		return matches.every((record) => record.original === original) ? original : markdown;
	});

	pi.on("session_start", (_event, ctx) => {
		generation++;
		unsubscribe?.();
		unsubscribe = undefined;
		pending.length = 0;
		records.length = 0;
		active = undefined;
		context = ctx;
		tui = undefined;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom" || entry.customType !== METADATA_TYPE) continue;
			const data = entry.data as Partial<InputRecord> | undefined;
			if (data?.version === 1 && typeof data.original === "string" && typeof data.expanded === "string") {
				records.push(data as InputRecord);
			}
		}
		if (ctx.mode !== "tui") return;
		// An invisible widget supplies the public TUI reference without replacing
		// the editor, footer, or transcript components.
		ctx.ui.setWidget(METADATA_TYPE, (ui) => {
			tui = ui;
			return { render: () => [], invalidate: () => {} };
		});
		unsubscribe = ctx.ui.onTerminalInput(() => {
			const expanded = ctx.ui.getToolsExpanded();
			const currentGeneration = generation;
			// Observe the built-in action's state change instead of constructing
			// a keybindings manager (a type-only export). This also respects
			// remapped shortcuts without consuming or toggling the key twice.
			queueMicrotask(() => {
				if (generation === currentGeneration && ctx.ui.getToolsExpanded() !== expanded) redraw();
			});
		});
		queueMicrotask(redraw);
	});

	pi.on("session_shutdown", () => {
		generation++;
		unsubscribe?.();
		unsubscribe = undefined;
		context = undefined;
		tui = undefined;
		pending.length = 0;
		active = undefined;
	});

	pi.on("input", (event, ctx) => {
		// The public hooks do not identify queued/dequeued inputs. Leave those
		// unchanged rather than associate an expansion with the wrong input.
		if (ctx.mode !== "tui" || event.source === "extension" || !ctx.isIdle()) return { action: "continue" };
		pending.length = 0;
		const text = event.text.trim();
		if (!text || text.startsWith("!")) return { action: "continue" };
		if (text.startsWith("/")) {
			const name = text.slice(1).split(/\s/, 1)[0];
			const commands = pi.getCommands().filter((command) => command.name === name);
			if (commands.some((command) => command.source === "extension") ||
				!commands.some((command) => command.source === "prompt")) return { action: "continue" };
		}
		pending.push(event.text);
		return { action: "continue" };
	});

	pi.on("before_agent_start", (event) => {
		active = undefined;
		if (event.messageType !== "user") return;
		const original = pending.shift();
		if (original === undefined || original === event.prompt) return;
		active = { version: 1, original, expanded: event.prompt };
		records.push(active);
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "user" || !active) return;
		const text = typeof event.message.content === "string" ? event.message.content :
			event.message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
		if (text !== active.expanded) return;
		active.userTimestamp = event.message.timestamp;
		pi.appendEntry(METADATA_TYPE, { ...active });
		active = undefined;
		redraw();
	});
}
