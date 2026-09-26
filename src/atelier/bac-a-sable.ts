// Le bac à sable où tourne le code que les agents écrivent. La page a Node complet
// (nodeIntegration, pas d'isolation) : une consigne ne suffit pas, il faut un lieu
// fermé. C'est un Web Worker neuf à chaque exécution :
// - il n'a pas Node (nodeIntegrationInWorker n'est pas activé par le cœur) ;
// - un prélude en LISTE BLANCHE efface de sa portée globale tout ce qui n'est pas le
//   langage lui-même (fetch, XHR, WebSocket, importScripts, indexedDB…), y compris
//   ce qu'un Chromium futur ajouterait ;
// - il échoue fermé : si une fuite subsiste, il n'exécute rien ;
// - il tourne sur un autre fil, et terminate() tue une boucle infinie sans geler l'app.
// Le code ne voit que `args` et `hone`, dont chaque méthode est un message au courtier
// (courtier.ts), le seul pont vers Fragment.

/** Une opération demandée au courtier par le code du bac à sable. */
export type Courtier = (op: string, params: Record<string, unknown>) => Promise<unknown>;

export interface Execution {
    ok: boolean;
    valeur?: unknown;
    erreur?: string;
    /** Ce que le code a noté par hone.journal(). */
    journal: string[];
}

/** Ce qu'on attend d'un worker : le Worker du navigateur, ou un faux dans les tests. */
export interface PortWorker {
    postMessage(message: unknown): void;
    onmessage: ((e: { data: unknown }) => void) | null;
    terminate(): void;
}

export type Fabrique = (source: string) => PortWorker;

export const DELAI_MS = 5_000;
export const CODE_MAX = 6_000;
export const RESULTAT_MAX = 20_000;
export const APPELS_MAX = 50;

/** Ce que le code garde de la portée globale : le langage, rien qui touche au monde. */
const GARDER = [
    'Object', 'Function', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math', 'JSON', 'Date',
    'RegExp', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'Reflect', 'Proxy', 'Intl',
    'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError', 'AggregateError',
    'ArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
    'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
    'NaN', 'Infinity', 'undefined', 'TextEncoder', 'TextDecoder', 'structuredClone',
    'setTimeout', 'clearTimeout', 'queueMicrotask',
];

/** Ce qui doit avoir disparu : si l'un d'eux existe encore, rien ne s'exécute. */
const FUITES = [
    'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'importScripts', 'Worker', 'SharedWorker',
    'indexedDB', 'caches', 'BroadcastChannel', 'navigator', 'location', 'WebAssembly', 'require', 'process',
    'postMessage', 'close', 'self', 'globalThis',
];

/**
 * Le prélude du worker. `verifierImport` : `import()` est une syntaxe, on ne peut pas
 * l'effacer ; en page c'est la CSP du cœur qui le ferme (script-src sans data: ni blob:),
 * et le prélude le vérifie. Node (les tests) l'autorise : on y saute ce contrôle.
 */
export function prelude(verifierImport = true): string {
    return `'use strict';
(() => {
    const G = self;
    const envoyer = G.postMessage.bind(G);
    const ecouter = G.addEventListener.bind(G);
    const AsyncFunction = (async function () {}).constructor;
    const garder = new Set(${JSON.stringify(GARDER)});
    for (let o = G; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
        for (const nom of Object.getOwnPropertyNames(o)) {
            if (garder.has(nom)) continue;
            try { delete o[nom]; } catch (e) {}
            try {
                if (Object.getOwnPropertyDescriptor(o, nom)) {
                    Object.defineProperty(o, nom, { value: undefined, writable: false, configurable: false });
                }
            } catch (e) {}
        }
    }
    const fuites = ${JSON.stringify(FUITES)}.filter((n) => { try { return typeof G[n] !== 'undefined'; } catch (e) { return false; } });
    const etanche = fuites.length > 0
        ? Promise.resolve('bac à sable non étanche (' + fuites.join(', ') + ')')
        : ${verifierImport
        ? `import('data:text/javascript,export default 1').then(() => 'bac à sable non étanche (import)', () => null)`
        : 'Promise.resolve(null)'};

    let suivant = 0;
    const attentes = new Map();
    const appel = (op, params) => new Promise((res, rej) => {
        const id = ++suivant;
        attentes.set(id, { res, rej });
        envoyer({ t: 'appel', id, op, params: params || {} });
    });
    const gel = (o) => Object.freeze(o);

    ecouter('message', async (e) => {
        const m = e.data;
        if (m && m.t === 'reponse') {
            const a = attentes.get(m.id);
            attentes.delete(m.id);
            if (a) m.ok ? a.res(m.valeur) : a.rej(new Error(m.erreur));
            return;
        }
        if (!m || m.t !== 'lancer') return;
        const journal = [];
        const refus = await etanche;
        if (refus) { envoyer({ t: 'fin', ok: false, erreur: refus, journal }); return; }
        const hone = gel({
            vault: gel({
                lister: () => appel('vault.lister'),
                chercher: (requete) => appel('vault.chercher', { requete }),
                lire: (chemin) => appel('vault.lire', { chemin }),
            }),
            commandes: gel({
                lister: () => appel('commandes.lister'),
                lancer: (id) => appel('commandes.lancer', { id }),
            }),
            ui: gel({ ouvrir: (chemin) => appel('ui.ouvrir', { chemin }) }),
            fonctions: gel({ appeler: (nom, args) => appel('fonctions.appeler', { nom, args: args || {} }) }),
            journal: (...x) => { if (journal.length < 50) journal.push(x.map((v) => typeof v === 'string' ? v : JSON.stringify(v)).join(' ').slice(0, 500)); },
        });
        try {
            const f = new AsyncFunction('args', 'hone', '"use strict";\\n' + m.code);
            const valeur = await f(m.args, hone);
            envoyer({ t: 'fin', ok: true, valeur: valeur === undefined ? null : JSON.parse(JSON.stringify(valeur)), journal });
        } catch (err) {
            envoyer({ t: 'fin', ok: false, erreur: String((err && err.message) || err).slice(0, 1000), journal });
        }
    });
})();`;
}

