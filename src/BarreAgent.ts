import { Component, Toolbar, type ToolbarItem, type WidgetHandle } from 'fragment';
import { OUTILS } from './ActionAgent';
import { deplacerParPoignee } from './fenetre';
import { rallonger, type Rallonge } from './rallonge';
import type { Repere } from './repere';
import type { Outil } from './repondre';

/** Ce que la barre fait faire au calque : elle ne connaît ni le chat ni la zone. */
export interface ActionsBarre {
    /** La tête de chat : ouvrir la conversation sur le passage. */
    onChat(): void;
    /** La croix : la barre est fermée (le calque ferme le chat avec elle). */
    onFermer(): void;
    /** Un outil : la barre va se résorber dans le rond de l'outil (ActionAgent). */
    onOutil(outil: Outil): void;
    /** Le micro : la barre va se résorber dans le rond du micro (VoixAgent). */
    onVoix(): void;
}

/**
 * La barre verticale qui apparaît à côté d'un passage surligné ou entouré.
 *
 * C'est la Toolbar du cœur (core/Toolbar.ts), la même que celle de
 * l'annotation : mêmes items, même aspect, même orientation verticale. De
 * haut en bas : une croix, la tête de chat, le micro, les deux outils favoris
 * (définir, visualiser) et « … », qui allonge la barre (rallonge.ts) et montre
 * aider, traduire, résumer.
 *
 * ★ COMMENT elle suit le texte : la Toolbar se monte dans le parent qu'on lui
 *   donne, et s'y borne. Son parent est ici un HÔTE 0×0, lui-même un widget
 *   ancré au document (Repere) : l'hôte défile avec la note, la barre avec lui.
 *   La Toolbar se pose à MARGE (8 px) du coin de son parent, d'où le décalage
 *   de l'hôte.
 *
 * ★ SA POIGNÉE est celle de la Toolbar, et on la traîne comme la barre
 *   d'annotation. Mais la Toolbar borne son déplacement à son parent, l'hôte
 *   0×0 : le geste est donc intercepté avant elle, et c'est l'ANCRE de l'hôte
 *   qui bouge (fenetre.ts). Posée ailleurs, la barre reste dans le texte et
 *   défile avec lui. Le double-clic, qui ferait pivoter la barre, est ignoré :
 *   la rallonge (« … ») ne sait allonger qu'une barre verticale.
 *
 * Échap la ferme, comme toute Toolbar.
 */
export class BarreAgent extends Component {

    /** La racine de la Toolbar, lue par le calque (le rond en sort). */
    get dom(): HTMLElement {
        return this.toolbar.dom;
    }

    /** La tête de chat : le chat s'aligne sur elle et en sort. */
    chatEl!: HTMLElement;

    private readonly toolbar: Toolbar;
    private readonly hote: HTMLElement;
    private handle: WidgetHandle | null = null;
    private readonly repere: Repere;
    private readonly actions: ActionsBarre;
    private rallonge: Rallonge | null = null;
    /** Vrai pendant cacher() : le démontage ne prévient pas le calque. */
    private silencieux = false;
    /** Vrai pendant que l'agent retire lui-même la Toolbar : ce n'est pas Échap. */
    private enRetrait = false;
    private plus!: ToolbarItem;
    private readonly caches: ToolbarItem[] = [];

