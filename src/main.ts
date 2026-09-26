import { Notice, Plugin } from 'fragment';
import { createAgentLayer } from './agentLayer';
import { ouvrirMoteur } from './cerveau/moteur';
import { poserLeVerre } from './decor/verre';
import { fusionner, ModalCle, type Reglages } from './reglages/reglages';
import { setupScan } from './scan/scan';

/** Le plugin Hone : un calque par vue. OpenAI tourne EN PAGE (plus de procès forké) ;
 *  la clé vit dans les données du plugin (réglages), saisie via la commande dédiée. */
export default class HonePlugin extends Plugin {
    private reglages: Reglages = fusionner(null);

    async onload(): Promise<void> {
        this.reglages = fusionner(await this.loadData());
        this.register(ouvrirMoteur(this.app, this.reglages));

        this.registerLayer({
            id: 'hone',
            name: 'Hone',
            icon: 'message-circle',
            defaultEnabled: true,
            appliesTo: (view) => view.leaf.parent !== null,
            create: (ctx) => createAgentLayer(ctx),
        });

        this.addCommand({
            id: 'cle-api',
            name: 'Hone : clé API…',
            callback: () => new ModalCle(this.app, this.reglages, (r) => void this.majReglages(r)).open(),
        });

        poserLeVerre(this);
        setupScan(this, () => this.reglages.cle);

        if (!this.reglages.cle) {
            new Notice('Hone : ajoute ta clé OpenAI via la commande « Hone : clé API… ».', 8000);
        }
    }

    /** Enregistre les réglages et reconstruit le cerveau (nouvelle clé / modèles). */
    private async majReglages(r: Reglages): Promise<void> {
        this.reglages = r;
        await this.saveData(r);
        this.register(ouvrirMoteur(this.app, r));
        if (r.cle) new Notice('Clé Hone enregistrée.');
    }
}
