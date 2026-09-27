import { Menu } from 'fragment';
import { creer } from './dom';
import { eclore } from './eclosion';
import type { Etat } from './synchro';

/** Déconnectée, on ne nomme que l'étape qui manque. */
const ETAPE: Record<Exclude<Etat, 'live'>, string> = {
	cable: 'Branche la tablette en USB-C.',
	interface: 'Active l’interface web USB (Paramètres > Stockage).',
};

/** La bulle d'état, au-dessus de `bouton` (l'item de la barre d'état) ou à sa droite (l'icône du ruban). */
export function bulle(bouton: HTMLElement, etat: Etat | null, ou: 'dessus' | 'droite'): void {
	const menu = new Menu();
	menu.dom.classList.add('remarkable-bulle');
	if (etat === 'live') {
		creer(menu.dom, 'p', '', 'Tout ce que tu écris sur la tablette apparaît dans reMarkable/.');
	} else {
		creer(menu.dom, 'strong', '', 'reMarkable déconnectée');
		creer(menu.dom, 'p', '', ETAPE[etat ?? 'cable']);
	}
	const r = bouton.getBoundingClientRect();
	if (ou === 'droite') {
		menu.showAtPosition(r.right + 8, r.top);
		// Deux fois plus vite que la carte de la demande : la bulle ne fait que renseigner.
		const eclosion = eclore(bouton, menu.dom, 2);
		menu.onHide(() => eclosion.annuler());
	} else {
		// Bord droit aligné sur celui du bouton, bas à 4 px au-dessus.
		// Au clic sur le statut, pas d'animation pour l'instant (elle est à refaire).
		menu.showAtPosition(r.right, r.top);
		menu.dom.style.left = `${Math.max(8, r.right - menu.dom.offsetWidth)}px`;
		menu.dom.style.top = `${Math.max(8, r.top - 4 - menu.dom.offsetHeight)}px`;
	}
}
