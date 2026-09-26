# Site du scan : historique des pages (à reprendre)

Idée mise en pause le 27/09/2026 pour passer à la transcription par Codex.
Ce fichier sert à la reprendre, avec un humain ou un Claude, sans tout redécouvrir.

## Le besoin

Aujourd'hui, chaque photo scannée crée sa propre note. On veut travailler sur
**plusieurs feuilles** qui forment **un seul document** :

1. **Les pages s'enchaînent dans la même note** au lieu de créer un fichier à chaque scan.
2. **Rescanner une seule page.** Si je complète la feuille 2, je la rescanne et seule la
   partie « page 2 » de la note est mise à jour. Les autres pages ne bougent pas.

## Ce que voit l'utilisateur sur le téléphone

Le site vit dans le dépôt `github.com/PhilippineBiojout/Hone-web_scan`, dossier `docs/`.

- **Une colonne à gauche** avec les miniatures des photos déjà envoyées, en petit et dans
  l'ordre, chacune avec son numéro de page.
- **Toucher une miniature** propose « Rescanner la page N ». La prochaine photo remplace
  cette page au lieu d'en ajouter une nouvelle.
- **Un bouton « Nouveau document »** : la prochaine photo commence une nouvelle note.
  Tant qu'on ne l'a pas touché, les pages s'ajoutent à la note en cours. *(Décidé.)*
- **C'est le téléphone qui garde les miniatures** (en mémoire, voire dans le
  `localStorage`). Le plugin n'a rien à lui renvoyer, à part le numéro de page.

## Les messages à ajouter (des deux côtés)

Ils passent par le relais `wss://hone-relay.lasky.workers.dev`, qui transmet tout tel quel
et n'a donc **pas à changer**.

| Message | De | Changement |
|---|---|---|
| `photo-start` | téléphone | nouveau champ facultatif `page`. Absent = nouvelle page ; `page: 2` = rescan de la page 2 |
| `photo-received` | plugin | renvoie `{ type, id, page }` : le téléphone sait quel numéro mettre sur la miniature |
| `doc-new` | téléphone | `{ type }` : la prochaine photo ouvre une nouvelle note |

**C'est le plugin qui choisit le numéro de page**, parce que c'est lui qui connaît la
note. Le téléphone ne fait que le renvoyer pour un rescan.

## Côté plugin (`src/scan/`), tel que prévu

1. **`relais.ts`** : transmettre `page` (lu dans `photo-start`) à `onPhoto(photo, id, page?)`,
   et ajouter un callback `onNewDocument` pour `doc-new`.
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
3. **Le document en cours** est gardé en mémoire dans `setupScan` :
   `let current: { path: string; pages: number } | null`. `doc-new` le remet à `null`.
4. **`savePhoto`** :
   - choisir la page : `page` venu du téléphone pour un rescan, sinon `pages + 1` ;
   - nommer la photo `scan-<date>-p<page>.jpg`, avec toujours un nouvel horodatage, parce
     que `createBinary` échoue si le fichier existe ;
   - envoyer `photo-received` avec `page` tout de suite ;
   - écrire avec `vault.process(fichier, texte => putPage(...))`, qui lit et réécrit
     d'un seul coup.
5. **Une file d'attente** (`queue = queue.then(...)`) pour que deux photos envoyées
   coup sur coup ne calculent pas le même numéro de page.

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

Dans les deux cas, le site (miniatures, rescan, nouveau document) et les messages
ci-dessus restent les mêmes.

## Lien avec le mode live (plus tard)

Le live, c'est « rescanner la page courante » en boucle, automatiquement : le téléphone
envoie une image quand la feuille a changé et que la main ne bouge plus (comparaison
d'images réduites à ~96×72 en niveaux de gris). Le découpage en sections sert donc
aussi au live : on remplace seulement la section de la page filmée.
