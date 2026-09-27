import type { App } from 'fragment';
import process from 'node:process';

/** Resolve the vault's absolute path — the `cwd` Codex runs in. Kept apart from
 *  view.ts so the Hone engine (and its tests) can use it without the view. */
export function vaultRoot(app: App): string {
	// The documented mechanism: the window is launched with `--vault-root=<abs>`,
	// which the host's racineDuCoffre() reads from argv. We read the same arg.
	const flag = "--vault-root=";
	const arg = process.argv.find((a) => a.startsWith(flag));
	if (arg) return arg.slice(flag.length);
	// Fallbacks: a public field if the host adds one, else the private adapter root.
	const anyApp = app as unknown as { vaultPath?: string };
	if (typeof anyApp.vaultPath === "string") return anyApp.vaultPath;
	const adapter = app.vault.adapter as unknown as {
		racine?: string;
		basePath?: string;
	};
	return adapter.racine ?? adapter.basePath ?? process.cwd();
}
