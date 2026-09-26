import { Notice, Plugin } from 'fragment';
import { createAgentLayer } from './agentLayer';
import { AGENTS, Bibliotheque, lireAtelier } from './atelier/bibliotheque';
import { Atelier } from './atelier/outils-atelier';
import { ouvrirMoteur } from './cerveau/moteur';
import { accesVault } from './cerveau/vault';
import { poserLeVerre } from './decor/verre';
import { fusionner, ModalCle, type Reglages } from './reglages/reglages';
import { brancherScan } from './scan/scan';

/** Le plugin Hone : un calque par vue. OpenAI tourne EN PAGE (plus de procès forké) ;
 *  la clé vit dans les données du plugin (réglages), saisie via la commande dédiée.
 *  L'atelier (les fonctions que les agents se fabriquent) vit à côté des réglages dans
 *  data.json ; il appartient au plugin, pas au moteur, qui est recréé à chaque réglage. */
export default class HonePlugin extends Plugin {
    private reglages: Reglages = fusionner(null);
    private atelier: Atelier | null = null;
    private fermerMoteur: (() => void) | null = null;

    async onload(): Promise<void> {
        const data = await this.loadData();
        this.reglages = fusionner(data);
        this.atelier = new Atelier({
            bibliotheque: new Bibliotheque(lireAtelier(data)),
            acces: accesVault(this.app),
            commandes: {
                lister: () => this.app.commands.listCommands().map((c) => ({ id: c.id, name: c.name })),
                lancer: (id) => this.app.commands.executeCommandById(id),
            },
            ui: { ouvrir: (chemin) => this.app.workspace.openLinkText(chemin, '', false) },
            hote: this,
            sauver: () => void this.sauver(),
            notifier: (message) => new Notice(message, 6000),
        });
        this.atelier.declarerTout(AGENTS);
        this.relancerMoteur();
        this.register(() => this.fermerMoteur?.());

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
        brancherScan(this);

        if (!this.reglages.cle) {
            new Notice('Hone : ajoute ta clé OpenAI via la commande « Hone : clé API… ».', 8000);
        }
    }

    /** Un seul moteur vivant : l'ancien est libéré avant d'en créer un neuf. */
    private relancerMoteur(): void {
        this.fermerMoteur?.();
        this.fermerMoteur = ouvrirMoteur(this.app, this.reglages, this.atelier ?? undefined);
    }

    /** data.json porte les réglages ET la bibliothèque : on écrit toujours les deux. */
    private async sauver(): Promise<void> {
        await this.saveData({ ...this.reglages, atelier: this.atelier?.bibliotheque.enJSON() });
    }

    /** Enregistre les réglages et reconstruit le cerveau (nouvelle clé / modèles). */
    private async majReglages(r: Reglages): Promise<void> {
        this.reglages = r;
        await this.sauver();
        this.relancerMoteur();
        if (r.cle) new Notice('Clé Hone enregistrée.');
    }
}
