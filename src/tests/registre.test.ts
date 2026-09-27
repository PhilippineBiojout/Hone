// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cibles, Registre } from '../remarkable/registre';

const doc = (id: string, chemin: string) => ({ id, chemin });

describe('cibles', () => {
	it('met chaque document à reMarkable/<son chemin sur la tablette>', () => {
		const r = new Registre();
		expect([...cibles([doc('a', 'Cours/A'), doc('c', 'C')], r.carnets)]).toEqual([
			['a', 'reMarkable/Cours/A.pdf'],
			['c', 'reMarkable/C.pdf'],
		]);
	});

	it('suit la tablette : déplacé ou renommé là-bas, la cible change', () => {
		const r = new Registre({ a: { chemin: 'reMarkable/Cours/A.pdf', modifie: 't1' } });
		expect(cibles([doc('a', 'Archive/A renommé')], r.carnets).get('a')).toBe('reMarkable/Archive/A renommé.pdf');
	});

	it('numérote deux documents du même nom, et garde chacun à sa place d’un tour à l’autre', () => {
		const r = new Registre();
		const premier = cibles([doc('x', 'Notes'), doc('y', 'Notes')], r.carnets);
		expect([premier.get('x'), premier.get('y')]).toEqual(['reMarkable/Notes.pdf', 'reMarkable/Notes (2).pdf']);
		// y était déjà « Notes.pdf » (x est arrivé après) : il le garde, x prend « (2) ».
		const r2 = new Registre({ y: { chemin: 'reMarkable/Notes.pdf', modifie: 't' } });
		const second = cibles([doc('x', 'Notes'), doc('y', 'Notes')], r2.carnets);
		expect([second.get('x'), second.get('y')]).toEqual(['reMarkable/Notes (2).pdf', 'reMarkable/Notes.pdf']);
	});
});

describe('Registre', () => {
	it('ne garde d’un ancien data.json que le chemin et la version', () => {
		const r = new Registre({ a: { chemin: 'reMarkable/A.pdf', modifie: 't', ignore: true, empreinte: 'h' } as never });
		expect(r.carnets).toEqual({ a: { chemin: 'reMarkable/A.pdf', modifie: 't' } });
		expect(r.suivi('reMarkable/A.pdf')).toBe(true);
	});
});
