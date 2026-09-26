# Plugin Agent (Fragment) — notes pour Claude

Plugin Fragment (id `agent`, auteur Philippine Biojout). Un trait d'annotation ou une
sélection fait apparaître une barre qui ouvre un chat et des outils d'IA sur le passage visé.

## Stack & commandes
- TypeScript, bundlé par esbuild (`esbuild.config.mjs`), types via `@usefragment/core`.
- Deps runtime : `@openai/agents`, `zod`, `qr-code-styling` (le QR du scan, bundlé dans main.js).
- Scripts : `npm run build` (tsc --noEmit + esbuild prod), `npm test` (vitest run src), `npm run dev`.
- **node_modules pas versionné** : faire `npm install` avant un build à froid ; l'API Fragment se lit via l'usage, pas via le core.

## Deux mondes, séparés par un procès
- **Page (renderer)** : `src/main.ts` + tout le reste de `src/` sauf `src/serveur/`. Extend `Plugin`,
  s'enregistre via `registerLayer` (un calque par vue) et `register`/`registerEvent`.
- **Procès agent (Node)** : `src/serveur/*` → bundlé en `agent-serveur.js`. Forké par `pont/lienAgent.ts`
  avec le binaire Electron en mode Node (`ELECTRON_RUN_AS_NODE=1`). **Lui seul lit `.env`
  (OPENAI_API_KEY) et parle à OpenAI** — la CSP de la page bloque api.openai.com et la clé y serait lisible.
