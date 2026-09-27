/*
 * SessionCodex — the Codex panel's connection and DOM, owned by the plugin and
 * not by the view: closing the panel (collapsing the dock, or even closing the
 * leaf) leaves `codex app-server`, the thread and the transcript alive. A new
 * CodexView just borrows `racine`. Only `arreter()`, on plugin unload, stops it.
 *
 * Transcript + composer + inline approval buttons; streaming deltas append live.
 */

import { Notice, type App, setIcon } from "fragment";
import { vaultRoot } from "./racine";
import { AppServerTransport } from "./transport";
import { JsonRpcClient, type Json } from "./rpc";
import type { CodexSettings } from "../reglages/reglages";
import { rendreEnDirect } from "../ui/rendu";

export class SessionCodex {
	/** Built once, kept for the plugin's lifetime: views borrow it. */
	readonly racine: HTMLElement;
	private connectee = false;
	private transport: AppServerTransport | null = null;
	private rpc: JsonRpcClient | null = null;
	private threadId: string | null = null;

	// UI
	private statusEl!: HTMLElement;
	private transcriptEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;

	// Live streaming targets, keyed by the server's itemId.
	private readonly streams = new Map<string, HTMLElement>();
	/** Assistant replies: the raw Markdown received so far, and its renderer (ui/rendu.ts). */
	private readonly rawTexts = new Map<string, string>();
	private readonly renderers = new Map<string, ReturnType<typeof rendreEnDirect>>();

	constructor(
		private readonly appRef: App,
		private readonly getSettings: () => CodexSettings,
	) {
		this.racine = document.createElement("div");
		this.buildDom();
	}

	/** Puts the panel in a view's content element; connects the first time only. */
	attacher(conteneur: HTMLElement): void {
		conteneur.replaceChildren(this.racine);
		this.scrollToBottom();
		if (!this.connectee) {
			this.connectee = true;
			void this.connect();
		}
	}

	/** Takes the panel out of the DOM. The server, the thread and the transcript stay. */
	detacher(): void {
		this.racine.remove();
	}

	/** Stops the server: only when the plugin unloads. */
	arreter(): void {
		this.teardown();
	}

	// ── DOM ──────────────────────────────────────────────────────────────────

