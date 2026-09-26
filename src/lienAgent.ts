import { fork, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Demande, Requete, Retour, Sortie } from './protocole';

/** Le message d'une erreur de l'agent, montré tel quel. */
export class ErreurAgent extends Error {}
/** AGENT_BLOQUE=1 : la page répond en factice (repondre.ts). */
export class AgentEnPause extends ErreurAgent {}

const DELAI_MAX = 90_000;

interface EnAttente {
    resoudre(sortie: Sortie): void;
    rejeter(err: Error): void;
    morceau?(texte: string): void;
    minuterie: ReturnType<typeof setTimeout>;
}

/**
 * Le processus de l'agent, lancé au premier besoin avec le binaire d'Electron en
 * mode Node. La clé n'arrive jamais ici : ce fichier ne lit pas le .env.
 */
export class LienAgent {
    private enfant: ChildProcess | null = null;
    private prochainId = 1;
    private readonly enAttente = new Map<number, EnAttente>();

    constructor(private readonly racineVault: string, private readonly dossierPlugin: string) {}

    /** Le .env existe (on ne le lit pas). */
    configure(): boolean {
        return fs.existsSync(path.join(this.dossierPlugin, '.env'));
    }

    demander(demande: Demande, morceau?: (texte: string) => void): Promise<Sortie> {
        const enfant = this.lancer();
        const id = this.prochainId++;
        return new Promise<Sortie>((resoudre, rejeter) => {
            const minuterie = setTimeout(() => {
                this.enAttente.delete(id);
                rejeter(new ErreurAgent('L\'agent met trop de temps à répondre.'));
            }, DELAI_MAX);
            this.enAttente.set(id, { resoudre, rejeter, morceau, minuterie });
            enfant.send({ id, demande } satisfies Requete);
        });
    }

    arreter(): void {
        this.enfant?.kill();
        this.enfant = null;
        this.toutRejeter('L\'agent a été arrêté.');
    }

    private lancer(): ChildProcess {
        if (this.enfant?.connected) return this.enfant;
        const enfant = fork(path.join(this.dossierPlugin, 'agent-serveur.js'),
            [`--vault=${this.racineVault}`, `--plugin=${this.dossierPlugin}`], {
                execPath: process.execPath,
                env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
                stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
            });
        enfant.on('message', (m) => this.recevoir(m as Retour));
        // Mort en route : les demandes en cours échouent, la suivante le relance.
        enfant.on('exit', () => {
            if (this.enfant === enfant) this.enfant = null;
            this.toutRejeter('L\'agent s\'est arrêté, réessaie.');
        });
        return this.enfant = enfant;
    }

    private recevoir(retour: Retour): void {
        const attente = this.enAttente.get(retour.id);
        if (!attente) return;
        if (retour.type === 'morceau') return attente.morceau?.(retour.texte);
        clearTimeout(attente.minuterie);
        this.enAttente.delete(retour.id);
        if (retour.type === 'fin') attente.resoudre(retour.sortie);
        else if (retour.type === 'pause') attente.rejeter(new AgentEnPause('Agent en pause (AGENT_BLOQUE=1).'));
        else attente.rejeter(new ErreurAgent(retour.message));
    }

    private toutRejeter(message: string): void {
        for (const [id, attente] of this.enAttente) {
            clearTimeout(attente.minuterie);
            attente.rejeter(new ErreurAgent(message));
            this.enAttente.delete(id);
        }
    }
}

let lien: LienAgent | null = null;

/** Au chargement du plugin ; la fonction rendue l'arrête au déchargement. */
export function ouvrirLien(racineVault: string, dossierPlugin: string): () => void {
    const courant = lien = new LienAgent(racineVault, dossierPlugin);
    return () => {
        courant.arreter();
        if (lien === courant) lien = null;
    };
}

/** Null hors du plugin chargé (tests, e2e en factice). */
export function lienCourant(): LienAgent | null {
    return lien;
}
