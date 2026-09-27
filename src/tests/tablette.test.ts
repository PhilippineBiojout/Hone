// @vitest-environment node
import * as net from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmdocDeTest } from './rmdocDeTest';
import { cableBranche, Tablette } from '../remarkable/tablette';

// Une fausse tablette qui répond comme la vraie : Content-Length ET chunked.
const reponses: Record<string, { statut: number; corps: string | Buffer }> = {
	'/documents/': { statut: 200, corps: JSON.stringify([
		{ ID: 'd1', VissibleName: 'Cours', Type: 'CollectionType', ModifiedClient: 't0' },
		{ ID: 'c1', VissibleName: 'Brouillon', Type: 'DocumentType', ModifiedClient: 't1', fileType: 'pdf' },
		{ ID: 'n1', VissibleName: 'Notes', Type: 'DocumentType', ModifiedClient: 't3', fileType: 'notebook' },
	]) },
	'/documents/d1': { statut: 200, corps: JSON.stringify([
		{ ID: 'c2', VissibleName: 'Maths/Algèbre', Type: 'DocumentType', ModifiedClient: 't2' },
	]) },
	'/download/c1/pdf': { statut: 200, corps: '%PDF-1.7 faux' },
	'/download/c2/pdf': { statut: 500, corps: 'export impossible' },
	'/download/n1/rmdoc': { statut: 200, corps: rmdocDeTest('n1', [[{ points: [[0, 0], [10, 10]] }], []]) },
};

let serveur: net.Server;
let tablette: Tablette;

beforeAll(async () => {
	serveur = net.createServer((s) => {
		s.once('data', (d) => {
			const chemin = d.toString().split(' ')[1];
			const r = reponses[chemin] ?? { statut: 404, corps: '' };
			const n = Buffer.byteLength(r.corps);
			s.write(`HTTP/1.1 ${r.statut} X\r\nContent-Length: ${n}\r\nTransfer-Encoding: chunked\r\n\r\n${n.toString(16)}\r\n`);
			s.end(Buffer.concat([Buffer.from(r.corps), Buffer.from('\r\n0\r\n\r\n')]));
		});
	});
	await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
	tablette = new Tablette(`http://127.0.0.1:${(serveur.address() as net.AddressInfo).port}`);
});

afterAll(() => serveur.close());

describe('Tablette', () => {
	it('parcourt les dossiers malgré la réponse Content-Length + chunked', async () => {
		const elements = await tablette.lister();
		expect(elements.map((e) => [e.id, e.chemin, e.dossier, e.carnet])).toEqual([
			['d1', 'Cours', true, false],
			['c2', 'Cours/Maths-Algèbre', false, false],
			['c1', 'Brouillon', false, false],
			['n1', 'Notes', false, true],
		]);
	});

	it('télécharge le PDF d’un document importé', async () => {
		const octets = await tablette.telecharger('c1', false);
		expect(Buffer.from(octets).toString()).toBe('%PDF-1.7 faux');
	});

	it('fait nous-mêmes le PDF d’un carnet, depuis son rmdoc', async () => {
		const pdf = Buffer.from(await tablette.telecharger('n1', true)).toString('latin1');
		expect(pdf.startsWith('%PDF-1.4')).toBe(true);
		expect(pdf).toContain('/Count 2');
	});

	it('échoue sur un export refusé ou une tablette absente', async () => {
		await expect(tablette.telecharger('c2', false)).rejects.toThrow('HTTP 500');
		await expect(new Tablette('http://127.0.0.1:1').lister()).rejects.toThrow();
	});
});

describe('cableBranche', () => {
	const ip = (address: string) => ({ address, family: 'IPv4', netmask: '255.255.255.0', mac: '', internal: false, cidr: null }) as const;
	it('voit le câble quand le Mac a une adresse dans le sous-réseau de la tablette', () => {
		expect(cableBranche('http://10.11.99.1', { en0: [ip('192.168.1.12')], en7: [ip('10.11.99.2')] })).toBe(true);
	});
	it('câble débranché : aucune adresse en 10.11.99.x', () => {
		expect(cableBranche('http://10.11.99.1', { en0: [ip('192.168.1.12')] })).toBe(false);
	});
	it('la fausse tablette locale : la boucle locale tient lieu de câble', () => {
		expect(cableBranche('http://127.0.0.1:5000', { lo0: [ip('127.0.0.1')] })).toBe(true);
	});
});
