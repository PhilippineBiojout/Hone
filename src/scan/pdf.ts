import { PDFDocument } from "pdf-lib";


export async function buildPdf(images: ArrayBuffer[]): Promise<ArrayBuffer> {
    const pdf = await PDFDocument.create();
    for ( const octets of images){
        const image = isPng(octets) ? await pdf.embedPng(octets) : await pdf.embedJpg(octets);

        const largeur = 595;
        const hauteur = largeur * (image.height / image.width);
        const page = pdf.addPage([largeur, hauteur]);

        page.drawImage(image, { x: 0, y: 0, width: largeur, height: hauteur});
    }

    const octets = await pdf.save();

    return octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) as ArrayBuffer;
}

function isPng(octets: ArrayBuffer): boolean{
    const b = new Uint8Array(octets, 0, 4);
    return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] ===0x47;
}