	private buildDom(): void {
		const root = this.racine;
		root.classList.add("codex-panel");

		const header = div(root, "codex-header");
		const iconEl = div(header, "codex-header__icon");
		setIcon(iconEl, "bot");
		const title = document.createElement("span");
		title.className = "codex-header__title";
		title.textContent = "Codex";
		header.append(title);
		this.statusEl = document.createElement("span");
		this.statusEl.className = "codex-header__status";
		header.append(this.statusEl);

		const restart = document.createElement("button");
		restart.className = "codex-header__restart";
		restart.title = "Restart Codex server";
		setIcon(restart, "refresh-cw");
		restart.addEventListener("click", () => void this.restart());
		header.append(restart);

		this.transcriptEl = div(root, "codex-transcript");

		const composer = div(root, "codex-composer");
		this.inputEl = document.createElement("textarea");
		this.inputEl.className = "codex-composer__input";
		this.inputEl.placeholder = "Ask Codex…  (Enter to send, Shift+Enter for newline)";
		this.inputEl.rows = 3;
		this.inputEl.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" && !evt.shiftKey) {
				evt.preventDefault();
				void this.send();
			}
		});
		composer.append(this.inputEl);

		this.sendBtn = document.createElement("button");
		this.sendBtn.className = "codex-composer__send";
		this.sendBtn.textContent = "Send";
		this.sendBtn.addEventListener("click", () => void this.send());
		composer.append(this.sendBtn);

		this.setBusy(true, "connecting…");
	}

	private setStatus(text: string): void {
		this.statusEl.textContent = text;
	}

	private setBusy(busy: boolean, status?: string): void {
		this.sendBtn.disabled = busy;
		this.inputEl.disabled = busy;
		if (status !== undefined) this.setStatus(status);
	}

	private addBubble(role: "user" | "assistant" | "reasoning" | "system", key?: string): HTMLElement {
		const bubble = div(this.transcriptEl, `codex-msg codex-msg--${role}`);
		const body = div(bubble, "codex-msg__body");
		if (key) this.streams.set(key, body);
		this.scrollToBottom();
		return body;
	}

	private streamInto(key: string, role: "assistant" | "reasoning", text: string): void {
		let target = this.streams.get(key);
		if (!target) target = this.addBubble(role, key);
		if (role === "reasoning") {
			target.textContent = (target.textContent ?? "") + text;
			this.scrollToBottom();
			return;
		}
		// Assistant replies are Markdown: keep the raw text, render it at most once per frame.
		const raw = (this.rawTexts.get(key) ?? "") + text;
		this.rawTexts.set(key, raw);
		let render = this.renderers.get(key);
		if (!render) {
			render = rendreEnDirect(target, {}, () => this.scrollToBottom());
			this.renderers.set(key, render);
		}
		render(raw);
	}

	private scrollToBottom(): void {
		this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
	}

	// ── Connection / handshake ─────────────────────────────────────────────────

	private async connect(): Promise<void> {
		const { codexPath, model, approvalPolicy, sandbox } = this.getSettings();
		const cwd = vaultRoot(this.appRef);

		this.transport = new AppServerTransport(codexPath, cwd, {
			onLine: (line) => this.rpc?.handleLine(line),
			onStderr: (line) => console.debug("[codex] stderr:", line),
			onExit: (code) => this.onServerExit(code),
		});
		this.rpc = new JsonRpcClient(
			this.transport,
			(method, params) => this.onNotification(method, params),
			(id, method, params) => this.onServerRequest(id, method, params),
		);

		try {
			this.transport.start();
		} catch (err) {
			this.fail(`could not spawn "${codexPath}": ${String(err)}`);
			return;
		}

		try {
			await this.rpc.request("initialize", {
				clientInfo: { name: "codex-on-fragment", title: "Codex on Fragment", version: "0.1.0" },
				capabilities: { experimentalApi: true },
			});
			this.rpc.notify("initialized");

			const started = await this.rpc.request<Json>("thread/start", {
				cwd,
				approvalPolicy,
				sandbox,
				...(model ? { model } : {}),
			});
			this.threadId = pickThreadId(started);
			if (!this.threadId) {
				this.fail("thread/start returned no threadId");
				return;
			}
			this.setBusy(false, "ready");
		} catch (err) {
			this.fail(`handshake failed: ${String(err)}`);
		}
	}

	private onServerExit(code: number | null): void {
		this.rpc?.rejectAll(new Error("server exited"));
		this.threadId = null;
		this.setBusy(true, `server exited (${code ?? "?"})`);
	}

	private fail(message: string): void {
		console.error("[codex]", message);
		new Notice(`Codex: ${message}`);
		this.setBusy(true, "error");
		const body = this.addBubble("system");
		body.textContent = message;
	}

	private async restart(): Promise<void> {
		this.teardown();
		this.transcriptEl.replaceChildren();
		this.streams.clear();
		for (const render of this.renderers.values()) render.annuler();
		this.renderers.clear();
		this.rawTexts.clear();
		this.setBusy(true, "reconnecting…");
		await this.connect();
	}

	private teardown(): void {
		this.transport?.stop();
		this.transport = null;
		this.rpc = null;
		this.threadId = null;
	}

	// ── Sending ────────────────────────────────────────────────────────────────

	private async send(): Promise<void> {
		const text = this.inputEl.value.trim();
		if (!text || !this.rpc || !this.threadId) return;
		this.inputEl.value = "";
		const body = this.addBubble("user");
		body.textContent = text;
		this.setBusy(true, "thinking…");

		try {
			await this.rpc.request("turn/start", {
				threadId: this.threadId,
				cwd: vaultRoot(this.appRef),
				input: [{ type: "text", text }],
			});
		} catch (err) {
			this.fail(`turn/start failed: ${String(err)}`);
		}
	}

	// ── Inbound notifications (streaming) ────────────────────────────────────────

	private onNotification(method: string, params: Json): void {
		const itemId = typeof params.itemId === "string" ? params.itemId : undefined;
		const delta = typeof params.delta === "string" ? params.delta : undefined;

		switch (method) {
			case "item/agentMessage/delta":
				if (itemId && delta) this.streamInto(itemId, "assistant", delta);
				break;

			case "item/reasoning/textDelta":
			case "item/reasoning/summaryTextDelta": {
				const text = delta ?? (typeof params.text === "string" ? params.text : "");
				if (itemId && text) this.streamInto(`reason:${itemId}`, "reasoning", text);
				break;
			}

			case "item/commandExecution/outputDelta":
				if (itemId && delta) {
					let target = this.streams.get(`cmd:${itemId}`);
					if (!target) {
						const bubble = div(this.transcriptEl, "codex-msg codex-msg--command");
						const pre = document.createElement("pre");
						pre.className = "codex-cmd__out";
						bubble.append(pre);
						target = pre;
						this.streams.set(`cmd:${itemId}`, pre);
					}
					target.textContent = (target.textContent ?? "") + delta;
					this.scrollToBottom();
				}
				break;

			case "turn/started":
				this.setBusy(true, "thinking…");
				break;

			case "turn/completed":
				this.setBusy(false, "ready");
				break;

			case "thread/tokenUsage/updated": {
				const usage = params.usage as Json | undefined;
				const total = usage && typeof usage.totalTokens === "number" ? usage.totalTokens : undefined;
				if (total !== undefined) this.setStatus(`${total} tokens`);
				break;
			}

			default:
				// Unhandled notifications (item/started, patchUpdated, diff/updated…)
				// are ignored in the minimal build — no state to maintain.
				break;
		}
	}

	// ── Inbound server requests (approvals / input) ──────────────────────────────

	private onServerRequest(id: number | string, method: string, params: Json): void {
		if (method.endsWith("requestApproval") || method === "item/tool/requestUserInput") {
			this.renderApproval(id, method, params);
			return;
		}
		// Any other server request still needs an answer or Codex stalls.
		this.rpc?.respond(id, { decision: "decline" });
	}

	private renderApproval(id: number | string, method: string, params: Json): void {
		const card = div(this.transcriptEl, "codex-approval");
		const label = div(card, "codex-approval__label");
		label.textContent = approvalSummary(method, params);

		const actions = div(card, "codex-approval__actions");
		const answer = (decision: string): void => {
			this.rpc?.respond(id, { decision });
			card.classList.add("is-answered");
			actions.replaceChildren();
			const done = document.createElement("span");
			done.className = "codex-approval__done";
			done.textContent = `→ ${decision}`;
			actions.append(done);
		};

		mkBtn(actions, "Approve", "mod-cta", () => answer("accept"));
		mkBtn(actions, "For session", "", () => answer("acceptForSession"));
		mkBtn(actions, "Decline", "mod-warning", () => answer("decline"));
		this.scrollToBottom();
	}
}

