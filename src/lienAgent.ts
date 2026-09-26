import { fork, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Demande, Requete, Retour, Sortie } from './protocole';

// ═══════════════════════════════════════════════════════════════════════════
//  Le lien entre la page et le processus de l'agent (serveur/agent-serveur.ts).
//  Il lance le processus au premier besoin, lui envoie des demandes numérotées
//  et rend à chacune sa réponse. La clé n'arrive jamais ici : ce fichier ne
//  lit pas le .env, il ne voit passer que du texte.
//
//  ★ COMMENT on lance : `child_process.fork`, par le Node de la page (le
//    chargeur de plugins passe tout nom autre que `fragment` au require de
//    Node, et esbuild les laisse external). Le binaire est celui d'Electron
//    lui-même, en mode Node (ELECTRON_RUN_AS_NODE) : aucun Node à installer
//    à côté.
// ═══════════════════════════════════════════════════════════════════════════

/** Au-delà, la demande est abandonnée : un réseau qui pend ne laisse pas un rond tourner sans fin. */
const DELAI_MAX = 90_000;

interface EnAttente {
    resoudre(sortie: Sortie): void;
    rejeter(err: Error): void;
    morceau?(texte: string): void;
    minuterie: ReturnType<typeof setTimeout>;
}

/** Le message qu'une erreur de l'agent montre à l'utilisateur, tel quel. */
export class ErreurAgent extends Error {}

/** AGENT_BLOQUE=1 : l'agent ne répond pas, la page répond en factice (repondre.ts). */
export class AgentEnPause extends ErreurAgent {}

export class LienAgent {

    private enfant: ChildProcess | null = null;
    private prochainId = 1;
    private readonly enAttente = new Map<number, EnAttente>();

    constructor(
        private readonly racineVault: string,
        private readonly dossierPlugin: string,
    ) {}

    /**
     * Le plugin a un .env : on regarde qu'il EXISTE, sans le lire. Le contenu
     * (la clé) n'est lu que par le processus de l'agent.
     */
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
            const requete: Requete = { id, demande };
            enfant.send(requete);
        });
    }

    /** Au déchargement du plugin : le processus s'arrête, les demandes en cours échouent. */
    arreter(): void {
        this.enfant?.kill();
        this.enfant = null;
        this.toutRejeter('L\'agent a été arrêté.');
    }

    private lancer(): ChildProcess {
        if (this.enfant && this.enfant.connected) return this.enfant;
        const enfant = fork(path.join(this.dossierPlugin, 'agent-serveur.js'), [
            `--vault=${this.racineVault}`,
            `--plugin=${this.dossierPlugin}`,
        ], {
            execPath: process.execPath,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        });
        enfant.on('message', (m) => this.recevoir(m as Retour));
        // Mort en route (plantage, tué) : les demandes en cours échouent, la suivante le relance.
        enfant.on('exit', () => {
            if (this.enfant === enfant) this.enfant = null;
            this.toutRejeter('L\'agent s\'est arrêté, réessaie.');
        });
        this.enfant = enfant;
        return enfant;
    }

    private recevoir(retour: Retour): void {
        const attente = this.enAttente.get(retour.id);
        if (!attente) return;
        if (retour.type === 'morceau') {
            attente.morceau?.(retour.texte);
            return;
        }
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

// ── Le lien du plugin, unique ───────────────────────────────────────────────

let lien: LienAgent | null = null;

/** Appelé au chargement du plugin ; la fonction rendue l'arrête au déchargement. */
export function ouvrirLien(racineVault: string, dossierPlugin: string): () => void {
    lien = new LienAgent(racineVault, dossierPlugin);
    const courant = lien;
    return () => {
        courant.arreter();
        if (lien === courant) lien = null;
    };
}

/** Le lien, ou null : plugin pas chargé (tests unitaires, e2e en mode factice). */
export function lienCourant(): LienAgent | null {
    return lien;
}
