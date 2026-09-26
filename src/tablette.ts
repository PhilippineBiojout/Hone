import * as http from 'http';

// Interface web USB de la reMarkable (Paramètres > Stockage > Interface web USB).
export const HOTE_PAR_DEFAUT = 'http://10.11.99.1';

/** Un carnet ou un dossier de la tablette. */
export interface ElementTablette {
	id: string;
	nom: string;
	/** « Cours/Maths/Algèbre », sans extension. */
	chemin: string;
	dossier: boolean;
	/** `ModifiedClient` : change quand la tablette enregistre le carnet. */
	modifie: string;
}

/** La tablette répond mais refuse l'export : ce n'est pas une déconnexion. */
export class ExportRefuse extends Error {}

// La tablette envoie à la fois Content-Length et Transfer-Encoding: chunked.
// Le parseur strict de Node refuse cette réponse, et le fetch de la page est
// bloqué par la CSP de Fragment (pas de http:) : on passe par `http` avec le
// parseur tolérant. Une connexion par requête (`agent: false`) : rien ne
// garantit que la tablette tienne une connexion ouverte entre deux tours.
function obtenir(url: string, delaiMs: number): Promise<{ statut: number; corps: Buffer }> {
	return new Promise((resoudre, rejeter) => {
		const req = http.get(url, { insecureHTTPParser: true, timeout: delaiMs, agent: false }, (res) => {
			const morceaux: Buffer[] = [];
			res.on('data', (m: Buffer) => morceaux.push(m));
			res.on('end', () => resoudre({ statut: res.statusCode ?? 0, corps: Buffer.concat(morceaux) }));
			res.on('error', rejeter);
		});
		req.on('timeout', () => req.destroy(new Error(`délai dépassé sur ${url}`)));
		req.on('error', rejeter);
	});
}

// Un nom de la tablette devient un morceau de chemin du vault : ni « / », ni
// point en tête (le vault ignore les chemins cachés).
function segment(nom: string): string {
	return nom.replace(/[\\/:]/g, '-').replace(/^\.+/, '').trim() || 'sans nom';
}

export class Tablette {
	constructor(readonly hote: string) {}

	/** Tous les carnets et dossiers, en descendant dans chaque dossier. */
	async lister(dossier = '', prefixe = ''): Promise<ElementTablette[]> {
		const { statut, corps } = await obtenir(`${this.hote}/documents/${dossier}`, 4000);
		if (statut !== 200) throw new Error(`HTTP ${statut} sur /documents/${dossier}`);
		const items = JSON.parse(corps.toString('utf8')) as { ID: string; VissibleName: string; Type: string; ModifiedClient: string }[];

		const sortie: ElementTablette[] = [];
		for (const item of items) {
			const el: ElementTablette = {
				id: item.ID,
				nom: item.VissibleName,
				chemin: prefixe + segment(item.VissibleName),
				dossier: item.Type === 'CollectionType',
				modifie: item.ModifiedClient,
			};
			sortie.push(el);
			if (el.dossier) sortie.push(...(await this.lister(el.id, el.chemin + '/')));
		}
		return sortie;
	}

	/** Le PDF du carnet, écriture comprise : c'est la tablette qui le rend. */
	async telecharger(id: string): Promise<ArrayBuffer> {
		const { statut, corps } = await obtenir(`${this.hote}/download/${id}/pdf`, 60000);
		if (statut !== 200) throw new ExportRefuse(`export refusé par la tablette (HTTP ${statut})`);
		return new Uint8Array(corps).buffer;
	}
}
