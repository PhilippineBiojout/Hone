import fs from 'node:fs';
import path from 'node:path';

interface Usage { inputTokens: number; outputTokens: number; requests: number }

/** Les tokens de chaque appel, dans `couts.jsonl`, et un plafond par session (0 : sans plafond). */
export class Compteur {
    private utilises = 0;

    constructor(private readonly journal: string, private readonly plafond: number) {}

    /** Le message à rendre si le plafond est atteint, sinon null. */
    refus(): string | null {
        return this.plafond > 0 && this.utilises >= this.plafond
            ? `Plafond de la session atteint (${this.plafond} tokens). Relance l'app ou monte AGENT_PLAFOND_TOKENS dans le .env du plugin.`
            : null;
    }

    noter(agent: string, modele: string, usage: Usage): void {
        this.utilises += usage.inputTokens + usage.outputTokens;
        const ligne = {
            date: new Date().toISOString(), agent, modele,
            entree: usage.inputTokens, sortie: usage.outputTokens, requetes: usage.requests, session: this.utilises,
        };
        try {
            fs.mkdirSync(path.dirname(this.journal), { recursive: true });
            fs.appendFileSync(this.journal, `${JSON.stringify(ligne)}\n`);
        } catch {
            // un journal qui ne s'écrit pas ne fait pas échouer la réponse
        }
    }
}
