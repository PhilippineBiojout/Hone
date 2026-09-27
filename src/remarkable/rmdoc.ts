import { strFromU8, unzipSync } from 'fflate';
import { deflateSync } from 'zlib';

// Un carnet écrit à la main arrive en rmdoc (un zip : un `.rm` « lines v6 »
// par page, et le `.content` qui donne leur ordre), 20 fois plus vite que le
// PDF que rend la tablette. On en fait nous-mêmes le PDF, trait par trait.
// Lecture reprise de `rm.js` (prototype remarkable-live) ; géométrie, couleurs
// et surligneur mesurés sur le PDF que rend la Paper Pro.

type Rvb = [number, number, number];
/** Couleurs du PDF de la tablette ; noir pour une couleur pas encore relevée. */
const COULEURS: Record<number, Rvb> = { 6: [48, 74, 224], 7: [194, 49, 50], 12: [192, 127, 210] }; // bleu, rouge, magenta
const SURLIGNEURS = [5, 18];
const GOMMES = [6, 8];
// La page de la Paper Pro fait 1620 × 2160, x centré sur 0 : 514 × 685 pt
// (72/227 pt par unité). Une page étendue s'arrête 48 unités sous son dernier
// trait (mesuré sur les pages de Notes XIA, à un point près).
const LARGEUR = 1620;
const HAUTEUR = 2160;
const MARGE_BAS = 48;
const ECHELLE = 72 / 227;
/** Largeur du surligneur, en unités de la tablette. */
const SURLIGNEUR = 30;

interface Trait {
	outil: number;
	couleur: number;
	/** Couleur propre au trait (celle du surligneur), quand il en porte une. */
	rvb: Rvb | null;
	/** x, y, largeur */
	points: [number, number, number][];
}

// Une suite de blocs [u32 longueur, u8, u8, u8 version, u8 type, contenu],
// dont les valeurs sont précédées d'une étiquette varuint (index << 4 | type).
function lireTraits(buf: Buffer): Trait[] {
	let pos = 43; // en-tête « reMarkable .lines file, version=6 »
	const varuint = () => {
		let v = 0, decalage = 0, b;
		do { b = buf[pos++]; v += (b & 0x7f) * 2 ** decalage; decalage += 7; } while (b & 0x80);
		return v;
	};
	const u32 = () => { varuint(); pos += 4; return buf.readUInt32LE(pos - 4); }; // étiquette + u32
	const id = () => { varuint(); pos++; varuint(); }; // étiquette + identifiant (u8 + varuint)

	const traits: Trait[] = [];
	while (pos + 8 <= buf.length) {
		const longueur = buf.readUInt32LE(pos), version = buf[pos + 6], type = buf[pos + 7];
		pos += 8;
		const fin = pos + longueur;
		// Type 5 : un trait. On saute tous les autres blocs grâce à leur longueur.
		if (type === 5) {
			id(); id(); id(); id(); // parent, trait, voisins gauche et droit
			const efface = u32();
			// Un trait effacé n'a pas de valeur (sous-bloc 6, étiquette 0x6c).
			if (efface === 0 && pos < fin && buf[pos] === 0x6c) {
				pos += 6; // étiquette, longueur du sous-bloc, type d'élément
				const outil = u32(), couleur = u32();
				varuint(); pos += 8; // épaisseur
				varuint(); pos += 4; // longueur de départ
				const n = u32(); // taille du sous-bloc des points
				const taille = version === 1 ? 24 : 14;
				const points: Trait['points'] = [];
				for (let p = pos; p < pos + n; p += taille) {
					// v2 : f32 x, f32 y, u16 vitesse, u16 largeur, u8 direction, u8 pression.
					// v1 : six f32 dont la largeur en 5e, à multiplier par 4.
					const largeur = version === 1 ? buf.readFloatLE(p + 16) * 4 : buf.readUInt16LE(p + 10);
					points.push([buf.readFloatLE(p), buf.readFloatLE(p + 4), largeur]);
				}
				pos += n;
				// Après les points : horodatage (6), déplacement éventuel (7), puis
				// la couleur propre du trait (8, u32 en BGRA) s'il en a une.
				let rvb: Rvb | null = null;
				while (pos < fin) {
					const etiquette = buf[pos];
					if ((etiquette & 0xf) === 0xf) id();
					else if (etiquette === 0x84) { const c = u32(); rvb = [(c >> 16) & 255, (c >> 8) & 255, c & 255]; }
					else break;
				}
				traits.push({ outil, couleur, rvb, points });
			}
		}
		pos = fin;
	}
	return traits;
}

const nombre = (v: number) => v.toFixed(2);

/** Un point de la tablette en coordonnées PDF (« x y »). */
type Pt = (p: Trait['points'][number]) => string;

