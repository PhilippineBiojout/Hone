# Site du scan : historique des pages

**État au 27/09/2026 :** le **site** est fait (dépôt Hone-web_scan, branche
`feat/pages-vue`), et le **plugin** aussi, en version simple : une note par document,
avec une image par page à la suite (`![[…-p2-….jpg]]`), sans transcription (Codex
s'en charge). Le nom de l'image sert de repère de page, parce que Fragment affiche les
commentaires HTML en clair : voir `pages.ts` (et ses tests) et `savePhoto` dans `scan.ts`.
Le plan ci-dessous (sections `<!-- page N -->`, transcription par le plugin) est
l'ancienne version, gardée pour mémoire.
Ce fichier sert à reprendre, avec un humain ou un Claude, sans tout redécouvrir.

## Le besoin

Aujourd'hui, chaque photo scannée crée sa propre note. On veut travailler sur
**plusieurs feuilles** qui forment **un seul document** :

1. **Les pages s'enchaînent dans la même note** (1, puis 2, puis 3…) au lieu de créer un
   fichier à chaque scan. Plus tard, cette note deviendra un PDF.
2. **Mettre à jour une seule page.** Si je complète la feuille 2, je la reprends en photo
   et seule la partie « page 2 » de la note est remplacée. Les autres pages ne bougent pas.

## Ce que voit l'utilisateur sur le téléphone (fait)

Le site vit dans le dépôt `github.com/PhilippineBiojout/Hone-web_scan`, dossier `docs/`.

- **Une colonne à gauche** avec les miniatures des pages envoyées, dans l'ordre, chacune
  avec son numéro. Elle apparaît dès la première page.
- **Chaque photo s'ajoute à la suite.** Le bouton d'envoi dit « Ajouter la page N ».
- **Toucher une miniature** affiche la page en grand, avec « Mettre à jour la page N »
  (ouvre la caméra : la photo prise remplacera cette page, et elle seule) et « Retour ».
- **« Nouveau »** en haut de la colonne commence un autre document, donc une autre note.
- **Le bouton Hone** revient à l'accueil et annule une mise à jour en cours.
- Le document et ses miniatures sont gardés dans le `sessionStorage`, les photos
  complètes en mémoire.

## Les messages (déjà envoyés par le site)

Ils passent par le relais `wss://hone-relay.lasky.workers.dev`, qui transmet tout tel quel
et n'a donc **pas à changer**.

| Message | De | Contenu |
|---|---|---|
| `photo-start` | téléphone | `{ type, id, mime, size, doc, page, replace }` : la page `page` du document `doc` ; `replace: true` = remplacer cette page |
| `photo-received` | plugin | `{ type, id }`, inchangé |
| `doc-new` | téléphone | `{ type, doc }` : un nouveau document commence (facultatif, chaque photo porte déjà son `doc`) |

**C'est le téléphone qui numérote les pages**, parce que c'est lui qui voit la colonne.
Le plugin n'a rien à calculer : il range la page `page` du document `doc`.

## Côté plugin (`src/scan/`), à faire

1. **`relais.ts`** : lire `doc`, `page` et `replace` dans `photo-start`, et les passer à
   `onPhoto(photo, id, { doc, page, replace })`.
2. **`pages.ts`** (fonctions pures, testées dans `src/tests/pages.test.ts`) :
   `putPage(texte, page, contenu)` remplace ou ajoute la section d'une page, et
   `pageBlock(page, contenu)` fabrique cette section. Les sections sont délimitées par des
   commentaires HTML, invisibles à l'affichage :
   ```md
   <!-- page 2 -->
   …transcription de la feuille 2…
   ![[scan-…-p2.jpg]]
   <!-- /page 2 -->
   ```
3. **Retrouver la note d'un document** : une `Map` en mémoire dans `setupScan`,
   `doc → chemin de la note`. Premier envoi d'un `doc` inconnu : on crée la note.
4. **`savePhoto`** :
   - nommer la photo `scan-<date>-p<page>.jpg`, avec toujours un nouvel horodatage, parce
     que `createBinary` échoue si le fichier existe ;
   - envoyer `photo-received` tout de suite, comme aujourd'hui ;
   - écrire avec `vault.process(fichier, texte => putPage(...))`, qui lit et réécrit
     d'un seul coup. `putPage` ajoute la section si elle n'existe pas, la remplace sinon :
     `replace` n'est même pas indispensable côté plugin.
5. **Une file d'attente** (`queue = queue.then(...)`) pour que deux photos envoyées
   coup sur coup n'écrivent pas la note en même temps.

**Rescan = remplacement.** La section de la page est entièrement réécrite, et les retouches
faites à la main dans CETTE page sont perdues. *(Décidé : c'est plus simple et plus fiable
qu'une fusion par le modèle.)*

## ⚠ Ce que Codex change (à trancher avant de reprendre)

Ce plan supposait que **le plugin écrit lui-même le `.md`** à partir d'une transcription.
Si c'est Codex qui produit le `.md`, il faut choisir :
- soit Codex **renvoie le texte** et le plugin le range dans la bonne section avec `putPage`.
  Tout le plan ci-dessus reste valable. **C'est l'option à privilégier.**
- soit Codex **écrit la note lui-même**. Il faut alors lui dire quelle section remplacer,
  et le découpage en pages devient moins fiable.

Dans les deux cas, le site (miniatures, mise à jour, nouveau document) et les messages
ci-dessus restent les mêmes.

## Anti-cache (fait)

Le QR ouvre `…/Hone-web_scan/?v=<horodatage>#<session>` (`scan.ts`, clic sur l'icône) :
une adresse neuve à chaque QR, donc jamais un vieux HTML en cache. `docs/index.html`
recopie ce `?v=…` sur `style.css` et `main.js`. Plus aucun numéro de version à tenir à jour.

## Lien avec le mode live (plus tard)

Le live, c'est « rescanner la page courante » en boucle, automatiquement : le téléphone
envoie une image quand la feuille a changé et que la main ne bouge plus (comparaison
d'images réduites à ~96×72 en niveaux de gris). Le découpage en sections sert donc
aussi au live : on remplace seulement la section de la page filmée.
