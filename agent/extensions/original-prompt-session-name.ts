/**
 * Preserve the first submitted input as the session's /resume display name.
 *
 * Install: ~/.pi/agent/extensions/original-prompt-session-name.ts
 * Activate: /reload, or restart Pi.
 *
 * Uses only public extension APIs. Does not transform input or model context,
 * overwrite manual names, or retroactively name existing conversations.
 * Remove this file to disable future automatic naming. Saved names remain
 * editable with /name.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const METADATA_TYPE = "original-prompt-session-name";

interface PendingInput {
	sessionId: string;
	originalInput: string;
	// Set only once Pi accepts the input for an ordinary user run.
	expectedPrompt?: string;
}

function hasUserMessage(ctx: ExtensionContext): boolean {
	// Inspect the whole session, not just the active branch: returning to an
	// empty branch of an existing conversation must not rename that session.
	return ctx.sessionManager.getEntries().some(
		(entry) => entry.type === "message" && entry.message.role === "user",
	);
}

function hasSavedInput(ctx: ExtensionContext): boolean {
	return ctx.sessionManager.getEntries().some(
		(entry) => entry.type === "custom" && entry.customType === METADATA_TYPE,
	);
}

function displayName(input: string): string {
	// Keep all words/arguments searchable; let Pi truncate the visible row.
	// Avoid multiline names and terminal control characters in the picker.
	return input.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
}

export default function originalPromptSessionName(pi: ExtensionAPI) {
	let pending: PendingInput | undefined;

	pi.on("session_start", () => {
		pending = undefined;
	});

	pi.on("session_shutdown", () => {
		pending = undefined;
	});

	pi.on("input", (event, ctx) => {
		// Input arriving while the first run is starting/streaming is queued
		// work, not a replacement for the original session input.
		if (!ctx.isIdle()) return { action: "continue" };

		pending = undefined;
		if (event.source === "extension" || hasUserMessage(ctx) || hasSavedInput(ctx)) {
			return { action: "continue" };
		}

		const text = event.text.trim();
		if (!text || text.startsWith("!")) return { action: "continue" };

		if (text.startsWith("/")) {
			const commandName = text.slice(1).split(/\s/, 1)[0];
			const commands = pi.getCommands().filter((command) => command.name === commandName);
			// Only prompt templates and skill invocations submit a prompt.
			// Extension commands take precedence over a same-named template.
			if (
				commands.some((command) => command.source === "extension") ||
				!commands.some((command) => command.source === "prompt" || command.source === "skill")
			) {
				return { action: "continue" };
			}
		}

		pending = {
			sessionId: ctx.sessionManager.getSessionId(),
			originalInput: event.text,
		};
		return { action: "continue" };
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (!pending) return;
		if (
			event.messageType !== "user" ||
			pending.sessionId !== ctx.sessionManager.getSessionId() ||
			hasSavedInput(ctx)
		) {
			pending = undefined;
			return;
		}
		pending.expectedPrompt = event.prompt;
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "user") return;

		const captured = pending;
		pending = undefined;
		if (
			!captured ||
			captured.expectedPrompt === undefined ||
			captured.sessionId !== ctx.sessionManager.getSessionId() ||
			hasSavedInput(ctx)
		) return;

		const content = event.message.content;
		const prompt = typeof content === "string"
			? content
			: content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
		if (prompt !== captured.expectedPrompt) return;

		// Some runtimes persist the message before notifying extensions;
		// others finalize it after this hook. Allow only this first message.
		const users = ctx.sessionManager.getEntries().filter(
			(entry) => entry.type === "message" && entry.message.role === "user",
		);
		if (users.length > 1) return;
		if (users.length === 1) {
			const first = users[0];
			if (first.type !== "message" || first.message.timestamp !== event.message.timestamp) return;
		}

		const name = displayName(captured.originalInput);
		if (!name) return;

		// Custom entries are durable metadata, excluded from model context.
		pi.appendEntry(METADATA_TYPE, {
			version: 1,
			originalInput: captured.originalInput,
			displayName: name,
		});
		if (!pi.getSessionName()) pi.setSessionName(name);
	});
}
