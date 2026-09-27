// Le PDF d'un document scanné : une page par photo, dans l'ordre (page 1, 2, 3…).
// Mettre à jour une page remplace cette page-là, sans toucher aux autres. Aucune image
// n'est gardée à côté : les pages viennent du PDF lui-même. Pas d'accès au vault ici
// (octets → octets) : c'est scan.ts qui lit et écrit le fichier.
import { PDFDocument } from "pdf-lib";

/**
 * Met la photo à la page `page` (1, 2, 3…) du PDF `existing` et renvoie le nouveau PDF.
 * `existing` null = premier envoi. Page déjà là → remplacée ; sinon → ajoutée à la fin.
 * On recopie les autres pages dans un PDF neuf plutôt que removePage/insertPage :
 * pdf-lib garderait l'image retirée dans le fichier, qui grossirait à chaque mise à jour.
 */
export async function putPageInPdf(existing: ArrayBuffer | null, page: number, photo: ArrayBuffer): Promise<ArrayBuffer>{
    const pdf = await PDFDocument.create();

    if (existing !== null){
        // Toutes les pages de l'ancien PDF, dans l'ordre (copiées, mais pas encore ajoutées)
        const old = await PDFDocument.load(existing);
        const pages = await pdf.copyPages(old, old.getPageIndices());
        for (let i = 0; i<pages.length; i++){
            if (i===page-1){
                // La page du site commence à 1, l'indice PDF à 0 : c'est la page à remplacer
                await addPhotoPage(pdf, photo);
            }
            else{
                pdf.addPage(pages[i]);
            }
        }
    }

    // Page pas encore dans le PDF (nouvelle page, ou premier envoi) : à la fin
    if (page > pdf.getPageCount()){
        await addPhotoPage(pdf, photo);
    }

    // save() rend un Uint8Array ; createBinary / modifyBinary veulent exactement ses octets en ArrayBuffer
    const octets = await pdf.save();
    return octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) as ArrayBuffer;
}

/**
 * Ajoute à la fin de `pdf` une page qui affiche la photo sur toute sa surface. La page
 * fait la largeur d'un A4 (595 points) et sa hauteur suit les proportions de la photo :
 * toutes les pages ont la même largeur, et l'image garde sa pleine résolution.
 */
async function addPhotoPage(pdf: PDFDocument, octets: ArrayBuffer): Promise<void>{
    const image = isPng(octets) ? await pdf.embedPng(octets) : await pdf.embedJpg(octets);

    const largeur = 595;
    const hauteur = largeur * (image.height / image.width);
    const page = pdf.addPage([largeur, hauteur]);

    // En PDF, (0, 0) est le coin en bas à gauche
    page.drawImage(image, { x: 0, y: 0, width: largeur, height: hauteur});
}

/**
 * La caméra du site envoie du JPEG, mais une image importée peut être un PNG, et
 * embedJpg le refuse. Un PNG commence toujours par les octets 89 50 4E 47 (« .PNG ») ;
 * sinon on suppose un JPEG (un autre format, comme le HEIC, fera échouer embedJpg).
 */
function isPng(octets: ArrayBuffer): boolean{
    const b = new Uint8Array(octets, 0, 4);
    return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] ===0x47;
}

// Exportée : scan.ts s'en sert pour dire au téléphone combien de pages a le PDF choisi.
// async + await : PDFDocument.load analyse le fichier, il rend une promesse, pas le document.
export async function pageCount(octets: ArrayBuffer): Promise<number>{
    const pdf = await PDFDocument.load(octets);
    return pdf.getPageCount();
}