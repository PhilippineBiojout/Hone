import { describe, expect, it } from 'vitest';
import { RefusChemin, verifierChemin } from '../cerveau/garde';

const refuse = (rel: string) => expect(() => verifierChemin(rel)).toThrow(RefusChemin);
const passe = (rel: string) => expect(() => verifierChemin(rel)).not.toThrow();

describe('verifierChemin', () => {
    it('accepte une note .md ou .txt relative', () => {
        passe('notes/cours.md');
        passe('a.txt');
        passe('dossier/sous/note.md');
    });
    it('refuse un chemin vide', () => {
        refuse('');
        refuse('   ');
    });
    it('refuse un chemin absolu ou une lettre de lecteur', () => {
        refuse('/etc/passwd');
        refuse('C:\\secret.md');
        refuse('\\\\serveur\\a.md');
    });
    it('refuse la sortie du vault et les dossiers cachés', () => {
        refuse('../dehors.md');
        refuse('.fragment/plugins/hone/x.md');
        refuse('dossier/../../x.md');
    });
    it('refuse une extension non lue', () => {
        refuse('image.png');
        refuse('sansext');
        refuse('a.md.exe');
    });
    it('refuse un octet nul', () => {
        refuse('a\0.md');
    });
});
