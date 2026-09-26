# Hone — plugin Fragment

Plugin Fragment (id **`hone`**). Un **trait d'annotation** (crayon / surligneur) ou une
**sélection souris** sur un passage fait apparaître une **barre** qui ouvre un **chat** et des
**outils d'IA** posés sur ce passage (définir, résumer, traduire, aider, visualiser…). Le plugin
embarque aussi une fonction **scan** : un QR code permet d'envoyer une photo depuis le téléphone
vers le vault.

> Note technique détaillée pour l'assistant : voir [`CLAUDE.md`](./CLAUDE.md).
> Tout le code, les commentaires et l'UI sont en **français**.

---

## Démarrage

```bash
npm install        # node_modules n'est pas versionné
npm run build      # tsc --noEmit + esbuild (prod) → main.js
npm run dev        # esbuild en watch
npm test           # vitest run src  (tests unitaires dans src/tests/)
```

- **Le bundle `main.js` n'est PAS versionné** (artefact de build). Après un clone frais, lancer
  `npm install && npm run build` **avant** que Fragment puisse charger le plugin.
- **Clé OpenAI** : dans Fragment, lancer la commande **« Hone : clé API… »** et coller la clé.
  Elle est rangée dans les données du plugin (`loadData`/`saveData`), pas dans un `.env`. Sans
  clé, Hone répond en **mode factice**.
- **Fragment verrouille les dossiers des plugins chargés** : fermer l'app avant de supprimer /
  renommer un dossier, et la redémarrer pour recharger un plugin rebuildé.

---

## Où tourne OpenAI : dans la page

**Tout tourne dans le renderer** (plus de procès Node séparé, depuis le 2026-09-26). La CSP de
Fragment autorise `connect-src … https:` (donc `api.openai.com`), et le renderer a Node
(`nodeIntegration`) : le SDK OpenAI est bundlé dans `main.js` et appelé en page, dans `src/cerveau/`.

- La **clé** vit dans les données du plugin (`Plugin.loadData/saveData`), saisie par un Modal
  (commande « Hone : clé API… »). Conséquence assumée, à la manière d'Obsidian : la clé est
  lisible en page.
