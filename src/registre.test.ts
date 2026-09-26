// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Registre } from './registre';

function registre(): Registre {
	const r = new Registre();
	r.ajouter('a', 'Cours/A');
	r.ecrit('a', 'reMarkable/Cours/A.pdf', 't1', 'ha', 100);
	r.ajouter('b', 'Cours/B');
	r.ecrit('b', 'reMarkable/Cours/B.pdf', 't1', 'hb', 200);
	r.ajouter('c', 'C');
	r.ecrit('c', 'reMarkable/C.pdf', 't1', 'hc', 100);
	return r;
}

describe('Registre', () => {
	it('suit un fichier renommé', () => {
		const r = registre();
		expect(r.renommer('reMarkable/C.pdf', 'Maths/C bis.pdf')).toBe(true);
		expect(r.get('c')?.chemin).toBe('Maths/C bis.pdf');
		expect(r.parChemin('Maths/C bis.pdf')).toBe('c');
	});

	it('fait suivre tout ce qui est sous un dossier renommé, et seulement ça', () => {
		const r = registre();
		r.renommer('reMarkable/Cours', 'Semestre/Cours 2A');
		expect(r.get('a')?.chemin).toBe('Semestre/Cours 2A/A.pdf');
		expect(r.get('b')?.chemin).toBe('Semestre/Cours 2A/B.pdf');
		expect(r.get('c')?.chemin).toBe('reMarkable/C.pdf');
		// « reMarkable/Cou » n'est pas un parent de « reMarkable/Cours/… ».
		expect(r.renommer('Semestre/Cours 2', 'X')).toBe(false);
	});

	it('arrête de suivre un fichier supprimé, et tout un dossier', () => {
		const r = registre();
		r.supprimer('reMarkable/Cours/A.pdf', 1000);
		expect(r.get('a')).toMatchObject({ chemin: null, ignore: true, supprimeLe: 1000 });
		r.supprimer('reMarkable/Cours', 1000);
		expect(r.get('b')?.ignore).toBe(true);
		expect(r.get('c')?.ignore).toBe(false);
	});

	it('reconnaît un déplacement hors de l’app (delete puis create) dans la fenêtre', () => {
		const r = registre();
		r.supprimer('reMarkable/Cours/A.pdf', 1000);
		r.supprimer('reMarkable/C.pdf', 1000);
		// même taille : deux candidats, l'empreinte départage (dans synchro)
		expect(r.candidats(100, 500).sort()).toEqual(['a', 'c']);
		expect(r.candidats(100, 2000)).toEqual([]);
		r.rattacher('a', 'Ailleurs/A.pdf');
		expect(r.get('a')).toMatchObject({ chemin: 'Ailleurs/A.pdf', ignore: false });
		expect(r.get('a')?.supprimeLe).toBeUndefined();
	});

	it('récupère un carnet ignoré pour le retélécharger', () => {
		const r = registre();
		r.supprimer('reMarkable/C.pdf', 1000);
		r.recuperer(['c', 'b']);
		expect(r.get('c')).toMatchObject({ ignore: false, chemin: null, modifie: null });
		// b n'était pas ignoré : on n'y touche pas
		expect(r.get('b')?.chemin).toBe('reMarkable/Cours/B.pdf');
	});
});