- IPC typé dans `src/pont/protocole.ts` (contrat PARTAGÉ : le serveur l'importe via `../pont/protocole`) :
  `Requete{id,demande}` → `Retour{morceau|fin|erreur|pause}`.
  `morceau` = streaming du chat ; `pause` = AGENT_BLOQUE=1 ; délai 90 s relancé à chaque morceau.

## Positionnement vs API Fragment
Utilise : `Plugin`, `Component`, `Toolbar`/`ToolbarItem`, `WidgetLayer`/`WidgetHandle`/`WidgetAnchor`
(ancres gutter/document/viewport), `OverlayHost.clientToDocument`, `TextSurface` (getLine, offsetToPos,
coordsForRange, coordsAtPos, posAtCoords, getSelection, onChange+mapPos, addLayer/markers, requestUpdate),
`setIcon`, `app.workspace.on('file-open')`.
Contourne ce que le core n'expose pas encore (points à remonter au cœur) :
- `interactions/annotation.ts` : pas d'API d'annotation → passe par le registre interne `app.plugins.plugins.get('annotation').source` (strokes/erase/on('change')).
- `positionnement/repere.ts::versClient` : réimplémente l'inverse de `clientToDocument`.
- `interactions/traces.ts::texteEntre` : reconstruit le texte d'une plage ligne à ligne (pas de getRange).
- `agentLayer.ts::hasText` : garde de type en attendant que le cœur l'exporte.

## Structure des dossiers (rangement du 2026-09-26)
`src/` est rangé **par responsabilité**, un dossier par partie du projet. Les deux points
d'entrée esbuild (`src/main.ts` page, `src/serveur/agent-serveur.ts` procès) restent en place.
Tous les imports internes sont relatifs.

```
src/
  main.ts               entrée page (esbuild) — ne bouge pas
  agentLayer.ts         orchestrateur par vue (le seul qui connaît toutes les pièces)
  fragment-env.d.ts     shim de types "fragment"
  interactions/         annotation.ts, declencheur.ts, traces.ts, zoneDuTrait.ts
  positionnement/       repere.ts, placement.ts, fenetre.ts
  composants/           BarreAgent.ts, BulleAgent.ts, ActionAgent.ts, VoixAgent.ts
  ui/                   ui.ts, animations.ts, onde.ts, nettoyerSvg.ts
  pont/                 repondre.ts, lienAgent.ts, protocole.ts (contrat partagé page↔serveur)
  scan/                 scan.ts, relais.ts
  decor/                verre.ts
  serveur/              procès Node (agent-serveur, agents, outils-vault, garde, couts, langue)
  tests/                TOUS les *.test.ts (vitest) — `npm test` = `vitest run src`
```
Règle d'équipe : chacun travaille dans son dossier, on limite les conflits de merge. Un nouveau
fichier va dans le dossier de sa responsabilité, jamais à plat dans `src/`.

## Composants (page)
- `agentLayer.ts` (racine) : LE chef d'orchestre, un par vue. Câble tout, tient `zone` (passage) + `trait`.
- `interactions/declencheur.ts` : trait neuf (crayon/surligneur) OU sélection souris (→ faux trait `selection-`) → barre.
- `interactions/zoneDuTrait.ts` : géométrie trait → plage `[from,to]`. `positionnement/repere.ts` : conversions client↔document + WidgetLayer.
- `interactions/traces.ts` (CarnetTraces) : historique en mémoire, une icône par réponse fermée dans la marge gauche ; remappée à l'édition.
- `positionnement/fenetre.ts` : widget déplaçable/redimensionnable (Cadre). `positionnement/placement.ts` : maths de placement (aCote).
- `composants/BarreAgent.ts` : barre verticale (Toolbar) posée à côté du passage.
- `composants/BulleAgent` (chat), `composants/ActionAgent` (carte d'outil), `composants/VoixAgent` (oral, back factice → « Gradium »).
- `ui/ui.ts` (atomes : OUTILS, boutonIcone, arc…), `ui/animations.ts` (éclore/résorber…), `ui/onde.ts` (les 5 barres).
- `decor/verre.ts` : lentille de verre décorative (feDisplacementMap) sur toute `.toolbar` — indépendant de l'agent, Chromium seulement.
- `ui/nettoyerSvg.ts` : assainit le SVG de « visualiser » avant affichage.
- `pont/repondre.ts` + `pont/lienAgent.ts` : le pont vers le procès (façade + fork IPC) ; `pont/protocole.ts` : le contrat de types partagé.
- `scan/scan.ts` + `scan/relais.ts` : « scanner une feuille » (fusionné depuis l'ex-plugin `scan`, 2026-09-26).
  `brancherScan(this)` dans `main.ts::onload` pose une icône de ruban (`addRibbonIcon('qr-code', …)`)
  qui ouvre une `ScanModal` (QR code via `qr-code-styling`). Le QR pointe vers le site téléphone
  `https://rebornflamme.github.io/Hone/#<sessionId>` ; `scan/relais.ts` est le client WebSocket vers le
  worker Cloudflare `wss://hone-relay.lasky.workers.dev`. La photo reçue est rangée dans `Scans/`.
  Site + worker vivent dans le dépôt `github.com/RebornFlamme/Hone` (dossiers `docs/` et `relay/`).
  Styles sous `.scan-popover` / `.scan-qr` en fin de `styles.css`.

## Agents (serveur)
- `agents.ts` : un `Agent` @openai/agents par mission (chat, definir, resumer, traduire, aider, visualiser, bilan),
  modèle fort/léger (`gpt-5.4`/`gpt-5.4-mini`), sorties structurées zod. Prompt BASE : vault d'abord, contenu = DONNÉE.
- Outils : `outils-vault.ts` (search_vault, read_document, LECTURE seule) + webSearchTool pour certains.
- `garde.ts` : bac à sable disque (pas d'absolu, pas de dotfiles/.fragment, pas de symlink dehors, .md/.txt, taille max) ; refus RENDU au modèle.
- `couts.ts` : journalise les tokens dans `couts.jsonl`, plafond de session (AGENT_PLAFOND_TOKENS).
- Modes de repli (`repondre.ts`) : sans `.env`, AGENT_FACTICE=1 ou AGENT_BLOQUE=1 → réponses factices.

## Contraintes / conventions
- Tout en **français** (code, commentaires, UI). Commentaires denses, style narratif.
- Cycle de vie Fragment : tout se `register` sur un `Component` et se défait au démontage.
- Ne jamais faire fuir la clé : supprimée de l'env après lecture, scrubée des logs (`sk-…`).