- [`src/pont/protocole.ts`](./src/pont/protocole.ts) porte les **types de domaine** (`Demande` /
  `Sortie` / `Message`) ; le chat se streame par un simple **callback** (plus d'IPC).

---

## Structure des dossiers

`src/` est rangé **par responsabilité** (un dossier par partie). L'entrée esbuild est unique :
`src/main.ts`.

| Dossier / fichier | Rôle |
|---|---|
| `main.ts` | Point d'entrée. `onload()` charge les réglages, ouvre le cerveau, enregistre le calque `hone` (un par vue), ajoute la commande « clé API », pose la lentille de verre et branche le scan. |
| `agentLayer.ts` | **L'orchestrateur** par vue : le seul fichier qui connaît toutes les pièces. Tient l'état `zone` (passage) + `trait`. |
| `fragment-env.d.ts` | Shim de types pour l'import `fragment`. |
| **`interactions/`** | Ce qui déclenche et ancre l'agent. |
| ├ `annotation.ts` | Adaptateur vers le plugin d'annotation du cœur (strokes, gomme, événements). |
| ├ `declencheur.ts` | Détecte trait (crayon/surligneur) ou sélection → demande la barre. |
| ├ `zoneDuTrait.ts` | Géométrie pure : forme du trait → plage de texte `[from, to]`. |
| └ `traces.ts` | `CarnetTraces` : historique en mémoire, une icône par réponse fermée dans la marge. |
| **`positionnement/`** | Géométrie et placement des widgets. |
| ├ `repere.ts` | Le hub de coordonnées d'une vue : `WidgetLayer` + conversions client↔document. |
| ├ `placement.ts` | Maths de placement (`aCote` : coin d'un widget à côté d'une boîte). |
| └ `fenetre.ts` | Widget déplaçable / redimensionnable (`Fenetre`, `Cadre`) + gestes. |
| **`composants/`** | Les widgets UI (chacun un `Component`). |
| ├ `BarreAgent.ts` | La barre verticale (Toolbar) posée à côté du passage. |
| ├ `BulleAgent.ts` | La bulle de **chat** (réponse streamée). |
| ├ `ActionAgent.ts` | La **carte d'outil** (le rond réfléchit puis fleurit en carte). |
| └ `VoixAgent.ts` | La **discussion orale** (micro, `MediaRecorder`, onde, TTS). |
| **`ui/`** | Atomes partagés. |
| ├ `ui.ts` | Table `OUTILS`, `boutonIcone`, `arc`, `proteger`, `PiedSupprimer`. |
| ├ `animations.ts` | Gestes Web-Animations (`eclore`, `resorber`, `rallonger`, `ressort`) + `creer`. |
| ├ `onde.ts` | La waveform à 5 barres de la voix. |
| └ `nettoyerSvg.ts` | Assainit le SVG produit par « visualiser » avant affichage. |
| **`pont/`** | Façade + types de domaine. |
| ├ `repondre.ts` | Façade appelée par les widgets (`repondre`, `agir`, `parler`, `resumerOral`) + repli factice. |
| └ `protocole.ts` | Les types de domaine (`Demande` / `Sortie` / `Message`). |
| **`cerveau/`** | Le moteur IA, en page. |
| ├ `moteur.ts` | Construit les agents avec la clé, streame le chat, plafond, erreurs. Singleton `ouvrirMoteur`/`moteurCourant`. |
| ├ `agents.ts` | Un `Agent` par mission (+ sorties zod). |
| ├ `outils-vault.ts` | Outils **lecture seule** : `search_vault`, `read_document` (async, sur `app.vault`). |
| ├ `vault.ts` | `AccesVault` sur l'API native `app.vault` (injectable, testable). |
| ├ `garde.ts` | Validation de forme des chemins ; la portée au vault vient d'`app.vault`. |
| ├ `couts.ts` | Compte les tokens en mémoire + plafond de session. |
| └ `langue.ts` | Détecte la langue du vault (FR/EN) sans appel modèle. |
| **`reglages/`** | |
| └ `reglages.ts` | La clé API (`loadData`/`saveData`) et son Modal de saisie. |
| **`scan/`** | Fonction « scanner une feuille ». |
| ├ `scan.ts` | Icône ruban + `ScanModal` (QR via `qr-code-styling`) ; range la photo dans `Scans/`. |
| └ `relais.ts` | Client WebSocket vers le worker Cloudflare qui relaie le téléphone. |
| **`decor/`** | |
| └ `verre.ts` | Lentille de verre décorative sur les `.toolbar` (indépendant de l'agent, Chromium). |
| **`tests/`** | Les tests unitaires vitest (`npm test` = `vitest run src`). |
| `e2e/` | Specs Playwright (voir la note *Tests* plus bas). |
| `styles.css` | Feuille **unique** (convention Fragment), sectionnée par bannières alignées sur les dossiers. |

---

## Les flux principaux

### 1. Déclenchement de la barre
```
trait (crayon/surligneur) ─┐
sélection souris ──────────┴─► declencheur ─► zoneDuTrait (plage [from,to])
                                             ─► repere (ancre + coords)
                                             ─► agentLayer ─► BarreAgent (à côté du passage)
```

### 2. Chat (réponse streamée)
```
BulleAgent ─► pont/repondre.repondre ─► cerveau/moteur.demander
   ▲                                          │  { agent:'chat', passage, question, historique }
   │  morceau, morceau, …                     ▼
   └──────── texte final ◄── run(@openai/agents) + outils (search_vault/read_document sur app.vault) ─► OpenAI
```
Sans clé (ou réglage factice) → réponse factice.

### 3. Outil (carte)
```
BarreAgent ─► ActionAgent ─► pont/repondre.agir ─► cerveau/moteur ─► carte de résultat
                                                   (« visualiser » : SVG passé par ui/nettoyerSvg)
```

### 4. Voix (discussion orale)
```
VoixAgent (micro + MediaRecorder + ui/onde) ─► pont/repondre.parler ─► factice « Gradium » (voix pas encore branchée)
```

### 5. Traces (historique dans la marge)
```
réponse fermée ─► agentLayer/CarnetTraces ─► icône dans la marge gauche ─► clic = ré-ouverture
(les positions sont remappées à chaque édition du document)
```

### 6. Scan (QR → photo)
```
main.brancherScan ─► icône ruban 'qr-code' ─► ScanModal (QR: SITE_URL#sessionId)
téléphone (github.com/RebornFlamme/Hone) ─► worker Cloudflare (wss://hone-relay.lasky.workers.dev)
                                          ─► scan/relais ─► photo rangée dans Scans/
```
Le site téléphone (`docs/`) et le worker (`relay/`) vivent dans le dépôt
[`github.com/RebornFlamme/Hone`](https://github.com/RebornFlamme/Hone), **hors de ce plugin**.

### 7. Décor (indépendant de l'agent)
```
main.poserLeVerre ─► verre ─► lentille de verre (feDisplacementMap + backdrop-filter) sur les .toolbar
```

---

## Tests & build

- **Unitaires** : `npm test` → `vitest run src` (les `*.test.ts` dans `src/tests/` :
  géométrie, sanitizer SVG, onde, placement, garde, outils-vault sur un faux vault).
- **Build** : `npm run build` = `tsc --noEmit` (strict, `verbatimModuleSyntax`) puis esbuild —
  **une seule entrée**, la page (`src/main.ts` → `main.js`, ~1,9 Mo car le SDK OpenAI y est bundlé).
- **E2E** : les specs Playwright de `e2e/` ne sont pas encore branchées au tooling (pas de
  `playwright.config`, pas de script npm, `@playwright/test` non déclaré dans `package.json`) —
  chantier à part.

---

## Conventions

- Français partout ; commentaires denses, style narratif.
- Cycle de vie Fragment : tout se `register` sur un `Component` et se défait au démontage.
- La clé OpenAI vit dans les données du plugin (page), modèle Obsidian assumé ; scrubée des logs (`sk-…`).
- Un nouveau fichier va dans le dossier de sa responsabilité, **jamais à plat** dans `src/`.
