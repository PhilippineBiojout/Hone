import { strToU8, zipSync } from 'fflate';

// Fabrique un rmdoc comme celui de la tablette, pour les tests : chaque page
// est une liste de traits, écrits en blocs « lines v6 » (format lu par
// `rmdoc.ts`, vérifié une fois avec rmscene). Pas de vraies notes dans le dépôt.

export interface TraitDeTest {
	outil?: number; // 15 : stylo bille ; 18 : surligneur
	couleur?: number;
	/** ARGB propre au trait (le surligneur de la Paper Pro). */
	argb?: number;
	points: [number, number][];
	largeur?: number;
}

const u32 = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const f32 = (v: number) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return b; };
const f64 = (v: number) => { const b = Buffer.alloc(8); b.writeDoubleLE(v); return b; };
const id = (etiquette: number, n: number) => Buffer.from([etiquette, 1, n]);

function bloc(type: number, contenu: Buffer): Buffer {
	return Buffer.concat([u32(contenu.length), Buffer.from([0, 2, 2, type]), contenu]);
}

function trait(t: TraitDeTest, n: number): Buffer {
	const points = Buffer.concat(t.points.map(([x, y]) => {
		const p = Buffer.alloc(14);
		p.writeFloatLE(x, 0); p.writeFloatLE(y, 4); p.writeUInt16LE(10, 8); p.writeUInt16LE(t.largeur ?? 12, 10);
		p[12] = 0; p[13] = 150;
		return p;
	}));
	const valeur = Buffer.concat([
		Buffer.from([3]), // un trait
		Buffer.from([0x14]), u32(t.outil ?? 15),
		Buffer.from([0x24]), u32(t.couleur ?? 0),
		Buffer.from([0x38]), f64(2),
		Buffer.from([0x44]), f32(0),
		Buffer.from([0x5c]), u32(points.length), points,
		id(0x6f, 1),
		...(t.argb === undefined ? [] : [Buffer.from([0x84, 0x01]), u32(t.argb)]),
	]);
	return bloc(5, Buffer.concat([
		id(0x1f, 1), id(0x2f, n), id(0x3f, 0), id(0x4f, 0),
		Buffer.from([0x54]), u32(0),
		Buffer.from([0x6c]), u32(valeur.length), valeur,
	]));
}

export function rmDeTest(traits: TraitDeTest[]): Buffer {
	return Buffer.concat([Buffer.from('reMarkable .lines file, version=6'.padEnd(43)), ...traits.map((t, i) => trait(t, i + 10))]);
}

/** Une page vide (`[]`) n'a pas de `.rm`, comme sur la tablette. */
export function rmdocDeTest(id: string, pages: TraitDeTest[][]): Buffer {
	const fichiers: Record<string, Uint8Array> = {
		[`${id}.content`]: strToU8(JSON.stringify({ cPages: { pages: pages.map((_, i) => ({ id: `p${i}`, idx: { value: `b${String.fromCharCode(97 + i)}` } })) } })),
	};
	pages.forEach((traits, i) => { if (traits.length) fichiers[`${id}/p${i}.rm`] = rmDeTest(traits); });
	return Buffer.from(zipSync(fichiers));
}
