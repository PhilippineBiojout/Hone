import { Modal, type App } from 'fragment';

// Les réglages de Hone, rangés dans les données du plugin (Plugin.loadData/saveData).
// Il n'y a pas encore de PluginSettingTab dans l'API Fragment : on saisit la clé via
// un petit Modal maison.

/** Réglages du panneau Codex (pilote `codex app-server` en JSON-RPC). Édité à la
 *  main dans les données du plugin ; pas d'UI dédiée pour l'instant. */
export interface CodexSettings {
    /** Nom du binaire (résolu via PATH) ou chemin absolu. */
    codexPath: string;
    /** Id du modèle, ou null pour laisser le serveur choisir. */
    model: string | null;
    /** "never" | "on-request" | "on-failure" | "untrusted". */
    approvalPolicy: string;
    /** "read-only" | "workspace-write" | "danger-full-access". */
    sandbox: string;
}

export interface Reglages {
    /** La clé OpenAI. Vide → Hone répond en factice. */
    cle: string;
    /** La clé Gradium : l'oreille et la voix de la discussion orale. Vide → pas de voix. */
    gradiumCle: string;
    modeleFort: string;
    modeleLeger: string;
    /** Plafond de tokens par session (0 : sans plafond). */
    plafond: number;
    /** Force le mode factice même avec une clé (démos, tests). */
    factice: boolean;
    /** Les agents peuvent se fabriquer des fonctions (atelier/). La clé `atelier` de data.json
     *  est la bibliothèque elle-même : l'interrupteur a donc un autre nom. */
    atelierActif: boolean;
    /** Config du panneau Codex (fonctionnalité fusionnée depuis codex-on-fragment). */
    codex: CodexSettings;
}

export const CODEX_DEFAUT: CodexSettings = {
    codexPath: 'codex',
    model: null,
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
};

export const REGLAGES_DEFAUT: Reglages = {
    cle: '',
    gradiumCle: '',
    modeleFort: 'gpt-5.4',
    modeleLeger: 'gpt-5.4-mini',
    plafond: 500_000,
    factice: false,
    atelierActif: true,
    codex: CODEX_DEFAUT,
};

/** Complète les données lues du disque avec les défauts (données absentes ou partielles). */
export function fusionner(data: unknown): Reglages {
    const d = (data ?? {}) as Partial<Reglages>;
    const c = (d.codex ?? {}) as Partial<CodexSettings>;
    return {
        cle: typeof d.cle === 'string' ? d.cle : REGLAGES_DEFAUT.cle,
        gradiumCle: typeof d.gradiumCle === 'string' ? d.gradiumCle : REGLAGES_DEFAUT.gradiumCle,
        modeleFort: typeof d.modeleFort === 'string' && d.modeleFort ? d.modeleFort : REGLAGES_DEFAUT.modeleFort,
        modeleLeger: typeof d.modeleLeger === 'string' && d.modeleLeger ? d.modeleLeger : REGLAGES_DEFAUT.modeleLeger,
        plafond: typeof d.plafond === 'number' ? d.plafond : REGLAGES_DEFAUT.plafond,
        factice: d.factice === true,
        atelierActif: d.atelierActif !== false,
        codex: {
            codexPath: typeof c.codexPath === 'string' && c.codexPath ? c.codexPath : CODEX_DEFAUT.codexPath,
            model: typeof c.model === 'string' ? c.model : CODEX_DEFAUT.model,
            approvalPolicy: typeof c.approvalPolicy === 'string' && c.approvalPolicy ? c.approvalPolicy : CODEX_DEFAUT.approvalPolicy,
            sandbox: typeof c.sandbox === 'string' && c.sandbox ? c.sandbox : CODEX_DEFAUT.sandbox,
        },
    };
}

/** Ce qui distingue les deux clés dans le Modal de saisie. */
export interface SorteDeCle {
    titre: string;
    exemple: string;
    aide: string;
    champ: 'cle' | 'gradiumCle';
}

export const CLE_OPENAI: SorteDeCle = {
    titre: 'Hone — clé API OpenAI',
    exemple: 'sk-…',
    aide: 'La clé est stockée dans les données du plugin et n\'est utilisée que par Hone, en local. '
        + 'Sans clé, Hone répond en mode factice.',
    champ: 'cle',
};

export const CLE_GRADIUM: SorteDeCle = {
    titre: 'Hone — clé Gradium',
    exemple: 'gd_…',
    aide: 'La voix de Hone : Gradium écoute le micro et dit ses réponses. La clé est stockée dans les '
        + 'données du plugin, jamais dans le dépôt. Sans clé, la discussion orale ne démarre pas.',
    champ: 'gradiumCle',
};

/** Le Modal de saisie d'une clé (OpenAI ou Gradium). */
export class ModalCle extends Modal {
    constructor(
        app: App,
        private readonly reglages: Reglages,
        private readonly onEnregistrer: (r: Reglages) => void,
        private readonly sorte: SorteDeCle = CLE_OPENAI,
    ) {
        super(app);
    }

    onOpen(): void {
        this.setTitle(this.sorte.titre);

        const champ = document.createElement('input');
        champ.type = 'password';
        champ.placeholder = this.sorte.exemple;
        champ.value = this.reglages[this.sorte.champ];
        champ.style.width = '100%';
        champ.style.boxSizing = 'border-box';

        const aide = document.createElement('p');
        aide.textContent = this.sorte.aide;
        aide.style.color = 'var(--text-muted)';
        aide.style.fontSize = 'var(--font-ui-small)';

        const bouton = document.createElement('button');
        bouton.textContent = 'Enregistrer';
        const enregistrer = () => {
            this.onEnregistrer({ ...this.reglages, [this.sorte.champ]: champ.value.trim() });
            this.close();
        };
        bouton.addEventListener('click', enregistrer);
        champ.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') enregistrer();
        });

        this.contentEl.appendChild(champ);
        this.contentEl.appendChild(aide);
        this.contentEl.appendChild(bouton);
        champ.focus();
    }

    onClose(): void {
        this.contentEl.replaceChildren();
    }
}
