// La carte qui sort d'une icône : copie d'`eclore()` et de ce qu'elle utilise,
// depuis le plugin agent (`plugins/agent/src/animations.ts`), l'animation d'une
// réponse qu'on rouvre depuis son icône. Un plugin ne peut pas importer le code
// d'un autre ; seules les classes changent (`remarkable-eclosion*`).
// Les gestes de l'agent, repris de Skiper sans React ni Motion : l'API Web
// Animations et un ressort calculé ici.

import { creer } from './dom';

export interface Eclosion {
	/** Résolue quand tout est posé et nettoyé. */
	fini: Promise<void>;
	/** Arrête tout et laisse l'élément dans son état final. */
	annuler(): void;
}

let compteur = 0;

const px = (n: number): string => `${n}px`;
const sansMouvement = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** `v` ramené dans [min, max]. */
const borne = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

/**
 * Des animations annulables. `suite` s'enchaîne si rien n'est annulé ; à la fin
 * comme à l'annulation, toutes sont annulées et `nettoyer` passe.
 */
function annulable(animations: Animation[], nettoyer: () => void, suite?: () => unknown): Eclosion {
	let annule = false;
	const toutNettoyer = (): void => {
		for (const a of animations) a.cancel();
		nettoyer();
	};
	const fini = Promise.all(animations.map((a) => a.finished))
		.then(() => (annule ? undefined : suite?.()))
		.then(() => undefined)
		// Une animation annulée rejette `finished` : c'est la fermeture, pas une erreur.
		.catch(() => {})
		.finally(() => {
			if (!annule) toutNettoyer();
		});
	return {
		fini,
		annuler: () => {
			if (annule) return;
			annule = true;
			toutNettoyer();
		},
	};
}

/**
 * Le ressort en easing CSS `linear()` : x'' = −k(x − 1) − c·x', relevé toutes
 * les 10 ms jusqu'au repos, rebond compris. Défaut : le LOGO_SPRING de Skiper.
 */
export function ressort(raideur = 300, amortissement = 30): { easing: string; duree: number } {
	const dt = 1 / 1000;
	let x = 0;
	let v = 0;
	let t = 0;
	const releves: number[] = [0];
	for (let pas = 0; pas < 2000; pas++) {
		v += (-raideur * (x - 1) - amortissement * v) * dt;
		x += v * dt;
		t += dt;
		if (pas % 10 === 9) releves.push(x);
		if (Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) break;
	}
	releves.push(1);
	return { easing: `linear(${releves.map((r) => Math.round(r * 1000) / 1000).join(', ')})`, duree: Math.round(t * 1000) };
}

/**
 * La bulle SORT du bouton comme une goutte (Skiper64) : dans un calque fantôme,
 * un rond reste sur le bouton, un autre file puis s'étire jusqu'à la bulle, et
 * le filtre goo les soude. Le fantôme, pas la bulle : le flou rendrait le texte
 * illisible. `bulle` doit être montée et placée. `vitesse` 2 : deux fois plus
 * vite, même geste (le ressort garde son rebond).
 */
