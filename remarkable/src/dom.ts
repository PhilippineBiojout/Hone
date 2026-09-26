/** Un élément `tag`, avec sa classe et son texte, ajouté à `parent` s'il y en a un. */
export function creer<K extends keyof HTMLElementTagNameMap>(parent: Element | null, tag: K, classe = '', texte = ''): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	if (classe) el.className = classe;
	if (texte) el.textContent = texte;
	parent?.append(el);
	return el;
}
