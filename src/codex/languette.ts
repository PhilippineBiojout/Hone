/*
 * La languette : une petite pièce collée au bord gauche du dock droit, à
 * mi-hauteur, qui ouvre et ferme le panneau Codex. La tête de robot dit ce
 * qu'elle ouvre, la flèche dans quel sens elle va. Panneau fermé, elle reste
 * au bord droit de la fenêtre.
 *
 * Posée en `position: fixed` sur le body ; sa place suit le rectangle réel du
 * dock (ResizeObserver), donc l'animation du repli et le redimensionnement.
 */

import { setIcon, type Plugin } from "fragment";

export interface CommandesLanguette {
	/** Le panneau Codex est-il ouvert et visible ? */
	ouvert(): boolean;
	/** Ouvre s'il est fermé, ferme s'il est ouvert. */
	basculer(): Promise<void>;
}

/** Monte la languette ; elle part avec le plugin. */
export function poserLanguette(plugin: Plugin, commandes: CommandesLanguette): void {
	const workspace = plugin.app.workspace;
	const dock = workspace.rightSplit.containerEl;

	const el = document.createElement("div");
	el.className = "codex-languette";
	el.setAttribute("role", "button");
	const robot = el.appendChild(document.createElement("span"));
	robot.className = "codex-languette__robot";
	setIcon(robot, "bot");
	const fleche = el.appendChild(document.createElement("span"));
	fleche.className = "codex-languette__fleche";
	document.body.append(el);

	let sens: "ouvrir" | "fermer" | null = null;
	const placer = (): void => {
		const r = dock.getBoundingClientRect();
		// Dock sans hauteur (pas encore monté) : la hauteur de la fenêtre.
		const haut = r.height > 0 ? r.top : 0;
		const hauteur = r.height > 0 ? r.height : window.innerHeight;
		el.style.right = `${Math.max(0, window.innerWidth - r.left)}px`;
		el.style.top = `${haut + hauteur / 2}px`;
		const voulu = commandes.ouvert() ? "fermer" : "ouvrir";
		if (voulu !== sens) {
			sens = voulu;
			setIcon(fleche, voulu === "fermer" ? "chevron-right" : "chevron-left");
			el.setAttribute("aria-label", voulu === "fermer" ? "Fermer Codex" : "Ouvrir Codex");
			el.title = el.getAttribute("aria-label")!;
			el.classList.toggle("is-ouvert", voulu === "fermer");
		}
	};

	el.addEventListener("click", () => {
		void commandes.basculer().then(placer);
	});

	const observateur = new ResizeObserver(placer);
	observateur.observe(dock);
	window.addEventListener("resize", placer);
	plugin.registerEvent(workspace.on("layout-change", placer));
	plugin.registerEvent(workspace.on("active-leaf-change", placer));
	// Le repli anime la largeur : on replace à la fin de la transition aussi.
	plugin.registerDomEvent(dock, "transitionend", placer);
	placer();

	plugin.register(() => {
		observateur.disconnect();
		window.removeEventListener("resize", placer);
		el.remove();
	});
}
