// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Registre } from '../remarkable/registre';

function registre(): Registre {
	const r = new Registre();
	Object.assign(r.entree('a'), { chemin: 'reMarkable/Cours/A.pdf', empreinte: 'ha', taille: 100 });
	Object.assign(r.entree('b'), { chemin: 'reMarkable/Cours/B.pdf', empreinte: 'hb', taille: 200 });
	Object.assign(r.entree('c'), { chemin: 'reMarkable/C.pdf', empreinte: 'hc', taille: 100 });
	return r;
}

describe('Registre', () => {
	it('suit un fichier renommé', () => {
		const r = registre();
		expect(r.renommer('reMarkable/C.pdf', 'Maths/C bis.pdf')).toBe(true);
		expect(r.carnets.c.chemin).toBe('Maths/C bis.pdf');
		expect(r.suivi('Maths/C bis.pdf')).toBe(true);
	});

	it('fait suivre tout ce qui est sous un dossier renommé, et seulement ça', () => {
		const r = registre();
		r.renommer('reMarkable/Cours', 'Semestre/Cours 2A');
		expect(r.carnets.a.chemin).toBe('Semestre/Cours 2A/A.pdf');
		expect(r.carnets.b.chemin).toBe('Semestre/Cours 2A/B.pdf');
		expect(r.carnets.c.chemin).toBe('reMarkable/C.pdf');
		// « Semestre/Cours 2 » n'est pas un parent de « Semestre/Cours 2A/… ».
		expect(r.renommer('Semestre/Cours 2', 'X')).toBe(false);
	});

	it('arrête de suivre un fichier supprimé, et tout un dossier', () => {
		const r = registre();
		r.supprimer('reMarkable/Cours/A.pdf', 1000);
		expect(r.carnets.a).toMatchObject({ chemin: null, ignore: true, supprimeLe: 1000 });
		r.supprimer('reMarkable/Cours', 1000);
		expect(r.carnets.b.ignore).toBe(true);
		expect(r.carnets.c.ignore).toBe(false);
	});

	it('propose les carnets supprimés dans la fenêtre, de même taille', () => {
		const r = registre();
		r.supprimer('reMarkable/Cours/A.pdf', 1000);
		r.supprimer('reMarkable/C.pdf', 1000);
		// même taille : deux candidats, l'empreinte départage (dans deplacements)
		expect(r.candidats(100, 500).sort()).toEqual(['a', 'c']);
		expect(r.candidats(100, 2000)).toEqual([]);
		r.rattacher('a', 'Ailleurs/A.pdf');
		expect(r.carnets.a).toMatchObject({ chemin: 'Ailleurs/A.pdf', ignore: false, supprimeLe: undefined });
	});
});
