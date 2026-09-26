// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { inflateSync } from 'zlib';
import { rmdocEnPdf } from '../remarkable/rmdoc';
import { rmdocDeTest } from './rmdocDeTest';

/** Les tailles de page et le dessin (décompressé) de chaque page. */
function lire(pdf: Buffer): { tailles: string[]; dessins: string[] } {
	const texte = pdf.toString('latin1');
	const tailles = [...texte.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => `${m[1]} × ${m[2]}`);
	const dessins = [...texte.matchAll(/\/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g)].map((m) => {
		const debut = m.index + m[0].length;
		return inflateSync(pdf.subarray(debut, debut + Number(m[1]))).toString('latin1');
	});
	return { tailles, dessins };
}

describe('rmdocEnPdf', () => {
	const pdf = rmdocEnPdf(rmdocDeTest('n', [
		[
			{ couleur: 6, points: [[0, 100], [50, 120], [100, 100]], largeur: 16 },
			{ outil: 18, couleur: 9, argb: 0xffbeeafe, points: [[-200, 500], [200, 500]] },
		],
		[],
		[{ points: [[0, 0], [0, 3000]] }],
	]), 'n');
	const { tailles, dessins } = lire(pdf);

	it('fait une page par page du carnet, à la taille de la Paper Pro', () => {
		// 1620 × 2160 unités à 72/227 ; la page étendue s'arrête 48 unités sous son dernier trait.
		expect(tailles).toEqual(['514 × 685', '514 × 685', '514 × 967']);
		expect(dessins[1]).toBe('1 J 1 j\n');
	});

	it('place les traits comme la tablette, dans ses couleurs', () => {
		// (0, 100) : x centré sur 0, y compté depuis le haut.
		expect(dessins[0]).toContain('0.188 0.290 0.878 RG\n1.27 w 256.92 653.28 m');
		expect(dessins[0]).toContain('/Surligneur gs 0.745 0.918 0.996 RG 9.52 w');
	});

	it('écrit une table xref qui pointe sur chaque objet', () => {
		const texte = pdf.toString('latin1');
		const xref = [...texte.split('xref\n')[1].matchAll(/^(\d{10}) 00000 n/gm)].map((m) => Number(m[1]));
		expect(xref).toHaveLength(8); // catalogue, pages, et 2 objets par page
		xref.forEach((p, i) => expect(texte.slice(p).startsWith(`${i + 1} 0 obj`)).toBe(true));
		expect(texte).toContain(`startxref\n${texte.lastIndexOf('xref\n0 ')}\n`);
	});
});
