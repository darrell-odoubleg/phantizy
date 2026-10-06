// pdfMerge.js
// Builds the single welcome-package PDF: the letter first, then every
// attachment's pages (PDFs copied page for page, PNG/JPEG placed on their
// own letter-size page). Files that can't be merged (Word, Excel, broken or
// password-protected PDFs) are returned in `separate` so the caller can
// attach them on their own.

const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

const LETTER = [612, 792];
const MARGIN = 36;

const isPdf = (a) => /pdf$/i.test(a.mime || '') || /\.pdf$/i.test(a.name);
const isPng = (a) => /png$/i.test(a.mime || '') || /\.png$/i.test(a.name);
const isJpg = (a) => /jpe?g$/i.test(a.mime || '') || /\.jpe?g$/i.test(a.name);
const canMerge = (a) => isPdf(a) || isPng(a) || isJpg(a);

// Loads each attachment once. Returns { parts: [{att, pdf|image, pages}], separate: [att] }.
async function prepare(attachments) {
  const parts = [];
  const separate = [];
  for (const a of attachments) {
    if (!canMerge(a)) { separate.push(a); continue; }
    try {
      const bytes = a.bytes || fs.readFileSync(a.path);
      if (isPdf(a)) {
        const pdf = await PDFDocument.load(bytes); // throws on encrypted PDFs
        parts.push({ att: a, pdf, pages: pdf.getPageCount() });
      } else {
        parts.push({ att: a, imageBytes: bytes, png: isPng(a), pages: 1 });
      }
    } catch (err) {
      console.error(`welcome merge: can't merge "${a.name}": ${err.message}`);
      separate.push(a);
    }
  }
  return { parts, separate };
}

// Table of contents for the letter: label + starting page, given the
// letter's own page count.
function contents(parts, letterPages) {
  let page = letterPages + 1;
  return parts.map(p => {
    const entry = { label: p.att.label === 'Other' ? p.att.name : p.att.label, page };
    page += p.pages;
    return entry;
  });
}

async function merge(letterBytes, parts) {
  const out = await PDFDocument.load(letterBytes);
  for (const p of parts) {
    if (p.pdf) {
      const pages = await out.copyPages(p.pdf, p.pdf.getPageIndices());
      pages.forEach(pg => out.addPage(pg));
    } else {
      const img = p.png ? await out.embedPng(p.imageBytes) : await out.embedJpg(p.imageBytes);
      // Landscape page for wide images, portrait otherwise; image scaled to fit.
      const landscape = img.width > img.height;
      const [w, h] = landscape ? [LETTER[1], LETTER[0]] : LETTER;
      const page = out.addPage([w, h]);
      const scale = Math.min((w - MARGIN * 2) / img.width, (h - MARGIN * 2) / img.height, 1);
      const dw = img.width * scale, dh = img.height * scale;
      page.drawImage(img, { x: (w - dw) / 2, y: (h - dh) / 2, width: dw, height: dh });
    }
  }
  return Buffer.from(await out.save());
}

async function pageCount(bytes) {
  return (await PDFDocument.load(bytes)).getPageCount();
}

module.exports = { prepare, contents, merge, pageCount, canMerge };
