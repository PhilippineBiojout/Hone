import { Component, Toolbar, type ToolbarItem, type WidgetHandle } from 'fragment';
import { rallonger, type Rallonge } from '../ui/animations';
import { deplacerParPoignee } from '../positionnement/fenetre';
import { MARGE } from '../positionnement/placement';
import type { Outil } from '../pont/protocole';
import type { Repere } from '../positionnement/repere';
import { OUTILS } from '../ui/ui';

/** Ce que la barre fait faire au calque : elle ne connaît ni le chat ni la zone. */
export interface ActionsBarre {
    onChat(): void;
    /** Échap ou un clic à côté : le calque ferme le chat avec elle. */
    onFermer(): void;
    /** Un clic à côté ne ferme la barre que si rien ne se tient à côté d'elle (le chat). */
    seule(): boolean;
    /** Un outil : la barre va se résorber dans le rond de l'outil. */
    onOutil(outil: Outil): void;
    /** Le micro : la barre va se résorber dans le rond du micro. */
    onVoix(): void;
}

/** La Toolbar du cœur se pose à 8 px (MARGE_BORD) du coin de son parent. */
const DECALAGE = 8;

/**
 * La barre horizontale au-dessus d'un passage : une Toolbar du cœur, montée dans un
 * hôte 0×0 qui est un widget ancré au document. Sa poignée déplace l'ancre de
 * l'hôte (la Toolbar se bornerait à lui) ; le double-clic, qui la ferait
 * pivoter, est ignoré : « … » n'allonge qu'une barre horizontale.
 */
export class BarreAgent extends Component {

    /** La tête de chat : le chat en sort. */
    chatEl!: HTMLElement;

    private readonly toolbar: Toolbar;
    private readonly hote = document.createElement('div');
    private handle: WidgetHandle | null = null;
    private rallonge: Rallonge | null = null;
    /** Vrai pendant cacher() : le démontage ne prévient pas le calque. */
    private silencieux = false;
    /** Vrai pendant que l'agent retire lui-même la Toolbar : ce n'est pas Échap. */
    private enRetrait = false;
    private plus!: ToolbarItem;
    private readonly caches: ToolbarItem[] = [];

    constructor(private readonly repere: Repere, private readonly actions: ActionsBarre) {
        super();
        this.hote.classList.add('agent-barre-hote');
        this.toolbar = new Toolbar(this.hote);
        const dom = this.toolbar.dom;
        dom.classList.add('agent-barre');
        dom.setAttribute('role', 'toolbar');
        dom.setAttribute('aria-orientation', 'horizontal');
        dom.setAttribute('aria-label', 'Agent');

        const item = (icone: string, libelle: string, onClick: () => void, classe = 'agent-barre-bouton'): ToolbarItem => {
            let cree!: ToolbarItem;
            this.toolbar.addItem((i) => {
                cree = i.setIcon(icone).setTooltip(libelle).onClick(onClick);
                i.dom.classList.add(classe);
            });
            return cree;
        };
        this.chatEl = item('cat', "Discuter avec Hone", () => this.actions.onChat()).dom;
        item('mic', "Parler à Hone", () => this.actions.onVoix());
        this.toolbar.addSeparator();
        for (const id of ['definir', 'visualiser', 'aider', 'traduire', 'resumer'] as const) {
            const outil = item(OUTILS[id].icone, OUTILS[id].libelle, () => this.actions.onOutil(id));
            if (id === 'definir' || id === 'visualiser') continue;
            outil.dom.hidden = true;
            this.caches.push(outil);
        }
        this.toolbar.addSeparator();
        this.plus = item('ellipsis', "Plus d'outils", () => this.allonger(), 'agent-barre-plus');

        // Échap, le seul geste de fermeture propre à la Toolbar, ferme aussi la barre de l'agent.
        this.toolbar.onHide(() => {
            if (this._loaded && !this.enRetrait) this.fermer();
        });
        this.hote.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || !this.handle || !this.toolbar.handleEl.contains(e.target as Node)) return;
            deplacerParPoignee(e, this.toolbar.handleEl, dom, this.handle, this.repere);
        }, true);
        this.hote.addEventListener('dblclick', (e) => {
            if (this.toolbar.handleEl.contains(e.target as Node)) e.stopPropagation();
        }, true);
    }

    /** La racine de la Toolbar : le rond en sort. */
    get dom(): HTMLElement {
        return this.toolbar.dom;
    }

    estOuverte(): boolean {
        return this._loaded;
    }

    onload(): void {
        // Un clic à côté la ferme, comme Échap. Les barres et menus de l'app n'en sont pas :
        // choisir une couleur d'annotation ne doit pas la faire partir.
        this.registerDomEvent(document, 'pointerdown', (e) => {
            const cible = e.target as Element | null;
            if (!cible || this.hote.contains(cible) || cible.closest('.toolbar, .menu')) return;
            if (!this.actions.seule()) return;
            this.fermer();
            // Sur le calque d'annotation, ce clic ne fait que fermer : il ne pose pas de point.
            if (cible.closest('.annotation-surface')) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);
    }

    /** Montre la barre au-dessus du trait courant. */
    montrer(): void {
        if (this._loaded) this.retirerHote();
        this.load();
        this.handle = this.repere.monter(this.hote, () => {
            // La Toolbar doit être montrée pour se mesurer.
            this.toolbar.showAtPosition(0, 0);
            const a = this.repere.auDessus(this.toolbar.dom);
            return a?.mode === 'document' ? { ...a, dx: a.dx - DECALAGE, dy: a.dy - DECALAGE } : a;
        });
    }

    fermer(): void {
        this.unload();
    }

    /** Retire la barre sans prévenir le calque : un outil prend sa place, le passage reste visé. */
    cacher(): void {
        this.silencieux = true;
        this.unload();
        this.silencieux = false;
    }

    onunload(): void {
        // La barre est réutilisée d'un trait à l'autre : elle rouvre courte.
        this.rallonge?.annuler();
        this.rallonge = null;
        for (const i of this.caches) i.dom.hidden = true;
        this.plus.dom.hidden = false;
        this.plus.dom.style.display = '';
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

    /** Plus large, la barre peut sortir du pane : on la recentre alors sur le passage. */
    private rentrer(): void {
        const pane = this.repere.paneClient();
        const r = this.toolbar.dom.getBoundingClientRect();
        if (!this.handle || (r.right <= pane.right - MARGE && r.left >= pane.left + MARGE)) return;
        const a = this.repere.auDessus(this.toolbar.dom);
        if (a?.mode === 'document') this.handle.setAnchor({ ...a, dx: a.dx - DECALAGE, dy: a.dy - DECALAGE });
    }

    /** « … » : la barre s'élargit et montre les autres outils, puis « … » s'en va. */
    private allonger(): void {
        if (this.rallonge) return;
        const rallonge = rallonger(this.toolbar.dom, this.plus.dom, this.caches.map((i) => i.dom), () => this.rentrer());
        this.rallonge = rallonge;
        // Fermée pendant l'animation : onunload a déjà tout remis.
        void rallonge.fini.then(() => {
            if (this.rallonge === rallonge) this.plus.dom.hidden = true;
        });
    }
}
