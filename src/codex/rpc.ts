/*
 * A tiny JSON-RPC 2.0-ish client over the Codex transport. It distinguishes the
 * three inbound message shapes exactly as the reference implementation does:
 *   - id + method  → the server is asking us something (approval, input). We MUST
 *                     answer with `{ id, result }` or Codex stalls.
 *   - id, no method → a reply to one of our own requests → resolve its Promise.
 *   - method, no id → a notification (streaming events).
 */

import type { AppServerTransport } from "./transport";

export type Json = Record<string, unknown>;

interface Incoming {
	id?: number | string;
	method?: string;
	params?: Json;
	result?: unknown;
	error?: { code?: number; message?: string };
}

interface Pending {
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
}

export class JsonRpcClient {
	private nextId = 1;
	private readonly pending = new Map<number | string, Pending>();

	constructor(
		private readonly transport: AppServerTransport,
		private readonly onNotification: (method: string, params: Json) => void,
		private readonly onServerRequest: (
			id: number | string,
			method: string,
			params: Json,
		) => void,
	) {}

	handleLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) return;
		let msg: Incoming;
		try {
			msg = JSON.parse(trimmed) as Incoming;
		} catch {
			return; // not JSON (stray log line) — ignore
		}

		if (msg.id !== undefined && typeof msg.method === "string") {
			this.onServerRequest(msg.id, msg.method, msg.params ?? {});
			return;
		}
		if (msg.id !== undefined && (msg.result !== undefined || msg.error)) {
			const pending = this.pending.get(msg.id);
			if (!pending) return;
			this.pending.delete(msg.id);
			if (msg.error) pending.reject(new Error(msg.error.message ?? "rpc error"));
			else pending.resolve(msg.result);
			return;
		}
		if (typeof msg.method === "string") {
			this.onNotification(msg.method, msg.params ?? {});
		}
	}

	request<T = unknown>(method: string, params?: Json): Promise<T> {
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
			this.transport.send({ id, method, params });
		});
	}

	notify(method: string, params?: Json): void {
		this.transport.send({ method, params });
	}

	respond(id: number | string, result: Json): void {
		this.transport.send({ id, result });
	}

	rejectAll(reason: unknown): void {
		for (const p of this.pending.values()) p.reject(reason);
		this.pending.clear();
	}
}
