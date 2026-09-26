/*
 * Codex transport — spawns `codex app-server` and frames stdin/stdout as
 * newline-delimited JSON (one JSON object per line).
 *
 * Ported from the codex-on-fragment plugin. Fragment gives community plugins
 * full Node access through its require shim (anything that isn't
 * "fragment"/"obsidian" is delegated to the renderer's real `require`), so
 * `node:child_process` + `node:readline` work exactly as on Obsidian.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as readline from "node:readline";
import process from "node:process";

const IS_WIN = process.platform === "win32";

export interface TransportHandlers {
	onLine: (line: string) => void;
	onStderr: (line: string) => void;
	onExit: (code: number | null) => void;
}

/** Spawns `codex app-server` and frames stdin/stdout as newline-delimited JSON. */
export class AppServerTransport {
	private child: ChildProcess | null = null;

	constructor(
		private readonly codexPath: string,
		private readonly cwd: string,
		private readonly handlers: TransportHandlers,
	) {}

	start(): void {
		// On Windows the installed entry is `codex.cmd`; a .cmd cannot be spawned
		// directly, so route through `cmd.exe /d /s /c`. On POSIX, spawn the binary.
		const [file, args] = IS_WIN
			? (["cmd.exe", ["/d", "/s", "/c", this.codexPath, "app-server"]] as const)
			: ([this.codexPath, ["app-server"]] as const);

		const child = spawn(file, [...args], {
			cwd: this.cwd,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		this.child = child;

		if (child.stdout) {
			readline
				.createInterface({ input: child.stdout })
				.on("line", this.handlers.onLine);
		}
		if (child.stderr) {
			readline
				.createInterface({ input: child.stderr })
				.on("line", this.handlers.onStderr);
		}
		child.on("exit", this.handlers.onExit);
		child.on("error", (err) => this.handlers.onStderr(String(err)));
	}

	send(msg: unknown): void {
		this.child?.stdin?.write(JSON.stringify(msg) + "\n");
	}

	stop(): void {
		const child = this.child;
		this.child = null;
		if (!child) return;
		if (IS_WIN && child.pid) {
			// Kill the whole cmd.exe → codex tree.
			try {
				spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
			} catch {
				/* best effort */
			}
		} else {
			try {
				child.kill();
			} catch {
				/* best effort */
			}
		}
	}
}
