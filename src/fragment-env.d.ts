// Ambient shim so TypeScript can resolve `import ... from "fragment"`.
//
// @usefragment/core ships the type contract, but its own `declare module
// 'fragment'` block lives inside a *module* file and therefore does not register
// program-wide when the package is only pulled in via the tsconfig `"types"`
// array. This file re-declares the module from a *global script* (note: it has
// no top-level `import`/`export`, which is what keeps it global), so the
// declaration takes effect for `src/main.ts`.
//
// It is types-only and never imported by `src/main.ts`, so esbuild does not
// bundle it — only `tsc` sees it.
declare module "fragment" {
	export * from "@usefragment/core";
}

// Le code du worker de pdf.js, exécuté dans la page (cerveau/pdf.ts) : le paquet ne le type pas.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
    export const WorkerMessageHandler: unknown;
}
