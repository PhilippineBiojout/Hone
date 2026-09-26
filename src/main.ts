import { Plugin } from 'fragment';
import * as path from 'path';
import { createAgentLayer } from './agentLayer';
import { ouvrirLien } from './pont/lienAgent';
import { brancherScan } from './scan/scan';
import { poserLeVerre } from './decor/verre';

/** Le plugin Agent : un calque par vue, et le processus de l'agent lancé au premier appel. */
export default class AgentPlugin extends Plugin {
    onload(): void {
        // La racine du vault, que le main du cœur passe à la fenêtre.
        const racine = process.argv.find((a) => a.startsWith('--vault-root='))?.slice('--vault-root='.length);
        if (racine) this.register(ouvrirLien(racine, path.join(racine, '.fragment', 'plugins', this.manifest.id)));
        this.registerLayer({
            id: 'agent',
            name: 'Agent',
            icon: 'message-circle',
            defaultEnabled: true,
            appliesTo: (view) => view.leaf.parent !== null,
            create: (ctx) => createAgentLayer(ctx),
        });
        poserLeVerre(this);
        brancherScan(this);
    }
}
