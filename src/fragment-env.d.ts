// Pour que TypeScript résolve `from 'fragment'` (types seulement, jamais bundlé).
declare module "fragment" {
	export * from "@usefragment/core";
}