/** Le dessin d'une page en opérateurs PDF, et sa taille en points. */
function page(traits: Trait[]): { largeur: number; hauteur: number; dessin: string } {
	let bas = HAUTEUR;
	for (const t of traits) for (const [, y] of t.points) bas = Math.max(bas, y + MARGE_BAS);
	const hauteur = Math.round(bas * ECHELLE);
	// Le y du PDF monte depuis le bas ; la tablette cale la page en haut.
	const pt: Pt = ([x, y]) => `${nombre((x + LARGEUR / 2) * ECHELLE)} ${nombre(hauteur - y * ECHELLE)}`;
	const dessin = traits.filter((t) => !GOMMES.includes(t.outil) && t.points.length > 0).map((t) => trait(t, pt));
	return { largeur: Math.round(LARGEUR * ECHELLE), hauteur, dessin: `1 J 1 j\n${dessin.join('\n')}` };
}

/** Un trait en opérateurs PDF. */
function trait(t: Trait, pt: Pt): string {
	const [r, v, b] = (t.rvb ?? COULEURS[t.couleur] ?? [0, 0, 0]).map((c) => (c / 255).toFixed(3));
	// Un point seul (un « . ») : un segment nul, que le bout rond rend visible.
	const points = t.points.length > 1 ? t.points : [t.points[0], t.points[0]];
	// Le surligneur : une largeur fixe, et « Darken » pour ne pas couvrir l'encre.
	if (SURLIGNEURS.includes(t.outil) || t.couleur === 9) {
		const chemin = points.map((p, i) => `${pt(p)} ${i ? 'l' : 'm'}`).join('\n');
		return `q /Surligneur gs ${r} ${v} ${b} RG ${nombre(SURLIGNEUR * ECHELLE)} w\n${chemin}\nS Q`;
	}
	// Le stylo s'épaissit et s'affine le long du trait : chaque segment prend
	// la largeur de son point d'arrivée, et les segments de même largeur (au
	// centième de point) forment un seul chemin. Pas reproduit : la tablette
	// épaissit encore un long trait appuyé à fond (jusqu'à 3 fois), ce que
	// les points ne disent pas.
	const morceaux: string[] = [];
	let largeur = '';
	for (let i = 1; i < points.length; i++) {
		const w = nombre(Math.max(1, points[i][2] / 4) * ECHELLE);
		if (w !== largeur) {
			if (largeur) morceaux.push('S');
			morceaux.push(`${w} w ${pt(points[i - 1])} m`);
			largeur = w;
		}
		morceaux.push(`${pt(points[i])} l`);
	}
	return `q ${r} ${v} ${b} RG\n${morceaux.join('\n')}\nS Q`;
}

/** Le PDF d'un carnet, depuis son rmdoc. Une page sans trait n'a pas de `.rm` : elle reste blanche. */
export function rmdocEnPdf(zip: Uint8Array, id: string): Buffer {
	const fichiers = unzipSync(zip);
	const { cPages } = JSON.parse(strFromU8(fichiers[`${id}.content`])) as {
		cPages: { pages: { id: string; idx: { value: string }; deleted?: unknown }[] };
	};
	const ordre: (Uint8Array | undefined)[] = cPages.pages
		.filter((p) => !p.deleted)
		.sort((a, b) => (a.idx.value < b.idx.value ? -1 : 1))
		.map((p) => fichiers[`${id}/${p.id}.rm`]);
	if (ordre.length === 0) ordre.push(undefined); // un PDF sans page ne s'ouvre pas

	// Objets : 1 catalogue, 2 arbre des pages, puis pour chaque page son objet et son flux.
	const objets: (string | Buffer)[] = ['', ''];
	const kids: string[] = [];
	for (const rm of ordre) {
		const { largeur, hauteur, dessin } = page(rm ? lireTraits(Buffer.from(rm)) : []);
		const flux = deflateSync(dessin);
		const n = objets.length + 1;
		kids.push(`${n} 0 R`);
		objets.push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${largeur} ${hauteur}] ` +
				`/Resources << /ExtGState << /Surligneur << /BM /Darken >> >> >> /Contents ${n + 1} 0 R >>`,
			Buffer.concat([Buffer.from(`<< /Length ${flux.length} /Filter /FlateDecode >>\nstream\n`), flux, Buffer.from('\nendstream')]),
		);
	}
	objets[0] = '<< /Type /Catalog /Pages 2 0 R >>';
	objets[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
	return pdf(objets);
}

/** Le fichier PDF autour de ses objets, numérotés à partir de 1 (le catalogue). */
function pdf(objets: (string | Buffer)[]): Buffer {
	// L'en-tête, les objets numérotés, puis la table des positions (xref) qu'un lecteur PDF lit en premier.
	const morceaux = [Buffer.from('%PDF-1.4\n')];
	let taille = morceaux[0].length;
	const positions = objets.map((o, i) => {
		const position = taille;
		const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.from(o), Buffer.from('\nendobj\n')]);
		morceaux.push(b);
		taille += b.length;
		return position;
	});
	const xref = positions.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('');
	morceaux.push(Buffer.from(
		`xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${xref}` +
			`trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${taille}\n%%EOF\n`,
	));
	return Buffer.concat(morceaux);
}
