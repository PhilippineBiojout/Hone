import { FileView, Menu, setIcon, type View } from 'fragment';
import { creer } from './dom';
import { eclore } from './eclosion';
import type RemarkablePlugin from './main';

/**
 * En haut de chaque PDF qui vient de la tablette : une icône « débranchée »
 * quand la tablette n'est pas là, le mot « live » quand elle l'est. Un clic
 * ouvre une bulle juste en dessous : les étapes pour la brancher, ou ce que
 * veut dire le live. Le bouton est celui du cœur (`addAction`), la bulle son
 * menu, qui se ferme seul au clic ailleurs ou sur Échap. La bulle sort du
 * bouton comme la demande sort de l'icône (`eclosion.ts`).
 */
const boutons = new WeakMap<View, HTMLElement>();

export function majEntetes(plugin: RemarkablePlugin): void {
	const { registre, synchro } = plugin;
	for (const leaf of plugin.app.workspace.getLeavesOfType('pdf')) {
		const vue = leaf.view;
		if (!(vue instanceof FileView)) continue;
		const suivi = plugin.autorise === true && !!vue.file && registre.suivi(vue.file.path);
		let bouton = boutons.get(vue);

		if (!suivi) {
			bouton?.remove();
			boutons.delete(vue);
			continue;
		}
		if (!bouton) {
			bouton = vue.addAction('unplug', '', (evt) => bulle(evt.currentTarget as HTMLElement, synchro.connectee === true));
			bouton.classList.add('remarkable-statut');
			boutons.set(vue, bouton);
		}

		const live = synchro.connectee === true;
		if (bouton.dataset.live === String(live)) continue;
		bouton.dataset.live = String(live);
		bouton.setAttribute('aria-label', live ? 'Mode live' : 'Tablette non connectée');
		if (live) bouton.replaceChildren('live');
		else setIcon(bouton, 'unplug');
	}
}

/** La bulle d'état, sous `bouton`, ou à sa droite (l'icône du ruban). */
export function bulle(bouton: HTMLElement, live: boolean, aDroite = false): void {
	const menu = new Menu();
	menu.dom.classList.add('remarkable-bulle');
	if (live) {
		creer(menu.dom, 'p', '', 'Tout ce que tu écris sur la tablette apparaît sur ce PDF.');
	} else {
		creer(menu.dom, 'strong', '', 'Tablette non connectée');
		const etapes = creer(menu.dom, 'ol');
		creer(etapes, 'li', '', 'Branche la tablette en USB-C.');
		creer(etapes, 'li', '', 'Active l’interface web USB (Paramètres > Stockage).');
	}
	// Sous le bouton, bord droit aligné sur le sien, ou à sa droite, haut aligné
	// (le menu reste dans l'écran).
	const r = bouton.getBoundingClientRect();
	if (aDroite) menu.showAtPosition(r.right + 8, r.top);
	else {
		menu.showAtPosition(r.right, r.bottom + 4);
		menu.dom.style.left = `${Math.max(8, r.right - menu.dom.offsetWidth)}px`;
	}
	const eclosion = eclore(bouton, menu.dom);
	menu.onHide(() => eclosion.annuler());
}