    constructor(repere: Repere, actions: ActionsBarre) {
        super();
        this.repere = repere;
        this.actions = actions;

        this.hote = document.createElement('div');
        this.hote.classList.add('agent-barre-hote');

        this.toolbar = new Toolbar(this.hote);
        this.toolbar.dom.classList.add('agent-barre');
        this.toolbar.dom.setAttribute('role', 'toolbar');
        this.toolbar.dom.setAttribute('aria-orientation', 'vertical');
        this.toolbar.dom.setAttribute('aria-label', 'Agent');
        this.toolbar.setOrientation('vertical').setColumns(1);

        // L'aspect de l'agent (des ronds cerclés, la croix et « … » plus
        // discrets) est posé par ces classes, sur NOTRE barre seulement.
        this.toolbar.addItem((i) => {
            i.setIcon('x').setTooltip('Fermer').onClick(() => this.fermer());
            i.dom.classList.add('agent-barre-fermer');
        });
        this.toolbar.addItem((i) => {
            i.setIcon('cat').setTooltip("Discuter avec l'agent").onClick(() => this.actions.onChat());
            i.dom.classList.add('agent-barre-bouton');
            this.chatEl = i.dom;
        });
        this.toolbar.addItem((i) => {
            i.setIcon('mic').setTooltip("Parler à l'agent").onClick(() => this.actions.onVoix());
            i.dom.classList.add('agent-barre-bouton');
        });

        const outil = (id: Outil): ToolbarItem => {
            let item!: ToolbarItem;
            this.toolbar.addItem((i) => {
                item = i.setIcon(OUTILS[id].icone).setTooltip(OUTILS[id].libelle).onClick(() => this.actions.onOutil(id));
                i.dom.classList.add('agent-barre-bouton');
            });
            return item;
        };
        outil('definir');
        outil('visualiser');
        for (const id of ['aider', 'traduire', 'resumer'] as const) {
            const item = outil(id);
            item.dom.hidden = true;
            this.caches.push(item);
        }

        this.toolbar.addItem((i) => {
            this.plus = i.setIcon('ellipsis').setTooltip("Plus d'outils").onClick(() => this.allonger());
            i.dom.classList.add('agent-barre-plus');
        });

        // Échap (le seul geste de fermeture que la Toolbar a en propre) ferme
        // aussi la barre de l'agent : le calque doit le savoir.
        this.toolbar.onHide(() => {
            if (this._loaded && !this.enRetrait) this.fermer();
        });

        // La poignée déplace l'ancre de l'hôte, pas la Toolbar dans l'hôte.
        this.hote.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || !this.handle || !this.toolbar.handleEl.contains(e.target as Node)) return;
            deplacerParPoignee(e, this.toolbar.handleEl, this.toolbar.dom, this.handle, this.repere);
        }, true);
        this.hote.addEventListener('dblclick', (e) => {
            if (this.toolbar.handleEl.contains(e.target as Node)) e.stopPropagation();
        }, true);
    }

    estOuverte(): boolean {
        return this._loaded;
    }

    /** Montre la barre à côté du trait courant (Repere). */
    montrer(): void {
        if (this._loaded) this.retirerHote();
        this.load();
        this.handle = this.repere.monter(this.hote, () => {
            // La Toolbar doit être montrée pour se mesurer.
            this.toolbar.showAtPosition(0, 0);
            const a = this.repere.aCote(this.toolbar.dom);
            return a && a.mode === 'document' ? { ...a, dx: a.dx - DECALAGE, dy: a.dy - DECALAGE } : a;
        });
    }

    fermer(): void {
        this.unload();
    }

    /**
     * Retire la barre SANS la fermer au sens du calque : un outil prend sa
     * place, le passage reste visé. onFermer n'est pas appelé.
     */
    cacher(): void {
        this.silencieux = true;
        this.unload();
        this.silencieux = false;
    }

    onunload(): void {
        this.replier();
        this.retirerHote();
        if (!this.silencieux) this.actions.onFermer();
    }

    private retirerHote(): void {
        this.enRetrait = true;
        this.toolbar.hide();
        this.enRetrait = false;
        this.handle?.remove();
        this.handle = null;
        this.hote.remove();
    }

    /** « … » : la barre s'allonge vers le bas et montre les autres outils, puis « … » s'en va. */
    private allonger(): void {
        if (this.rallonge) return;
        const rallonge = rallonger(this.toolbar.dom, this.plus.dom, this.caches.map((i) => i.dom));
        this.rallonge = rallonge;
        void rallonge.fini.then(() => {
            // Fermée pendant l'animation : replier() a déjà tout remis.
            if (this.rallonge === rallonge) this.plus.dom.hidden = true;
        });
    }

    /** La barre est réutilisée d'un trait à l'autre : elle rouvre courte. */
    private replier(): void {
        this.rallonge?.annuler();
        this.rallonge = null;
        for (const i of this.caches) i.dom.hidden = true;
        this.plus.dom.hidden = false;
        this.plus.dom.style.display = '';
    }
}

/** La Toolbar se pose à MARGE_BORD (8 px) du coin de son parent, l'hôte 0×0. */
const DECALAGE = 8;
