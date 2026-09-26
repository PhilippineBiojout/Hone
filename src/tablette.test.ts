// @vitest-environment node
import * as net from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExportRefuse, Tablette } from './tablette';

// Une fausse tablette qui répond comme la vraie : Content-Length ET chunked.
const reponses: Record<string, { statut: number; corps: string }> = {
	'/documents/': { statut: 200, corps: JSON.stringify([
		{ ID: 'd1', VissibleName: 'Cours', Type: 'CollectionType', ModifiedClient: 't0' },
		{ ID: 'c1', VissibleName: 'Brouillon', Type: 'DocumentType', ModifiedClient: 't1' },
	]) },
	'/documents/d1': { statut: 200, corps: JSON.stringify([
		{ ID: 'c2', VissibleName: 'Maths/Algèbre', Type: 'DocumentType', ModifiedClient: 't2' },
	]) },
	'/download/c1/pdf': { statut: 200, corps: '%PDF-1.7 faux' },
	'/download/c2/pdf': { statut: 500, corps: 'export impossible' },
};

let serveur: net.Server;
let tablette: Tablette;

beforeAll(async () => {
	serveur = net.createServer((s) => {
		s.once('data', (d) => {
			const chemin = d.toString().split(' ')[1];
			const r = reponses[chemin] ?? { statut: 404, corps: '' };
			const n = Buffer.byteLength(r.corps);
			s.end(`HTTP/1.1 ${r.statut} X\r\nContent-Length: ${n}\r\nTransfer-Encoding: chunked\r\n\r\n${n.toString(16)}\r\n${r.corps}\r\n0\r\n\r\n`);
		});
	});
	await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
	tablette = new Tablette(`http://127.0.0.1:${(serveur.address() as net.AddressInfo).port}`);
});

afterAll(() => serveur.close());

describe('Tablette', () => {
	it('parcourt les dossiers malgré la réponse Content-Length + chunked', async () => {
		const elements = await tablette.lister();
		expect(elements.map((e) => [e.id, e.chemin, e.dossier])).toEqual([
			['d1', 'Cours', true],
			['c2', 'Cours/Maths-Algèbre', false],
			['c1', 'Brouillon', false],
		]);
	});

	it('télécharge le PDF', async () => {
		const octets = await tablette.telecharger('c1');
		expect(Buffer.from(octets).toString()).toBe('%PDF-1.7 faux');
	});

	it('distingue un export refusé d’une déconnexion', async () => {
		await expect(tablette.telecharger('c2')).rejects.toBeInstanceOf(ExportRefuse);
		await expect(new Tablette('http://127.0.0.1:1').lister()).rejects.not.toBeInstanceOf(ExportRefuse);
	});
});
