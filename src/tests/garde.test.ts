// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cheminSur, fichiersLisibles, RefusChemin } from '../serveur/garde';

// Un faux vault, et un dossier « dehors » que les liens symboliques visent.
let base: string;
let vault: string;

beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'garde-'));
    vault = path.join(base, 'vault');
    const dehors = path.join(base, 'dehors');
    fs.mkdirSync(path.join(vault, 'cours'), { recursive: true });
    fs.mkdirSync(path.join(vault, '.fragment/plugins/agent'), { recursive: true });
    fs.mkdirSync(path.join(vault, '.git'), { recursive: true });
    fs.mkdirSync(dehors);
    fs.writeFileSync(path.join(vault, 'cours/histoire.md'), '# Histoire');
    fs.writeFileSync(path.join(vault, 'lisez-moi.txt'), 'bonjour');
    fs.writeFileSync(path.join(vault, 'image.png'), 'png');
    fs.writeFileSync(path.join(vault, '.fragment/plugins/agent/.env'), 'OPENAI_API_KEY=sk-secret');
    fs.writeFileSync(path.join(vault, '.git/config'), '[core]');
    fs.writeFileSync(path.join(dehors, 'secret.md'), 'secret');
    fs.symlinkSync(path.join(dehors, 'secret.md'), path.join(vault, 'cours/lien.md'));
    fs.symlinkSync(dehors, path.join(vault, 'dossier-lien'));
    fs.symlinkSync(path.join(vault, '.fragment/plugins/agent/.env'), path.join(vault, 'cle.md'));
});

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const refuse = (rel: string) => expect(() => cheminSur(vault, rel)).toThrow(RefusChemin);

describe('cheminSur', () => {
    it('ouvre une note du vault', () => {
        expect(cheminSur(vault, 'cours/histoire.md')).toBe(fs.realpathSync(path.join(vault, 'cours/histoire.md')));
        expect(cheminSur(vault, 'lisez-moi.txt')).toMatch(/lisez-moi\.txt$/);
    });

    it('refuse de remonter hors du vault', () => {
        refuse('../dehors/secret.md');
        refuse('cours/../../dehors/secret.md');
        refuse('..\\dehors\\secret.md');
    });

    it('refuse un chemin absolu, vide ou avec un octet nul', () => {
        refuse(path.join(base, 'dehors/secret.md'));
        refuse('/etc/hosts');
        refuse('C:/Windows/win.ini');
        refuse('');
        refuse('cours/histoire.md\0.txt');
    });

    it('refuse les dossiers cachés : la clé du plugin, git', () => {
        refuse('.fragment/plugins/agent/.env');
        refuse('.git/config');
        refuse('./cours/histoire.md');
    });

    it('refuse un lien symbolique qui sort du vault ou mène à la clé', () => {
        refuse('cours/lien.md');
        refuse('dossier-lien/secret.md');
        refuse('cle.md');
    });

    it('refuse une extension hors liste et un fichier absent', () => {
        refuse('image.png');
        refuse('cours/absent.md');
        refuse('cours');
    });
});

describe('fichiersLisibles', () => {
    it('ne liste que les notes, sans dossier caché ni lien suivi', () => {
        expect(fichiersLisibles(vault)).toEqual([path.join('cours', 'histoire.md'), 'lisez-moi.txt']);
    });
});
