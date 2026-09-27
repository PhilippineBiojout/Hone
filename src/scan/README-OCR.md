# Module OCR — Fragment Scan

Ce module TypeScript transforme une photo de cours manuscrits en **Markdown**, avec les schémas conservés sous forme d’images PNG. Il s’intègre directement au plugin : une fonction reçoit une photo et une clé OpenAI, puis retourne le texte et les fichiers en mémoire.

## Dépendances et environnement

**Aucun nouveau package npm n’est requis pour exécuter le module.** Il n’utilise ni le SDK `openai`, ni Sharp, ni Express. Il utilise les API de Chromium/Electron : `fetch`, `Blob`, `ArrayBuffer`, `FileReader`, `createImageBitmap`, Canvas et `crypto.getRandomValues`.

Le dépôt parent fournit son outillage TypeScript/bundler habituel. Les sources sont compatibles avec TypeScript strict, ES2018 + DOM et des imports relatifs sans extension. Elles sont destinées au contexte Chromium du plugin, pas à un processus Node seul. Ce contexte doit autoriser les requêtes HTTPS vers `https://api.openai.com`.

Aucun serveur OCR, CLI ou fichier intermédiaire n’est nécessaire. Le module ne lit ni n’écrit de fichiers, ne charge pas `.env` ou `data.json` et ne modifie pas le vault. Il effectue un appel réseau OpenAI et traite les images en mémoire. La clé est exclusivement fournie en argument : elle ne doit pas être écrite dans les sources ou committée.

## Installation et organisation

Dans le dépôt parent, intégrer les sources avec cette organisation :

```text
src/scan/
├── transcrire.ts       # Point d’entrée public
└── ocr/
    ├── types.ts        # Contrat et types internes
    ├── api.ts          # Requête OpenAI, timeout et erreurs
    ├── prompt.ts       # Consignes internes de transcription
    ├── image.ts        # Validation, orientation et recadrages
    ├── schema.ts       # Validation de la réponse structurée
    └── errors.ts       # Erreurs contrôlées
```

Le module est déjà placé dans `src/scan/`. Depuis `src/scan/scan.ts`, importer `transcrire` depuis `./transcrire` ; depuis `src/main.ts`, l’import est `./scan/transcrire`. Cette contribution fournit le module : le branchement de la réception des photos et des écritures du vault reste à faire dans `scan.ts`. Aucun réglage de clé existant n’est lu par le module.

Ne pas transférer le backend, les `node_modules`, les clés, les photos personnelles ou leurs résultats. Le fichier de consignes interne est nécessaire au fonctionnement, mais son contenu n’est pas reproduit dans cette documentation. Après transfert, ses évolutions doivent être synchronisées explicitement si une copie du module reste maintenue ailleurs.

## Fonction publique

```ts
export interface Transcription {
    markdown: string;
    fichiers: { nom: string; donnees: ArrayBuffer | string }[];
}

export async function transcrire(
    image: Blob,
    cle: string
): Promise<Transcription>;
```

| Élément | Signification |
| --- | --- |
| `image` | Photo JPEG sous forme de `Blob`, avec le type MIME `image/jpeg` |
| `cle` | Clé OpenAI passée par le plugin, avec accès au modèle configuré |
| Retour | Objet contenant exactement `markdown` et `fichiers` |
| Échec | Promise rejetée avec une erreur lisible ; aucun résultat partiel retourné |

Depuis un fichier situé dans `src/scan/` :

```ts
import { transcrire } from './transcrire';
import type { Transcription } from './transcrire';

const resultat: Transcription = await transcrire(photo, cle);
// Le plugin peut ensuite enregistrer resultat.fichiers et resultat.markdown.
```

## Fonctionnement général

```text
Plugin : photo JPEG + clé OpenAI
                  │
                  ▼
     Validation de la taille et des dimensions
                  │
                  ▼
     Orientation EXIF et préparation de l’image
                  │
                  ▼
     Un appel OpenAI : texte + zones des schémas
                  │
                  ▼
     Validation du contenu et des coordonnées
                  │
                  ▼
     Recadrages PNG depuis les pixels de la photo
                  │
                  ▼
     Insertion des liens dans le Markdown
                  │
                  ▼
     { markdown, fichiers } — retour en mémoire
                  │
                  ▼
Plugin : sauvegarde des fichiers, puis création de la note
```

La version actuelle utilise `gpt-6-sol`, au niveau 1, avec extraction des schémas : **un seul appel OpenAI**, sans nouvelle tentative automatique. Ces réglages sont internes ; la fonction publique n’expose pas de paramètre de niveau ou de modèle.

## Comprendre le résultat

### `markdown`

Le texte est transcrit avec ses titres, listes et formules LaTeX (`$...$` et `$$...$$`). Les consignes demandent de conserver les fautes et de ne pas résoudre ou corriger les exercices. Un caractère indéchiffrable est représenté par `?`, notamment `\text{?}` dans une formule.

Un schéma identifié est remplacé par un lien Markdown vers son recadrage. Les textes internes au schéma restent visibles dans l’image et ne sont pas recopiés dessous. Les paragraphes extérieurs restent transcrits. Les marqueurs `[schéma non transcrit]`, `[aucun texte lisible]` et `[Lien incertain à vérifier]` peuvent signaler une difficulté.

Le retour ne comporte pas de champ d’avertissements séparé. Les remarques internes du modèle ne sont pas exportées. Le module n’ajoute pas la photo originale en bas de note : le plugin le fait s’il le souhaite.

