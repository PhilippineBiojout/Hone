import { FileView, Menu, setIcon, type View } from 'fragment';
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

function bulle(bouton: HTMLElement, live: boolean): void {
	const menu = new Menu();
	menu.dom.classList.add('remarkable-bulle');
	const el = (tag: string, texte: string) => {
		const e = document.createElement(tag);
		e.textContent = texte;
		return e;
	};
	if (live) {
		menu.dom.append(el('p', 'Tout ce que tu écris sur la tablette apparaît sur ce PDF.'));
	} else {
		const etapes = document.createElement('ol');
		etapes.append(
			el('li', 'Branche la tablette en USB-C.'),
			el('li', 'Active l’interface web USB (Paramètres > Stockage).'),
		);
		menu.dom.append(el('strong', 'Tablette non connectée'), etapes);
	}
	// Sous le bouton, bord droit aligné sur le sien (le menu reste dans l'écran).
	const r = bouton.getBoundingClientRect();
	menu.showAtPosition(r.right, r.bottom + 4);
	menu.dom.style.left = `${Math.max(8, r.right - menu.dom.offsetWidth)}px`;
	const eclosion = eclore(bouton, menu.dom);
	menu.onHide(() => eclosion.annuler());
}
