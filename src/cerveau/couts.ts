interface Usage { inputTokens: number; outputTokens: number }

/** Compte les tokens de la session et applique un plafond (0 : sans plafond).
 *  En mémoire : plus de journal disque (on tournait avec node:fs, hors renderer). */
export class Compteur {
    private utilises = 0;

    constructor(private readonly plafond: number) {}

    /** Le message à rendre si le plafond est atteint, sinon null. */
    refus(): string | null {
        return this.plafond > 0 && this.utilises >= this.plafond
            ? `Plafond de la session atteint (${this.plafond} tokens). Relance l'app ou monte le plafond dans les réglages de Hone.`
            : null;
    }

    noter(usage: Usage): void {
        this.utilises += usage.inputTokens + usage.outputTokens;
    }
}