### `fichiers`

Chaque élément contient :

- **`nom`** : chemin relatif au dossier de la future note, avec des `/`. Ce nom correspond exactement au lien dans `markdown`.
- **`donnees`** : contenu à enregistrer. Le contrat autorise `ArrayBuffer | string`. **Actuellement, le module retourne uniquement les octets PNG en `ArrayBuffer`**, jamais du base64. Une `string` serait le contenu d’un fichier texte.

Sans schéma, le tableau est vide : `fichiers: []`. Le Markdown est déjà dans son propre champ : il n’est pas également inclus comme fichier. La photo originale n’est pas incluse dans `fichiers`.

Exemple illustratif en TypeScript — il ne s’agit pas de JSON sérialisable directement :

```ts
const resultat: Transcription = {
    markdown: '# Mécanique\n\n![Schéma 1](diagrams-abc/diagram-1.png)\n\nSuite du cours.',
    fichiers: [
        {
            nom: 'diagrams-abc/diagram-1.png',
            donnees: octetsPng, // ArrayBuffer contenant le PNG complet
        },
    ],
};
```

Les noms de dossiers réels utilisent un identifiant aléatoire propre à chaque appel. Cela évite les collisions entre scans. **`JSON.stringify` ne conserve pas le contenu d’un ArrayBuffer** : pour transmettre ce résultat entre processus via JSON, le parent doit définir un encodage explicite, ou utiliser un mécanisme prenant en charge les buffers.

## Responsabilités du plugin parent

Pour une note `Scans/scan-123.md`, enregistrer le fichier nommé `diagrams-abc/diagram-1.png` dans `Scans/diagrams-abc/diagram-1.png`.

1. Créer les dossiers nécessaires avec l’API du vault.
2. Enregistrer chaque `fichier.donnees` sous `fichier.nom`, relativement au dossier de la note. Utiliser l’écriture binaire pour un `ArrayBuffer`, l’écriture texte pour une `string`.
3. Après succès de toutes les écritures, créer la note avec `resultat.markdown` et ajouter éventuellement le lien vers la photo originale.
4. Ouvrir la note dans un lecteur Markdown compatible LaTeX et images relatives.

Si l’écriture d’un fichier échoue, ne pas créer une note contenant des liens cassés. Conserver la photo originale. Des fichiers déjà enregistrés peuvent rester orphelins ; leur nettoyage éventuel relève du plugin et doit concerner uniquement les fichiers de cette opération.

Le Markdown et son dossier d’images doivent rester ensemble lors d’un déplacement ou d’un partage. Pour prévisualiser un PNG avant sauvegarde, le parent peut construire un `Blob` à partir de l’ArrayBuffer et utiliser une URL temporaire, à révoquer après usage.

Le code appelant doit utiliser l’API du vault du plugin pour les écritures ; cette responsabilité reste extérieure à `transcrire`.

## Limites et gestion des erreurs

| Réglage | Valeur actuelle |
| --- | --- |
| Entrée | JPEG, 12 Mo maximum, 40 mégapixels maximum |
| Préparation | Orientation EXIF appliquée, aucune réduction de résolution |
| Image envoyée | PNG normalisé, 20 Mo maximum, détail `high` |
| Schémas | Jusqu’à 8, PNG, 12 Mo cumulés maximum |
| Marge de recadrage | 2 % de la largeur/hauteur du rectangle, bornée à la page |
| Délai réseau | 180 secondes, incluant la lecture de la réponse |
| Limite de sortie | 16 000 tokens par appel |
| Relance automatique | Aucune |

Le temps de préparation et de recadrage s’ajoute au délai réseau. La limite de tokens de sortie n’est pas un plafond du coût total. L’effort de raisonnement reste celui par défaut du modèle. `store: false` est envoyé à OpenAI, mais n’est pas une garantie générale de rétention nulle chez le fournisseur.

Les erreurs couvrent notamment la clé absente/refusée, le format invalide, les limites de taille, le quota, le réseau, les réponses incomplètes et les coordonnées incohérentes. Elles ne reprennent pas les messages bruts du fournisseur ni la clé. La fonction ferme ses bitmaps temporaires, même en cas d’échec.

Les contrôles valident la structure et les coordonnées ; ils ne prouvent pas la fidélité du texte ni la qualité du cadrage. Une relecture peut être nécessaire et deux appels identiques peuvent donner des résultats différents.

## Validation et tests

L’adaptateur a été vérifié en TypeScript strict ES2018 et dans Chromium 154 avec **13 scénarios simulés** : format du retour, ArrayBuffer PNG, liens, schémas multiples, orientation EXIF, limites, réponses invalides, refus, erreurs réseau, timeout, libération des bitmaps et ordre des écritures du plugin.

**L’intégration dans Fragment reste à tester** avec la configuration du dépôt parent, sa politique réseau, son API de vault et son rendu Markdown. Un push ne constitue pas à lui seul cette validation.

Dans ce dépôt :

```sh
npm run build
npm test -- src/scan/ocr/schema.test.ts
```

Les tests ciblés de ce module vérifient la validation du contenu et la lecture des réponses REST, sans clé ni réseau. Les 13 scénarios Chromium mentionnés ci-dessus ont été exécutés dans le projet de préparation avec des images synthétiques ; leur harness ne fait pas partie de cette contribution.