export function eclore(bouton: HTMLElement | DOMRect, bulle: HTMLElement, vitesse = 1): Eclosion {
	const parent = bulle.parentElement;
	if (sansMouvement() || !parent) {
		bulle.style.opacity = '';
		return { fini: Promise.resolve(), annuler: () => {} };
	}
	const rb = bulle.getBoundingClientRect();
	// Une boîte : le bouton a pu être retiré (la tête de chat d'une carte qui devient le chat).
	const rk = bouton instanceof DOMRect ? bouton : bouton.getBoundingClientRect();
	// La translation client → repère du parent positionné de la bulle (placée en left/top).
	const dx = parseFloat(bulle.style.left || '0') - rb.left;
	const dy = parseFloat(bulle.style.top || '0') - rb.top;
	const cible = { x: rb.left + dx, y: rb.top + dy, w: rb.width, h: rb.height };
	const d = Math.min(rk.width, rk.height);
	const depuis = { x: rk.left + dx + (rk.width - d) / 2, y: rk.top + dy + (rk.height - d) / 2, w: d, h: d };
	// Le point de la bulle le plus proche du bouton : la goutte y file, puis s'ouvre.
	const depart = { x: borne(depuis.x, cible.x, cible.x + cible.w - d), y: borne(depuis.y, cible.y, cible.y + cible.h - d), w: d, h: d };

	// Le flou déborde des formes : 24 px de marge pour que le filtre ne le rogne pas.
	const gauche = Math.min(depuis.x, cible.x) - 24;
	const haut = Math.min(depuis.y, cible.y) - 24;
	const id = `remarkable-goo-${++compteur}`;
	const fantome = creer(null, 'div', 'remarkable-eclosion');
	Object.assign(fantome.style, {
		left: px(gauche),
		top: px(haut),
		width: px(Math.max(depuis.x + d, cible.x + cible.w) + 24 - gauche),
		height: px(Math.max(depuis.y + d, cible.y + cible.h) + 24 - haut),
		filter: `url(#${id})`,
	});
	// Un flou, puis l'alpha poussé (×20 − 7) : deux formes proches se soudent.
	fantome.innerHTML = `<svg width="0" height="0" style="position:absolute"><defs><filter id="${id}">`
		+ '<feGaussianBlur in="SourceGraphic" stdDeviation="4.4" result="blur"/>'
		+ '<feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -7" result="goo"/>'
		+ '<feBlend in="SourceGraphic" in2="goo"/></filter></defs></svg>';
	type Boite = { x: number; y: number; w: number; h: number };
	/** Une boîte en left/top/width/height, dans le repère du fantôme. */
	const place = (r: Boite) => ({ left: px(r.x - gauche), top: px(r.y - haut), width: px(r.w), height: px(r.h) });
	const forme = (r: Boite): HTMLElement => {
		const el = creer(fantome, 'div', 'remarkable-eclosion-forme');
		Object.assign(el.style, { ...place(r), borderRadius: '50%' });
		return el;
	};
	forme(depuis);
	const goutte = forme(depart);
	bulle.style.opacity = '0';
	parent.appendChild(fantome);

	// Raideur × v², amortissement × v : le même ressort, v fois plus rapide.
	const { easing, duree } = ressort(300 * vitesse ** 2, 30 * vitesse);
	// L'étirement part 150 ms après le rond (Skiper), et prend la teinte de la bulle.
	const etire = { duration: duree, delay: 150 / vitesse, fill: 'both' as const };
	const animations = [
		goutte.animate([{ translate: `${depuis.x - depart.x}px ${depuis.y - depart.y}px` }, { translate: '0px 0px' }],
			{ duration: duree, easing, fill: 'both' }),
		goutte.animate([
			{ ...place(depart), borderRadius: px(d / 2) },
			{ ...place(cible), borderRadius: '12px' },
		], { ...etire, easing }),
		// Couleurs résolues ici : l'interpolation se fait en rgb, sans éclair au fondu.
		goutte.animate([{ backgroundColor: getComputedStyle(goutte).backgroundColor }, { backgroundColor: getComputedStyle(bulle).backgroundColor }],
			{ ...etire, easing: 'ease-in' }),
	];
	return annulable(animations, () => {
		fantome.remove();
		bulle.style.opacity = '';
	}, () => {
		const fondu = { duration: 140 / vitesse, easing: 'ease-out' };
		const fin = [
			bulle.animate([{ opacity: 0 }, { opacity: 1 }], fondu),
			fantome.animate([{ opacity: 1 }, { opacity: 0 }], { ...fondu, fill: 'forwards' }),
		];
		animations.push(...fin);
		bulle.style.opacity = '';
		return Promise.all(fin.map((a) => a.finished));
	});
}