// ── small helpers ────────────────────────────────────────────────────────────

function div(parent: HTMLElement, className: string): HTMLElement {
	const el = document.createElement("div");
	el.className = className;
	parent.append(el);
	return el;
}

function mkBtn(
	parent: HTMLElement,
	label: string,
	cls: string,
	onClick: () => void,
): HTMLButtonElement {
	const btn = document.createElement("button");
	btn.textContent = label;
	if (cls) btn.className = cls;
	btn.addEventListener("click", onClick);
	parent.append(btn);
	return btn;
}

/** thread/start result may nest the id differently across CLI versions. */
function pickThreadId(res: Json | undefined): string | null {
	if (!res) return null;
	if (typeof res.threadId === "string") return res.threadId;
	const thread = res.thread as Json | undefined;
	if (thread && typeof thread.id === "string") return thread.id;
	if (typeof res.id === "string") return res.id;
	return null;
}

/** A human-readable one-liner for an approval request. */
function approvalSummary(method: string, params: Json): string {
	if (method.includes("commandExecution")) {
		const cmd = params.command ?? (params.item as Json | undefined)?.command;
		const text = Array.isArray(cmd) ? cmd.join(" ") : typeof cmd === "string" ? cmd : "";
		return `Run command: ${text || "(unknown)"}`;
	}
	if (method.includes("fileChange")) {
		return "Apply file changes to the workspace?";
	}
	if (method.includes("permissions")) {
		return "Grant requested permission?";
	}
	if (method.includes("requestUserInput")) {
		const reason = typeof params.reason === "string" ? params.reason : "";
		return `Codex needs input${reason ? `: ${reason}` : ""}`;
	}
	return `Approve: ${method}`;
}
