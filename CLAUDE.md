# Plugin Hone (Fragment) — notes pour Claude

Plugin Fragment (id `hone`, auteur Philippine Biojout). Un trait d'annotation ou une
sélection fait apparaître une barre qui ouvre un chat et des outils d'IA sur le passage visé.

## Stack & commandes
- TypeScript, bundlé par esbuild (`esbuild.config.mjs`), types via `@usefragment/core`.
- Deps runtime (plus de SDK OpenAI depuis le 2026-09-27, `main.js` ~3 Mo) : `pdfjs-dist` (build legacy, Codex lit les PDF), `zod` (arguments de l'atelier), `pdf-lib`, `qr-code-styling` (QR du scan), `fflate` (carnets reMarkable), `voice-glow` + `react`/`react-dom` (la lueur de la discussion orale, îlot React unique dans `ui/lueur.ts`).
- Scripts : `npm run build` (tsc --noEmit + esbuild prod), `npm test` (vitest run src), `npm run dev`.
- **node_modules pas versionné** : faire `npm install` avant un build à froid ; l'API Fragment se lit via l'usage, pas via le core.

## Tout en page (renderer), et plus d'API OpenAI (2026-09-27)
Tout tourne dans le renderer. Hone répond par **Codex** (compte ChatGPT, `codex login`) :
le SDK OpenAI, la clé API, la commande « Hone : clé API… », les modèles `gpt-5.4` et le plafond de
tokens ont été retirés. Seule clé : Gradium (la voix), dans `data.json`.
Exception connue : `scan/ocr/` (module d'Oscar, branché nulle part) appelle encore
`api.openai.com` avec une clé qu'on lui passe.
- `src/pont/protocole.ts` = les types de domaine (`Demande`/`Sortie(s)`/`Message`). Le streaming du
  chat passe par un **callback** `morceau` (plus d'IPC).

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
`src/` est rangé **par responsabilité**, un dossier par partie du projet. L'entrée esbuild est
**unique** : `src/main.ts` (page). Tous les imports internes sont relatifs.

```
src/
  main.ts               entrée page (esbuild) — ne bouge pas
  agentLayer.ts         orchestrateur par vue (le seul qui connaît toutes les pièces)
  fragment-env.d.ts     shim de types "fragment"
  interactions/         annotation.ts, declencheur.ts, traces.ts, zoneDuTrait.ts
  positionnement/       repere.ts, placement.ts, fenetre.ts
  composants/           BarreAgent.ts, BulleAgent.ts, ActionAgent.ts, VoixAgent.ts
  ui/                   ui.ts, animations.ts, onde.ts, lueur.ts, nettoyerSvg.ts
  cerveau/              moteur-codex.ts, consignes.ts, demande.ts, appel.ts, gradium.ts, outils-vault.ts, garde.ts, langue.ts, vault.ts
  pont/                 repondre.ts (façade), protocole.ts (types de domaine)
  reglages/             reglages.ts (clé Gradium + Modal de saisie, factice, atelierActif, codex)
  scan/                 scan.ts, relais.ts
  remarkable/           remarkable.ts (brancherRemarkable), tablette.ts, rmdoc.ts, synchro.ts, registre.ts, …
  codex/                transport.ts, rpc.ts, view.ts, codex.ts
  decor/                verre.ts
  tests/                TOUS les *.test.ts (vitest) — `npm test` = `vitest run src`
```
Règle d'équipe : chacun travaille dans son dossier, on limite les conflits de merge. Un nouveau
fichier va dans le dossier de sa responsabilité, jamais à plat dans `src/`.

## Composants (page)
- `agentLayer.ts` (racine) : LE chef d'orchestre, un par vue. Câble tout, tient `zone` (passage) + `trait`.
- `interactions/declencheur.ts` : trait neuf (crayon/surligneur) OU sélection souris (→ faux trait `selection-`) → barre.
- `interactions/zoneDuTrait.ts` : géométrie trait → plage `[from,to]`. `positionnement/repere.ts` : conversions client↔document + WidgetLayer.
- `interactions/registreTraces.ts` (RegistreTraces) : l'historique de la marge, **par document, tenu par le plugin** (le cœur remonte le calque à chaque fichier ouvert : un historique dans le calque se perdait) et écrit dans `traces.json` du dossier du plugin. Ajout et suppression s'écrivent tout de suite, le remappage après 300 ms. Suit rename/delete du vault. Un trait relu du disque est préfixé `perdu-` (le cœur ne persiste pas ses traits et renumérote dès `s1`).
- `interactions/traces.ts` (CarnetTraces) : les icônes d'une vue dans la marge gauche ; ne pose rien tant que le texte du document n'est pas chargé (la vue naît vide).
- `positionnement/fenetre.ts` : widget déplaçable/redimensionnable (Cadre). `positionnement/placement.ts` : maths de placement (aCote).
- `composants/BarreAgent.ts` : barre verticale (Toolbar) posée à côté du passage.
- `composants/BulleAgent` (chat), `composants/ActionAgent` (carte d'outil), `composants/VoixAgent` (oral : une lumière qui sort du bas du panneau et deux ronds ; un appel en direct, `cerveau/appel.ts` : Gradium (`cerveau/gradium.ts`) écoute le micro et repère seul la fin d'une phrase, Codex répond sans outils (`MoteurCodex.direOral`), Gradium le dit avec la voix d'Apolline. Clé Gradium dans data.json, commande « Hone : clé Gradium… » ; la page l'échange contre un jeton court passé en `?token=`. ■ coupe Hone, × raccroche. `appelFactice` pour les e2e).
- `ui/ui.ts` (atomes : OUTILS, boutonIcone, arc…), `ui/animations.ts` (éclore/résorber…), `ui/onde.ts` (le spectre en 5 bandes et le niveau d'une voix), `ui/lueur.ts` (le `VoiceBeam` de voice-glow, seul endroit où vit React).
- `decor/verre.ts` : lentille de verre décorative (feDisplacementMap) sur toute `.toolbar` — indépendant de l'agent, Chromium seulement.
- `ui/nettoyerSvg.ts` : assainit le SVG de « visualiser » avant affichage.
- `pont/repondre.ts` : la façade que les composants appellent (chat/outils/oral) + repli factice ; `pont/protocole.ts` : les types de domaine.
- `reglages/reglages.ts` : réglages (`loadData`/`saveData`), la clé Gradium et son Modal de saisie.
- `scan/scan.ts` + `scan/relais.ts` : « scanner une feuille » (fusionné depuis l'ex-plugin `scan`, 2026-09-26).
  `setupScan(this)` dans `main.ts::onload` pose une icône de ruban (`addRibbonIcon('qr-code', …)`)
  qui ouvre une `ScanModal` (QR code via `qr-code-styling`). Le QR pointe vers le site téléphone
  `https://philippinebiojout.github.io/Hone-web_scan/#<sessionId>` ; `scan/relais.ts` est le client WebSocket vers le
  worker Cloudflare `wss://hone-relay.lasky.workers.dev`. La photo reçue est rangée dans `Scans/`.
  Site + worker vivent dans le dépôt `github.com/PhilippineBiojout/Hone-web_scan` (dossiers `docs/` et `relay/`).
  Styles sous `.scan-popover` / `.scan-qr` en fin de `styles.css`.
- `codex/` : panneau de chat **Codex** (fusionné depuis l'ex-plugin `codex-on-fragment`, 2026-09-27).
  `brancherCodex(this, () => this.reglages.codex)` dans `main.ts::onload` pose une icône de ruban
  (`addRibbonIcon('bot', 'Open Codex')`) + la commande « Open Codex panel » qui révèle une `CodexView`
  (ItemView) dans le dock droit. **Code en anglais** (choix assumé : l'autre repo passe aussi en anglais).
  Pilote le binaire **`codex app-server`** en JSON-RPC sur stdin/stdout via
  `node:child_process` (résolu par le shim require de l'hôte — mêmes builtins que Node). 3 couches :
  `transport.ts` (spawn ; sur Windows passe par `cmd.exe /d /s /c` car `.cmd` non spawnable, kill via
  `taskkill /t`), `rpc.ts` (`JsonRpcClient` : 3 formes de messages — requête serveur `id+method`,
  réponse `id` seul, notification `method` seul), `view.ts` (`CodexView` : transcript + composer +
  boutons d'approbation Approve/For session/Decline ; streaming des deltas en direct). `codex.ts` câble
  tout et ouvre la vue par `workspace.getRightLeaf()` + `revealLeaf()` : ils existent dans le cœur
  (`Workspace.ts`) mais pas dans les types publiés `@usefragment/core` 0.1.0, d'où un cast local.
  Une feuille posée directement dans `rightSplit` (`createLeafInParent`) n'est jamais mise en page
  (0 × 0) : c'était le panneau invisible du 2026-09-27. E2e : `e2e/codex-installee.spec.ts` (vrai binaire).
  Config dans les réglages (`reglages.ts::CodexSettings` : `codexPath`, `model`, `approvalPolicy`,
  `sandbox`), lue paresseusement. Styles `.codex-*` en fin de `styles.css`. `cwd` = racine du coffre.
  ⚠️ `esbuild.config.mjs` externalise aussi les builtins préfixés `node:` (`...builtins.map(m => 'node:'+m)`)
  car `builtin-modules` ne liste que les noms nus — sans ça le bundle échoue sur `node:child_process`.

## Cerveau (page) — `src/cerveau/`
**La bulle, les outils et l'oral passent par Codex** (compte ChatGPT, pas de clé) :
- `moteur-codex.ts` : `demander(Demande) → Sortie`, singleton
  `ouvrirMoteurCodex`/`moteurCodexCourant`, appelé par `pont/repondre.ts`. Le passage entouré est
  recopié dans le texte de la demande (`citer`) : Codex ne voit ni l'écran ni le trait.
- `codex/serveur.ts` : un seul `codex app-server` pour la page ; un fil éphémère par demande, borné
  par le code : `environments: []` (ni shell ni fichiers), `approvalPolicy: never`, `web_search`
  live/disabled, nos outils du vault en `dynamicTools` (exécutés par nous sur `item/tool/call`),
  `outputSchema` par tour. Seule la réponse `final_answer` s'affiche (pas les « commentary »).
- **Visualiser choisit seul entre un dessin SVG et une image générée** : seul son profil a
  `image: true` (génération d'images de Codex, coupée par `features.image_generation: false` pour
  tous les autres fils) et reçoit `CONSIGNE_IMAGE`. L'image revient en base64 (item
  `imageGeneration`), `codex/images.ts` l'écrit dans `images/` du dossier du plugin, et la carte
  ne garde que le chemin (`ReponseOutil.image`), affiché par `getResourcePath`. E2e réel :
  `e2e/visualiser-image.spec.ts`.
- `codex/profils.ts` : par agent, vault oui/non, web oui/non, schéma, effort. Les consignes sont
  `BASE` + `MISSIONS` de `consignes.ts`. `bornesDe(agent, acces, extras)` ajoute les outils de la
  mémoire (`remember`, `note_preference`) et, si `atelierActif`, les six méta-outils de l'atelier et
  `CONSIGNES_ATELIER` ; le catalogue des fonctions arrive en tête de la demande. `titre` n'a rien de
  tout ça. Schémas des outils : `codex/schema.ts`. E2e réel : `e2e/atelier-codex.spec.ts`.
- `demande.ts` : `citer` (le passage tel que Codex le lit), `ErreurAgent`, `AgentEnPause`.
- Le factice ne sert plus qu'avec le réglage `factice: true` (e2e). E2e réel : `e2e/codex-installee.spec.ts`. Lanceur et gestes communs des e2e : `e2e/hone-commun.ts`.
- `vault.ts` : `AccesVault` sur l'API native `app.vault` (getFiles/cachedRead/getFileByPath) — interface injectable, testable avec un faux (`src/tests/`).
- `outils-vault.ts` : `chercherDansLeVault`, `lireDocument` (LECTURE seule, **async**), exposés à Codex par `codex/profils.ts`.
  Ils lisent aussi les PDF (`pdf.ts`, pdf.js embarqué, sans worker via `globalThis.pdfjsWorker`) :
  texte par page, et les pages sans texte (carnets reMarkable, scans) rendues en image et rendues à
  Codex en `inputImage` (`ContenuOutil` de `codex/serveur.ts`). Les consignes lui interdisent de
  demander une capture : il va lire. E2e réel : `e2e/lire-tout-codex.spec.ts`.
- `garde.ts` : validation de forme des chemins (pas d'absolu/dotfiles/.fragment, .md/.txt) ; la portée au vault est assurée par `app.vault`. Refus RENDU au modèle.
- `langue.ts` : langue majoritaire du vault (pour Traduire), sur `app.vault`.
- Repli factice (`pont/repondre.ts`) : seulement avec le réglage `factice` → réponses factices.

## Contraintes / conventions
- Tout en **français** (code, commentaires, UI). Commentaires denses, style narratif.
- Cycle de vie Fragment : tout se `register` sur un `Component` et se défait au démontage.
- La clé Gradium vit dans les données du plugin, en page (modèle Obsidian assumé) : on ne l'écrit jamais ailleurs.
