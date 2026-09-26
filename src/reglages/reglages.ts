import { Modal, type App } from 'fragment';

// Les réglages de Hone, rangés dans les données du plugin (Plugin.loadData/saveData).
// Il n'y a pas encore de PluginSettingTab dans l'API Fragment : on saisit la clé via
// un petit Modal maison.

export interface Reglages {
    /** La clé OpenAI. Vide → Hone répond en factice. */
    cle: string;
    modeleFort: string;
    modeleLeger: string;
    /** Plafond de tokens par session (0 : sans plafond). */
    plafond: number;
    /** Force le mode factice même avec une clé (démos, tests). */
    factice: boolean;
}

export const REGLAGES_DEFAUT: Reglages = {
    cle: '',
    modeleFort: 'gpt-5.4',
    modeleLeger: 'gpt-5.4-mini',
    plafond: 500_000,
    factice: false,
};

/** Complète les données lues du disque avec les défauts (données absentes ou partielles). */
export function fusionner(data: unknown): Reglages {
    const d = (data ?? {}) as Partial<Reglages>;
    return {
        cle: typeof d.cle === 'string' ? d.cle : REGLAGES_DEFAUT.cle,
        modeleFort: typeof d.modeleFort === 'string' && d.modeleFort ? d.modeleFort : REGLAGES_DEFAUT.modeleFort,
        modeleLeger: typeof d.modeleLeger === 'string' && d.modeleLeger ? d.modeleLeger : REGLAGES_DEFAUT.modeleLeger,
        plafond: typeof d.plafond === 'number' ? d.plafond : REGLAGES_DEFAUT.plafond,
        factice: d.factice === true,
    };
}

/** Le Modal de saisie de la clé API. */
export class ModalCle extends Modal {
    constructor(
        app: App,
        private readonly reglages: Reglages,
        private readonly onEnregistrer: (r: Reglages) => void,
    ) {
        super(app);
    }

    onOpen(): void {
        this.setTitle('Hone — clé API OpenAI');

        const champ = document.createElement('input');
        champ.type = 'password';
        champ.placeholder = 'sk-…';
        champ.value = this.reglages.cle;
        champ.style.width = '100%';
        champ.style.boxSizing = 'border-box';

        const aide = document.createElement('p');
        aide.textContent = 'La clé est stockée dans les données du plugin et n\'est utilisée que par Hone, en local. '
            + 'Sans clé, Hone répond en mode factice.';
        aide.style.color = 'var(--text-muted)';
        aide.style.fontSize = 'var(--font-ui-small)';

        const bouton = document.createElement('button');
        bouton.textContent = 'Enregistrer';
        const enregistrer = () => {
            this.onEnregistrer({ ...this.reglages, cle: champ.value.trim() });
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
