# Hone — a Fragment plugin

Fragment plugin (id **`hone`**). An **annotation stroke** (pen / highlighter) or a **mouse
selection** on a passage brings up a **toolbar** that opens a **chat** and **AI tools** anchored on
that passage (define, summarize, translate, help, visualize…). The plugin also ships a **scan**
feature (a QR code links your phone, and the sheets you photograph become the pages of a PDF in the
vault), a **reMarkable** feature (the tablet's notebooks arrive live in the vault, as PDFs), and a
**Codex** panel: a chat in the right dock that drives the `codex app-server` binary (merged from the
former `codex-on-fragment` plugin).

> Detailed technical notes for the assistant: see [`CLAUDE.md`](./CLAUDE.md).
> The code, its comments and the UI are in **French** — **exception**: `src/codex/` is in English
> (taken as is from `codex-on-fragment`).

---

## Installation

Hone is a Fragment **community plugin**: a folder inside your vault that Fragment loads at startup.
You need four things: Fragment, the built plugin, Codex (the AI) and, for the scan, the website and
relay from [`Hone-web_scan`](https://github.com/PhilippineBiojout/Hone-web_scan).

### 1. Fragment

Download the app from **[usefragment.org](https://www.usefragment.org)** (Windows; macOS at
[usefragment.org/download/mac](https://www.usefragment.org/download/mac)), then open a folder as a
vault. The plugin API types are published on npm as
[`@usefragment/core`](https://www.npmjs.com/package/@usefragment/core): `npm install` fetches them,
nothing to do by hand.

#### Windows blocks the installer (« le fichier contient un virus… »)

1. Allow the installer in your antivirus:
   - **Windows Defender**: *Windows Security → Virus & threat protection → Protection history*,
     open the entry for `Fragment Setup…`, then *Actions → Allow on device*.
   - **McAfee**: *My Protection → Quarantined items*, select `Fragment Setup…`, *Restore*; then
     *My Protection → Real-Time Scanning → Excluded files → Add file* and pick the installer.
   - **Another antivirus**: restore the file from its quarantine, then add it to its exclusions.
2. Run the installer. If SmartScreen shows *“Windows protected your PC”*, click
   *More info → Run anyway*.

### 2. The plugin

Requirements: **Git** and **Node.js 20 or later**.

```bash
cd <your-vault>/.fragment/plugins      # create it if it does not exist
git clone https://github.com/PhilippineBiojout/Hone.git hone
cd hone
npm install
npm run build                          # produces main.js, the only code Fragment reads
```

Then **restart Fragment**: it loads every folder in `.fragment/plugins/` that contains a
`manifest.json`, with no activation screen. It only reads `manifest.json`, `main.js` and `styles.css`.

- The folder must be a **real folder**, not a symbolic link or a junction.
- `main.js` is not versioned: after every `git pull`, run `npm install && npm run build` again, then
  restart Fragment (it only reads plugins at startup).
- If something goes wrong: Fragment's console (**Ctrl+Shift+I**), lines starting with `[plugins] …`.

### 3. Codex (Hone's AI)

Hone answers through the **Codex** binary, signed in with a ChatGPT account. No API key.

```bash
npm install -g @openai/codex
codex login                            # opens the browser to sign in
```

Install Codex **before** starting Fragment, so it finds it in the `PATH`. Otherwise, set its full
path in the plugin's `data.json`: `"codex": { "codexPath": "…\\codex.cmd" }`.

### 4. Voice (optional)

Command **« Hone : clé Gradium… »** (Ctrl+P). The key is stored in the plugin's data.

### 5. The scan: Hone-web_scan

The scan (photographing sheets with your phone) relies on two pieces that live **outside this
repository**, in [`github.com/PhilippineBiojout/Hone-web_scan`](https://github.com/PhilippineBiojout/Hone-web_scan):

| Piece | Folder | Online |
|---|---|---|
| the **website** the phone opens (camera, sheet detection and straightening, upload) | `docs/` | GitHub Pages: `https://philippinebiojout.github.io/Hone-web_scan/` |
| the **relay** that connects the phone to Fragment | `relay/` | Cloudflare Worker: `wss://hone-relay.lasky.workers.dev` |

**By default the plugin uses these two hosted addresses: nothing to install**, the scan works as
soon as the plugin is loaded. To host them yourself:

1. fork `Hone-web_scan` and enable GitHub Pages on `main` / folder `/docs`;
2. deploy the relay from **`relay/`**: `npm install`, then `npx wrangler deploy` (Cloudflare account);
3. in this plugin, replace `SITE_URL` (`src/scan/scan.ts`) and `RELAY_URL` (`src/scan/relais.ts`)
   with your addresses, then `npm run build`.

The website and the plugin must speak the same protocol: update them together (see the
`Hone-web_scan` README).

**Using the scan:**
- **QR icon** in the ribbon: the QR code shows up, the phone scans it and opens the website. Each
  photo becomes a page of a PDF created at the root of the vault (`Scan <date> <time>.pdf`);
- on the phone, the **left column** lists the pages: tap a page to **update** it (only that page of
  the PDF is replaced); **« Nouveau »** (new) starts another PDF;
- **right-click a PDF → « Reprendre le scan »** (resume the scan): photos continue that PDF, and its
  existing pages can be updated. **Right-click a folder → « Scanner dans ce dossier »** (scan into
  this folder). **Ctrl+P → « Scanner dans ce PDF »** does the same on the open PDF;
- a phone that is already connected follows the new destination on its own, no need to rescan the QR.

---

## Getting started (development)

```bash
npm install        # node_modules is not versioned
npm run build      # tsc --noEmit + esbuild (prod) → main.js
npm run dev        # esbuild in watch mode
npm test           # vitest run src  (unit tests in src/tests/)
```

- **The `main.js` bundle is NOT versioned** (build artifact). After a fresh clone, run
  `npm install && npm run build` **before** Fragment can load the plugin.
- **Codex**: Hone answers through the `codex` binary, signed in with a ChatGPT account (`codex login`
  in a terminal). No API key. The `factice: true` setting in `data.json` cuts every call (e2e).
- **Gradium key** (voice): command **« Hone : clé Gradium… »**, stored in the plugin's data
  (`loadData`/`saveData`), not in a `.env`.
- **Fragment locks the folders of loaded plugins**: close the app before deleting / renaming a
  folder, and restart it to reload a rebuilt plugin.

---

## Who answers: Codex, with the ChatGPT account

The chat, the toolbar tools and the voice all go through **a single `codex app-server`** that the
page drives over JSON-RPC (`src/codex/serveur.ts`), started by `src/cerveau/moteur-codex.ts`. Each
request opens an ephemeral thread, bounded by its profile (`src/codex/profils.ts`): instructions,
tools we provide (`dynamicTools`), web or not, and no access to the machine. The OpenAI SDK and the
API key were removed on 2026-09-27.

- **Codex reads the whole vault, PDFs included**: `read_document` returns a PDF's text page by page,
  and each page without text (reMarkable notebook, scan) as an image (`inputImage`), 6 at most per
  call; `en_image` forces the image of a text page. `search_vault` also searches PDF text. pdf.js
  (legacy build) is bundled and runs in the page without a worker (`src/cerveau/pdf.ts`).
- The tools we give Codex: `search_vault` and `read_document` (depending on the profile), the two
  memory tools (`remember`, `note_preference`) and, if `atelierActif`, the six workshop meta-tools
  with its catalogue at the top of the request. The title request gets none.
- [`src/pont/protocole.ts`](./src/pont/protocole.ts) holds the **domain types** (`Demande` /
  `Sortie` / `Message`); the chat streams through a simple **callback** (no more IPC).

---

## Folder structure

`src/` is organized **by responsibility** (one folder per part). The single esbuild entry point is
`src/main.ts`.

| Folder / file | Role |
|---|---|
| `main.ts` | Entry point. `onload()` loads the settings, opens the Codex engine, registers the `hone` layer (one per view), adds the « clé Gradium » command, sets the glass lens, wires the scan and the Codex panel. |
| `agentLayer.ts` | **The orchestrator** per view: the only file that knows every piece. Holds the `zone` (passage) + `trait` state. |
| `fragment-env.d.ts` | Type shim for the `fragment` import. |
| **`interactions/`** | What triggers and anchors the agent. |
| ├ `annotation.ts` | Adapter to the core annotation plugin (strokes, eraser, events). |
| ├ `declencheur.ts` | Detects a stroke (pen/highlighter) or a selection → asks for the toolbar. |
| ├ `zoneDuTrait.ts` | Pure geometry: stroke shape → text range `[from, to]`. |
| ├ `traces.ts` | `CarnetTraces`: the margin icons of a view, one per closed answer. |
| └ `registreTraces.ts` | `RegistreTraces`: per-document history, held by the plugin and written to `traces.json`. An answer only goes away through the trash button. |
| **`positionnement/`** | Widget geometry and placement. |
| ├ `repere.ts` | A view's coordinate hub: `WidgetLayer` + client↔document conversions. |
| ├ `placement.ts` | Placement maths (`aCote`: corner of a widget next to a box). |
| └ `fenetre.ts` | Draggable / resizable widget (`Fenetre`, `Cadre`) + gestures. |
| **`composants/`** | The UI widgets (each one a `Component`). |
| ├ `BarreAgent.ts` | The vertical toolbar placed next to the passage. |
| ├ `BulleAgent.ts` | The **chat** bubble (streamed answer). |
| ├ `ActionAgent.ts` | The **tool card** (the circle thinks, then blooms into a card). |
| └ `VoixAgent.ts` | The **voice conversation** (mic, `MediaRecorder`, waveform, TTS). |
| **`ui/`** | Shared atoms. |
| ├ `ui.ts` | `OUTILS` table, `boutonIcone`, `arc`, `proteger`, `PiedSupprimer`. |
| ├ `animations.ts` | Web Animations gestures (`eclore`, `resorber`, `rallonger`, `ressort`) + `creer`. |
| ├ `onde.ts` | The 5-bar voice waveform. |
| └ `nettoyerSvg.ts` | Sanitizes the SVG produced by « visualiser » before display. |
| **`pont/`** | Facade + domain types. |
| ├ `repondre.ts` | Facade called by the widgets (`repondre`, `agir`, `parler`, `resumerOral`) + fake fallback. |
| └ `protocole.ts` | The domain types (`Demande` / `Sortie` / `Message`). |
| **`cerveau/`** | What makes Hone answer. |
| ├ `moteur-codex.ts` | A `Demande` goes in, a `Sortie` comes out, through Codex; memory and workshop wired in. Singleton `ouvrirMoteurCodex`/`moteurCodexCourant`. |
| ├ `consignes.ts` | `BASE` (who Hone is) and each agent's mission. |
| ├ `demande.ts` | `citer` (the passage as Codex reads it), `ErreurAgent`, `AgentEnPause`. |
| ├ `appel.ts`, `gradium.ts` | The voice conversation: Gradium listens and speaks, Codex answers. |
| ├ `outils-vault.ts` | **Read-only**: `chercherDansLeVault`, `lireDocument` (notes and PDFs, async, on `app.vault`). |
| ├ `pdf.ts` | pdf.js in the page: page text, images of handwritten pages. |
| ├ `vault.ts` | `AccesVault` on the native `app.vault` API (injectable, testable). |
| ├ `garde.ts` | Path shape validation; scoping to the vault comes from `app.vault`. |
| └ `langue.ts` | Detects the vault's language (FR/EN) without a model call. |
| **`reglages/`** | |
| └ `reglages.ts` | Settings (`loadData`/`saveData`): Gradium key and its Modal, `factice`, `atelierActif`, `codex`. |
| **`scan/`** | The « scan sheets » feature (the website and the relay live in `Hone-web_scan`). |
| ├ `scan.ts` | `setupScan`: ribbon icon, right-click « Reprendre le scan » / « Scanner dans ce dossier », « Scanner dans ce PDF » command, `ScanModal` (QR via `qr-code-styling`), the destination sent to the phone; each photo goes to its page of the PDF. |
| ├ `pdf.ts` | `putPageInPdf` (adds or replaces a page, with `pdf-lib`) and `pageCount`. |
| └ `relais.ts` | WebSocket client to the relay: photo in chunks, `doc` / `page` / `replace`, « Nouveau ». |
| **`remarkable/`** | The reMarkable's notebooks, live in the vault (flow 7). |
| ├ `remarkable.ts` | `brancherRemarkable`: ribbon icon, vault events, sync every 2 s; the index in `remarkable.json`. |
| ├ `tablette.ts` | HTTP client for the USB web interface (Node's `http`, lenient parser). |
| ├ `rmdoc.ts` | Draws a handwritten notebook's PDF from its raw strokes. |
| ├ `synchro.ts` | One sync round: the tablet's list, changed notebooks downloaded again. |
| ├ `registre.ts`, `deplacements.ts` | The id → path index, and tracking of a moved or deleted PDF. |
| └ `demande.ts`, `entete.ts`, `eclosion.ts`, `dom.ts` | The permission request, the status at the top of the PDFs, the card that comes out of the icon. |
| **`codex/`** | **Codex** chat panel (in **English**, taken from `codex-on-fragment`). Drives `codex app-server` over JSON-RPC — no OpenAI. |
| ├ `transport.ts` | Server `spawn` (Windows: through `cmd.exe`, killed with `taskkill`); NDJSON framing over stdin/stdout. |
| ├ `rpc.ts` | `JsonRpcClient`: tells server requests, responses and notifications apart. |
| ├ `view.ts` | `CodexView` (ItemView): transcript + composer + approval buttons; streamed deltas. |
| └ `codex.ts` | `brancherCodex`: « Open Codex » ribbon icon, command, opens the view in the right dock. |
| **`decor/`** | |
| └ `verre.ts` | Decorative glass lens on the `.toolbar` elements (independent from the agent, Chromium). |
| **`tests/`** | The vitest unit tests (`npm test` = `vitest run src`). |
| `e2e/` | Playwright specs (see *Tests* below). |
| `styles.css` | **Single** stylesheet (Fragment convention), split into banners that follow the folders. |

---

## Main flows

### 1. Showing the toolbar
```
stroke (pen/highlighter) ─┐
mouse selection ──────────┴─► declencheur ─► zoneDuTrait (range [from,to])
                                            ─► repere (anchor + coords)
                                            ─► agentLayer ─► BarreAgent (next to the passage)
```

### 2. Chat (streamed answer)
```
BulleAgent ─► pont/repondre.repondre ─► cerveau/moteur-codex.demander
   ▲                                          │  { agent:'chat', passage, question, historique }
   │  chunk, chunk, …                         ▼
   └──────── final text ◄── codex app-server + our tools (vault, memory, workshop) ─► ChatGPT account
```
`factice` setting → fake answer.

### 3. Tool (card)
```
BarreAgent ─► ActionAgent ─► pont/repondre.agir ─► cerveau/moteur-codex ─► result card
                                                   (« visualiser »: SVG sanitized by ui/nettoyerSvg)
```

### 4. Voice (conversation)
```
VoixAgent (mic + MediaRecorder + ui/onde) ─► pont/repondre.parler ─► fake « Gradium » (voice not wired yet)
```

### 5. Traces (history in the margin)
```
closed answer ─► agentLayer/CarnetTraces ─► icon in the left margin ─► click = reopen
(positions are remapped on every edit of the document)
```

### 6. Scan (phone → PDF)
```
main.setupScan ─► 'qr-code' icon / right-click / Ctrl+P ─► openScan(destination) ─► ScanModal
                  (QR: SITE_URL?v=<timestamp>#sessionId, the destination shown below it)
phone (Hone-web_scan website) ─► Cloudflare relay ─► scan/relais ─► savePhoto
   savePhoto: reads the document's PDF ─► pdf.putPageInPdf (adds or replaces the page) ─► writes + reloads the tab
```
- **Destination**: a folder (new `Scan <date> <time>.pdf`) or an existing PDF. It is sent to the
  phone (`{ type: "destination", key, pages }`) every time the QR opens and every time the phone
  connects: the phone then shows the pages already there. « Nouveau » on the phone switches back to
  a folder.
- **Numbering**: the phone numbers the pages; each photo carries `{ doc, page, replace }`.
- **No image is kept**: everything is in the PDF. A replaced page is copied into a fresh PDF rather
  than removed, otherwise `pdf-lib` would keep the old image and the file would keep growing.
- A PDF renamed or moved during a scan is still followed (`rename` event).
- The phone website (`docs/`) and the relay (`relay/`) live in
  [`github.com/PhilippineBiojout/Hone-web_scan`](https://github.com/PhilippineBiojout/Hone-web_scan),
  **outside this plugin** (see *Installation*, step 5).

### 7. reMarkable (tablet → PDF)
```
main.brancherRemarkable ─► 'tablet' ribbon icon ─► DemandeAutorisation (nothing before it is accepted)
every 2 s: remarkable/synchro ─► tablet (http://10.11.99.1) ─► PDF rewritten in place in the vault
```
- **First sync**: every notebook arrives in `reMarkable/`, with the tablet's folder tree.
- **Handwritten notebooks**: the plugin downloads the raw strokes (`/download/{id}/rmdoc`, about 0.5 s
  versus 10 s for the tablet's PDF export) and draws the PDF itself (`rmdoc.ts`), without the
  template background. Imported PDFs and EPUBs go through the tablet's PDF export.
- **At the top of a tablet PDF** (`entete.ts`): « live » when it is plugged in, an icon otherwise
  (on click, the steps to plug it in).
- **Storing it elsewhere**: a moved or renamed PDF is still followed (`rename` event in the app;
  outside the app, `delete` then `create` recognized by size and fingerprint). A deleted PDF is not
  recreated.
- **Why `http` and not `fetch`**: Fragment's CSP refuses `http:` in the page, and the tablet sends
  both `Content-Length` and `Transfer-Encoding: chunked`, which Node's strict parser rejects; hence
  `http.get` with `insecureHTTPParser: true` (`tablette.ts`).
- The index (notebook id → path in the vault), `hote` and `autorise` are in
  `.fragment/plugins/hone/remarkable.json`. To test without a tablet: set
  `"hote": "http://localhost:<port>"` there.

### 8. Decor (independent from the agent)
```
main.poserLeVerre ─► verre ─► glass lens (feDisplacementMap + backdrop-filter) on the .toolbar elements
```

### 9. Codex (chat driving `codex app-server`)
```
main.brancherCodex ─► 'bot' ribbon icon / « Open Codex panel » command ─► CodexView (right dock)
CodexView ─► transport (spawn `codex app-server`) ─► rpc (JSON-RPC NDJSON)
   ▲  streamed deltas (agentMessage / reasoning / commandExecution)   │  initialize → thread/start → turn/start
   └──────────────────── approvals (Approve / For session / Decline) ◄── server requests
```
The panel has its own `codex app-server`, separate from the bubble's: it runs the **Codex** binary
(config in `reglages.ts::CodexSettings`) with the **vault root** as its `cwd`.

---

## Tests & build

- **Unit**: `npm test` → `vitest run src` (the `*.test.ts` files in `src/tests/`: geometry, SVG
  sanitizer, waveform, placement, path guard, vault tools on a fake vault).
- **Build**: `npm run build` = `tsc --noEmit` (strict, `verbatimModuleSyntax`) then esbuild —
  **a single entry point**, the page (`src/main.ts` → `main.js`, ~3 MB, pdf.js included).
- **E2E**: the Playwright specs in `e2e/` run from `Fragment-main/app/`, which ships Playwright:
  copy `e2e/hone-commun.ts` there as is and each spec as `hone-<spec>`, then
  `npx playwright test e2e/hone-agent-voix.spec.ts --workers=1`. `hone-commun.ts` holds the launcher
  and the gestures: `lancer()` for the dev app in fake mode (`agent-*.spec.ts`), `lancerInstallee()`
  for the installed app on a copy of `fragment-notes`, with the real Codex (`codex-installee.spec.ts`,
  `voix-codex.spec.ts`).

---

## Conventions

- French everywhere in the code; dense, narrative comments. **Exception**: `src/codex/` is in
  English (taken as is from `codex-on-fragment`).
- Fragment lifecycle: everything is `register`ed on a `Component` and torn down on unload.
- The Gradium key lives in the plugin's data (in the page), the Obsidian model, on purpose. No OpenAI key.
- A new file goes into the folder of its responsibility, **never flat** in `src/`.