/** Le vrai worker : depuis un blob (la CSP du cœur autorise worker-src blob:). */
export const fabriqueNavigateur: Fabrique = (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    return w as unknown as PortWorker;
};

export interface OptionsExecution {
    delai?: number;
    fabrique?: Fabrique;
    verifierImport?: boolean;
}

/** Tronque un résultat trop gros pour le rendre au modèle. */
function borner(valeur: unknown): unknown {
    const texte = JSON.stringify(valeur) ?? 'null';
    return texte.length > RESULTAT_MAX ? `${texte.slice(0, RESULTAT_MAX)}… [résultat tronqué à ${RESULTAT_MAX} caractères]` : valeur;
}

/** Exécute `code` (le corps d'une fonction async (args, hone)) dans un worker neuf. Ne lève jamais. */
export function executer(
    code: string, args: unknown, courtier: Courtier, options: OptionsExecution = {},
): Promise<Execution> {
    if (typeof code !== 'string' || code.trim() === '') return Promise.resolve({ ok: false, erreur: 'Code vide.', journal: [] });
    if (code.length > CODE_MAX) {
        return Promise.resolve({ ok: false, erreur: `Code trop long (${code.length} caractères, ${CODE_MAX} au plus).`, journal: [] });
    }
    const { delai = DELAI_MS, fabrique = fabriqueNavigateur, verifierImport = true } = options;
    return new Promise((resoudre) => {
        let fini = false;
        let appels = 0;
        let worker: PortWorker | undefined;
        const finir = (r: Execution) => {
            if (fini) return;
            fini = true;
            clearTimeout(minuteur);
            worker?.terminate();
            resoudre(r);
        };
        const minuteur = setTimeout(
            () => finir({ ok: false, erreur: `Temps dépassé (${delai / 1000} s) : la fonction a été arrêtée.`, journal: [] }),
            delai,
        );
        try {
            worker = fabrique(prelude(verifierImport));
        } catch (err) {
            finir({ ok: false, erreur: `Bac à sable indisponible : ${String((err as Error)?.message ?? err)}`, journal: [] });
            return;
        }
        worker.onmessage = ({ data }) => {
            const m = data as { t: string; id?: number; op?: string; params?: Record<string, unknown> } & Execution;
            if (m.t === 'fin') {
                finir({ ok: m.ok, ...(m.ok ? { valeur: borner(m.valeur) } : { erreur: m.erreur }), journal: m.journal ?? [] });
                return;
            }
            if (m.t !== 'appel') return;
            const repondre = (ok: boolean, valeurOuErreur: unknown) => {
                if (!fini) worker.postMessage(ok ? { t: 'reponse', id: m.id, ok, valeur: valeurOuErreur } : { t: 'reponse', id: m.id, ok, erreur: valeurOuErreur });
            };
            if (++appels > APPELS_MAX) {
                repondre(false, `Trop d'appels à hone (${APPELS_MAX} au plus par exécution).`);
                return;
            }
            courtier(String(m.op), m.params ?? {}).then(
                (v) => repondre(true, v === undefined ? null : v),
                (err) => repondre(false, String((err as Error)?.message ?? err)),
            );
        };
        worker.postMessage({ t: 'lancer', code, args: args ?? {} });
    });
}
