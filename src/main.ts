import { Notice, Plugin } from 'fragment';
import { createAgentLayer } from './agentLayer';
import { RegistreTraces } from './interactions/registreTraces';
import { AGENTS, Bibliotheque, lireAtelier } from './atelier/bibliotheque';
import { Atelier } from './atelier/outils-atelier';
import { ouvrirMoteur } from './cerveau/moteur';
import { ouvrirMoteurCodex } from './cerveau/moteur-codex';
import { Journal } from './memoire/journal';
import { Memoire } from './memoire/outils-memoire';
import { lirePreferences, Preferences } from './memoire/preferences';
import { accesVault } from './cerveau/vault';
import { brancherCodex } from './codex/codex';
import { poserLeVerre } from './decor/verre';
import { CLE_GRADIUM, fusionner, ModalCle, type Reglages } from './reglages/reglages';
import { setupScan } from './scan/scan';
import { brancherRemarkable } from './remarkable/remarkable';

/** Le plugin Hone : un calque par vue. OpenAI tourne EN PAGE (plus de procès forké) ;
 *  la clé vit dans les données du plugin (réglages), saisie via la commande dédiée.
 *  L'atelier (les fonctions que les agents se fabriquent) vit à côté des réglages dans
 *  data.json ; il appartient au plugin, pas au moteur, qui est recréé à chaque réglage. */
export default class HonePlugin extends Plugin {
    private reglages: Reglages = fusionner(null);
    private atelier: Atelier | null = null;
    private memoire: Memoire | null = null;
    private fermerMoteur: (() => void) | null = null;
    private fermerCodex: (() => void) | null = null;

    async onload(): Promise<void> {
        // L'historique de la marge : traces.json, à côté de data.json. Il vit avec le plugin,
        // pas avec la vue, que le cœur remonte à chaque fichier ouvert.
        const adapter = this.app.vault.adapter;
        const fichierTraces = `${this.app.plugins.pluginsDir}/${this.manifest.id}/traces.json`;
        const traces = new RegistreTraces({
            lire: async () => ((await adapter.exists(fichierTraces)) ? adapter.read(fichierTraces) : null),
            ecrire: (texte) => adapter.write(fichierTraces, texte),
        });
        // Pas d'attente ici : le calque se déclare avant tout `await` (plus bas), et la marge se
        // redessine quand le fichier est lu (charger() prévient les vues).
        const tracesChargees = traces.charger();
        this.register(() => void traces.vider());
        this.registerEvent(this.app.vault.on('rename', (fichier, ancien) => traces.renommer(ancien, fichier.path)));
        this.registerEvent(this.app.vault.on('delete', (fichier) => traces.oublierDocument(fichier.path)));

        // Le cœur n'active un calque « d'office » que sur les vues ouvertes APRÈS sa déclaration :
        // déclaré après un `await`, il manquait à la note ouverte au démarrage (pas de barre).
        this.registerLayer({
            id: 'hone',
            name: 'Hone',
            icon: 'message-circle',
            defaultEnabled: true,
            appliesTo: (view) => view.leaf.parent !== null,
            create: (ctx) => createAgentLayer(ctx, traces),
        });

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

        // La mémoire : memoire.jsonl à côté de data.json, dans le dossier du plugin.
        const fichier = `${this.app.plugins.pluginsDir}/${this.manifest.id}/memoire.jsonl`;
        const journal = new Journal({
            lire: async () => ((await adapter.exists(fichier)) ? adapter.read(fichier) : null),
            ajouter: (texte) => adapter.append(fichier, texte),
        });
        await journal.charger();
        this.memoire = new Memoire(journal, new Preferences(lirePreferences(data), () => void this.sauver()), accesVault(this.app));

        await tracesChargees;

        this.relancerMoteur();
        this.register(() => this.fermerMoteur?.());
        this.register(() => this.fermerCodex?.());

        this.addCommand({
            id: 'cle-api',
            name: 'Hone : clé API…',
            callback: () => new ModalCle(this.app, this.reglages, (r) => void this.majReglages(r)).open(),
        });
        this.addCommand({
            id: 'cle-gradium',
            name: 'Hone : clé Gradium…',
            callback: () => new ModalCle(this.app, this.reglages, (r) => void this.majReglages(r), CLE_GRADIUM).open(),
        });

        poserLeVerre(this);
        setupScan(this);
        await brancherRemarkable(this);
        brancherCodex(this, () => this.reglages.codex);

    }

    /** Un seul moteur vivant de chaque sorte : l'ancien est libéré avant d'en créer un neuf.
     *  La bulle et les outils passent par Codex ; le moteur OpenAI reste en place sans être appelé. */
    private relancerMoteur(): void {
        this.fermerMoteur?.();
        this.fermerMoteur = ouvrirMoteur(this.app, this.reglages, this.atelier ?? undefined, this.memoire ?? undefined);
        this.fermerCodex?.();
        this.fermerCodex = ouvrirMoteurCodex(this.app, this.reglages, this.memoire ?? undefined);
    }

    /** data.json porte les réglages, la bibliothèque et les préférences : on écrit toujours tout. */
    private async sauver(): Promise<void> {
        await this.saveData({
            ...this.reglages, atelier: this.atelier?.bibliotheque.enJSON(), preferences: this.memoire?.preferences.toutes() ?? [],
        });
    }

    /** Enregistre les réglages et reconstruit le cerveau (nouvelle clé / modèles). */
    private async majReglages(r: Reglages): Promise<void> {
        this.reglages = r;
        await this.sauver();
        this.relancerMoteur();
        if (r.cle) new Notice('Clé Hone enregistrée.');
    }
}
