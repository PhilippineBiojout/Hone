# reMarkable pour Fragment

Ramène en direct dans le vault les carnets de la reMarkable, en PDF, par
l'interface web USB de la tablette (`http://10.11.99.1`). Même voie que le
prototype `~/Documents/IA/remarkable-live`.

## Ce qu'il fait

- **Première synchro** : tous les carnets arrivent dans `reMarkable/`, avec
  l'arborescence de la tablette.
- **En direct** : toutes les 2 s, le plugin lit la liste de la tablette ; un
  carnet dont `ModifiedClient` a changé est retéléchargé (la tablette rend
  elle-même l'écriture dans le PDF) et réécrit à l'endroit où il est dans le vault.
- **Ranger ailleurs** : un PDF déplacé ou renommé reste suivi. Dans l'app,
  par l'événement `rename` du vault (un dossier renommé n'en émet qu'un, les
  chemins dessous suivent). Hors de l'app (Finder, git), le cœur voit un
  `delete` puis un `create` : le plugin reconnaît le fichier à sa taille et à
  son empreinte, dans les 10 s, et au démarrage pour ce qui a bougé pendant
  que Fragment était fermé.
- **Supprimer** : un PDF supprimé du vault n'est plus suivi ni recréé.
- **Récupérer** : la vue reMarkable (icône tablette du ruban) montre les
  carnets de la tablette et où ils sont dans le vault ; un bouton récupère un
  carnet ou tous les carnets non suivis d'un dossier, dans `reMarkable/`.
- Renommer ou déplacer un carnet **sur la tablette** ne change rien au vault.

L'index (id du carnet sur la tablette → chemin dans le vault) est dans
`data.json`, avec `hote`, l'adresse de la tablette.

## Pourquoi `http` de Node et pas `fetch`

La CSP de Fragment n'autorise pas `http:` dans la page, et la tablette envoie
à la fois `Content-Length` et `Transfer-Encoding: chunked`, que le parseur
strict de Node refuse. Le plugin passe par `http.get` avec
`insecureHTTPParser: true` (`src/tablette.ts`).

## Construire et tester

```sh
npm install
npm run build   # typecheck + esbuild → main.js
npm test        # vitest : client HTTP contre une fausse tablette, index
```

Le test de bout en bout (`e2e/remarkable.spec.ts`) tourne depuis Fragment,
contre une fausse tablette : le copier dans `Fragment-main/app/e2e/` (il utilise
leur `pdfFixture.ts`), lancer `npx vite`, puis
`npx playwright test e2e/remarkable.spec.ts --workers=1` depuis `app/`.

Tester sans tablette : mettre `"hote": "http://localhost:<port>"` dans
`data.json`.

Parti de [fragment-sample-plugin](https://github.com/RebornFlamme/fragment-sample-plugin).
