import { Plugin } from 'fragment';
import * as path from 'path';
import { createAgentLayer } from './agentLayer';
import { ouvrirLien } from './lienAgent';

// ═══════════════════════════════════════════════════════════════════════════
//  Le plugin « Agent » : une barre qui s'ouvre sur un trait d'annotation, et
//  la conversation qu'elle lance. Il ne fait qu'inscrire un calque ; tout le
//  reste est monté par vue et meurt avec elle.
//
//  Plugin communautaire : il vit dans <vault>/.fragment/plugins/agent/, hors
//  du cœur. Le chargeur (core/plugins.ts) lit main.js et styles.css.
// ═══════════════════════════════════════════════════════════════════════════

export default class AgentPlugin extends Plugin {
    onload(): void {
        // Le processus de l'agent (lienAgent.ts) : lancé au premier appel, arrêté au déchargement.
        const racine = racineDuVault();
        if (racine) {
            this.register(ouvrirLien(racine, path.join(racine, '.fragment', 'plugins', this.manifest.id)));
        }
        this.registerLayer({
            id: 'agent',
            name: 'Agent',
            icon: 'message-circle',
            // Activé d'office, contrairement au dessin : il ne s'arme sur rien,
            // il attend un trait d'annotation.
            defaultEnabled: true,
            // Même garde que doc-widget et annotation : pas dans une feuille flottante.
            appliesTo: (view) => view.leaf.parent !== null,
            create: (ctx) => createAgentLayer(ctx),
        });
    }
}

/** La racine du vault, que main.ts du cœur passe à la fenêtre (src/shared/racineDuCoffre.ts). */
function racineDuVault(): string | null {
    const arg = process.argv.find((a) => a.startsWith('--vault-root='));
    return arg ? arg.slice('--vault-root='.length) : null;
}
