// pdf.js
// Offer sheet and advance sheet PDFs. Both are driven by the section lists
// in public/fields.js: each section becomes a titled two-column grid of
// label/value cells, and blank fields are left out so a half-filled sheet
// still reads cleanly. Company name/address/contact come from .env.

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { OFFER_SECTIONS, ADVANCE_SECTIONS } = require('../public/fields');

const INK = '#1b1b1f';
const DIM = '#6b6b75';
const RULE = '#d8d8de';
const ACCENT = '#58417b';
const LOGO_PATH = path.join(__dirname, '..', 'public', 'logo.png');

const COMPANY = () => ({
  name: process.env.COMPANY_NAME || 'Phantizy Productions',
  address: process.env.COMPANY_ADDRESS || '',
  contact: process.env.COMPANY_CONTACT || '',
});

function blank(v) { return v === null || v === undefined || String(v).trim() === ''; }

function fmtDate(iso) {
  if (blank(iso)) return '';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? String(iso) : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function fmtTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  if (!m) return t || '';
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}
function fmtValue(f, v) {
  if (blank(v)) return '';
  if (f.type === 'money') return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (f.type === 'date') return fmtDate(v);
  if (f.type === 'time') return fmtTime(v);
  if (f.key === 'percentage') return `${v}%`;
  return String(v);
}

function newDoc(out) {
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 60, left: 54, right: 54 }, bufferPages: true });
  doc.pipe(out);
  return doc;
}

function header(doc, title, offer) {
  const c = COMPANY();
  const left = doc.page.margins.left;
  const width = doc.page.width - left * 2;
  let y = doc.page.margins.top;
  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, left, y, { fit: [170, 54] });
  } else {
    doc.font('Helvetica-Bold').fontSize(18).fillColor(ACCENT).text(c.name.toUpperCase(), left, y + 8, { characterSpacing: 1.5 });
  }
  doc.font('Helvetica').fontSize(8.5).fillColor(DIM);
  const info = [c.address, c.contact].filter(Boolean).join('\n');
  if (info) doc.text(info, left, y + 4, { width, align: 'right' });

  y += 70;
  doc.font('Helvetica-Bold').fontSize(22).fillColor(INK).text(title, left, y);
  y = doc.y + 2;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(offer.artist_name || '', left, y);
  const fest = [offer.festival_name, offer.festival_dates].filter(Boolean).join(' · ');
  if (fest) doc.font('Helvetica').fontSize(11).fillColor(INK).text(fest);
  const slot = [offer.event_date && fmtDate(offer.event_date), offer.stage, offer.show_time && fmtTime(offer.show_time)].filter(Boolean).join('  ·  ');
  if (slot) doc.fontSize(10).fillColor(INK).text(slot);
  const place = [offer.venue_name, [offer.venue_city, offer.venue_state].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
  if (place) doc.fontSize(10).fillColor(DIM).text(place);
  y = doc.y + 10;
  doc.moveTo(left, y).lineTo(left + width, y).lineWidth(2).strokeColor(ACCENT).stroke();
  doc.y = y + 14;
}

function ensure(doc, h) {
  if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

// One section: title bar + 2-column grid (wide fields span both columns).
function section(doc, title, fields, data) {
  const rows = fields.filter(f => !f.internal && !blank(data[f.key]));
  if (!rows.length) return;
  const left = doc.page.margins.left;
  const width = doc.page.width - left * 2;
  const colW = (width - 18) / 2;

  ensure(doc, 60);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT).text(title.toUpperCase(), left, doc.y, { characterSpacing: 1 });
  let y = doc.y + 3;
  doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.6).strokeColor(RULE).stroke();
  y += 7;

  const cellH = (f, w) => {
    doc.font('Helvetica').fontSize(10);
    return 11 + doc.heightOfString(fmtValue(f, data[f.key]), { width: w }) + 8;
  };

  let col = 0, rowTop = y, rowH = 0;
  const flush = () => { y = rowTop + rowH; rowTop = y; rowH = 0; col = 0; };
  for (const f of rows) {
    const wide = f.wide || f.type === 'textarea';
    if (wide && col === 1) flush();
    const w = wide ? width : colW;
    const h = cellH(f, w);
    if (rowTop + h > doc.page.height - doc.page.margins.bottom) {
      if (col === 1) flush();
      doc.addPage(); rowTop = y = doc.page.margins.top;
    }
    const x = left + (wide ? 0 : col * (colW + 18));
    doc.font('Helvetica').fontSize(7.5).fillColor(DIM).text(f.label.toUpperCase(), x, rowTop, { width: w, characterSpacing: 0.5 });
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(fmtValue(f, data[f.key]), x, rowTop + 11, { width: w });
    rowH = Math.max(rowH, h);
    if (wide || col === 1) flush(); else col = 1;
  }
  if (col === 1) flush();
  doc.y = y + 8;
}

// totalPages: page count of the finished document when more pages get merged
// in after this one (welcome package); defaults to this PDF's own pages.
function footer(doc, label, totalPages) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.height - 36;
    const left = doc.page.margins.left;
    const width = doc.page.width - left * 2;
    doc.page.margins.bottom = 0; // allow writing in the margin without a page break
    doc.font('Helvetica').fontSize(7.5).fillColor(DIM)
      .text(`${COMPANY().name} · ${label}`, left, bottom, { width, align: 'left', lineBreak: false })
      .text(`Page ${i + 1} of ${totalPages || range.count}`, left, bottom, { width, align: 'right', lineBreak: false });
  }
}

function offerSheetPdf(offer, out) {
  const doc = newDoc(out);
  header(doc, 'FESTIVAL OFFER', offer);
  for (const s of OFFER_SECTIONS) section(doc, s.title, s.fields, offer);

  // Acceptance block
  ensure(doc, 120);
  const left = doc.page.margins.left;
  const width = doc.page.width - left * 2;
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(9).fillColor(DIM).text(
    'This offer is subject to a fully executed contract. Please sign below to accept the terms above' +
    (offer.offer_expires ? ` by ${fmtDate(offer.offer_expires)}.` : '.'), left, doc.y, { width });
  let y = doc.y + 34;
  const half = (width - 30) / 2;
  for (const [i, lbl] of [[0, 'Accepted by (Artist / Agent)'], [1, 'Date']]) {
    const x = left + i * (half + 30);
    doc.moveTo(x, y).lineTo(x + half, y).lineWidth(0.7).strokeColor(INK).stroke();
    doc.fontSize(8).fillColor(DIM).text(lbl, x, y + 4);
  }
  y += 44;
  doc.moveTo(left, y).lineTo(left + half, y).lineWidth(0.7).strokeColor(INK).stroke();
  doc.fontSize(8).fillColor(DIM).text(`For ${COMPANY().name}${offer.created_by_name ? ' — ' + offer.created_by_name : ''}`, left, y + 4);

  footer(doc, `Offer #${offer.id}`);
  doc.end();
}

function advanceSheetPdf(offer, advance, out) {
  const doc = newDoc(out);
  header(doc, 'ADVANCE SHEET', offer);
  // Quick reference from the offer, then the advance itself.
  const ref = [
    { key: 'venue_address', label: 'Site address', wide: true },
    { key: 'billing', label: 'Lineup position' },
    { key: 'set_length', label: 'Set length' },
    { key: 'changeover', label: 'Changeover' },
    { key: 'credentials', label: 'Credentials / wristbands' },
    { key: 'guest_list_offer', label: 'Guest list allotment' },
    { key: 'artist_parking', label: 'Artist parking' },
  ];
  section(doc, 'Performance', ref, offer);
  for (const s of ADVANCE_SECTIONS) section(doc, s.title, s.fields, advance);
  footer(doc, `Advance · Offer #${offer.id}`);
  doc.end();
}

// Fills {artist}, {festival}, {date}, {stage}, {tm}, {dos_name}, {dos_phone}
// in festival welcome text.
function fillTemplate(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? vars[k] : ''));
}

function welcomeVars(offer, advance, welcome) {
  return {
    artist: offer.artist_name || '',
    festival: offer.festival_name || '',
    date: offer.event_date ? fmtDate(offer.event_date) : '',
    stage: offer.stage || '',
    tm: advance.tour_manager_name || '',
    dos_name: welcome.dos_name || '',
    dos_phone: welcome.dos_phone || '',
  };
}

// Welcome package letter to the tour manager: festival-wide text (Settings →
// Festivals → Welcome package) plus this show's details from the offer and
// advance sheet. No money or deal terms.
// contents: [{ label, page }] for files merged after the letter;
// separate: names of files attached to the email on their own.
function welcomeLetterPdf(offer, advance, welcome, out, contents = [], separate = [], totalPages = 0) {
  const doc = newDoc(out);
  const left = doc.page.margins.left;
  const width = doc.page.width - left * 2;
  const vars = welcomeVars(offer, advance, welcome);
  header(doc, 'WELCOME PACKAGE', offer);

  const para = (text, opts = {}) => {
    if (blank(text)) return;
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 10.5).fillColor(opts.color || INK)
      .text(String(text), left, doc.y, { width, lineGap: 2 });
    doc.moveDown(opts.after ?? 0.7);
  };

  para(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), { color: DIM, size: 9.5 });
  para(`Dear ${advance.tour_manager_name || 'Tour Manager'},`);
  para(fillTemplate(welcome.intro, vars));

  // Day of show contact, highlighted.
  if (welcome.dos_name || welcome.dos_phone) {
    ensure(doc, 60);
    const y = doc.y;
    doc.rect(left, y, width, 46).fill('#EEEAF4');
    doc.rect(left, y, 4, 46).fill(ACCENT);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(ACCENT).text('DAY OF SHOW CONTACT', left + 16, y + 9, { characterSpacing: 1 });
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK)
      .text([welcome.dos_name, welcome.dos_phone].filter(Boolean).join('   ·   '), left + 16, y + 22, { width: width - 32 });
    doc.y = y + 46 + 16;
  }

  const show = { ...advance, ...offer, festival_gates: offer.festival_gates || advance.doors_time };
  section(doc, 'Your Show', [
    { key: 'event_date', label: 'Show date', type: 'date' },
    { key: 'stage', label: 'Stage' },
    { key: 'show_time', label: 'Set time', type: 'time' },
    { key: 'set_length', label: 'Set length' },
    { key: 'festival_gates', label: 'Gates open', type: 'time' },
    { key: 'changeover', label: 'Changeover' },
    { key: 'venue_address', label: 'Site address', wide: true },
  ], show);
  section(doc, 'Your Advance', [
    { key: 'artist_checkin_time', label: 'Artist check-in', type: 'time' },
    { key: 'load_in_time', label: 'Load in / stage arrival', type: 'time' },
    { key: 'soundcheck_time', label: 'Line check', type: 'time' },
    { key: 'curfew', label: 'Stage curfew', type: 'time' },
    { key: 'credential_pickup', label: 'Credential pickup' },
    { key: 'artist_entrance', label: 'Artist entrance' },
    { key: 'credentials', label: 'Credentials / wristbands' },
    { key: 'guest_list', label: 'Guest list / comps' },
    { key: 'hotel_name', label: 'Hotel' },
    { key: 'hotel_confirmation', label: 'Hotel confirmation #' },
    { key: 'hotel_rooms', label: 'Rooms' },
    { key: 'hotel_checkin', label: 'Check-in / out' },
    { key: 'stage_manager_name', label: 'Stage manager' },
    { key: 'stage_manager_phone', label: 'Stage manager phone' },
    { key: 'artist_relations_name', label: 'Artist relations' },
    { key: 'artist_relations_phone', label: 'Artist relations phone' },
  ], show);

  for (const sec of welcome.sections || []) {
    const body = fillTemplate(sec.body, vars).trim();
    if (!body) continue; // headings with no text yet (e.g. Backline) are left out
    ensure(doc, 50);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT).text(String(sec.heading || '').toUpperCase(), left, doc.y, { characterSpacing: 1 });
    doc.moveDown(0.25);
    para(body, { after: 0.9 });
  }

  doc.moveDown(0.3);
  para(fillTemplate(welcome.closing, vars));
  para(welcome.signoff ? fillTemplate(welcome.signoff, vars) : COMPANY().name, { bold: true });

  if (contents.length) {
    ensure(doc, 30 + contents.length * 15);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(DIM).text('INCLUDED IN THIS PACKAGE', left, doc.y, { characterSpacing: 1 });
    doc.moveDown(0.2);
    for (const c of contents) {
      const y = doc.y;
      doc.font('Helvetica').fontSize(10).fillColor(INK).text('•  ' + c.label, left + 4, y, { width: width - 80, lineBreak: false });
      doc.fillColor(DIM).text(c.page ? `page ${c.page}` : '', left, y, { width, align: 'right', lineBreak: false });
      doc.y = y + 15;
    }
  }
  if (separate.length) {
    ensure(doc, 24 + separate.length * 14);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(DIM).text('ATTACHED SEPARATELY', left, doc.y, { characterSpacing: 1 });
    doc.font('Helvetica').fontSize(10).fillColor(INK);
    for (const n of separate) doc.text('•  ' + n, left + 4, doc.y, { width: width - 4 });
  }

  footer(doc, `Welcome package · ${offer.artist_name || ''}`, totalPages);
  doc.end();
}

// Run of show table for one stage on one day. highlight: text (the act's
// name) whose rows are shaded so the act can find its slot.
const ROS_COLS = [
  { key: 'item', label: 'Item', w: 0.34 },
  { key: 'setup', label: 'Stage Setup', w: 0.30 },
  { key: 'time', label: 'Performance Time', w: 0.21, type: 'time' },
  { key: 'duration', label: 'Duration', w: 0.15 },
];
function runOfShowPdf({ festival, stage, day, rows, highlight }, out) {
  const doc = newDoc(out);
  const c = COMPANY();
  const left = doc.page.margins.left;
  const width = doc.page.width - left * 2;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  let y = doc.page.margins.top;
  if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, left, y, { fit: [140, 44] });
  doc.font('Helvetica').fontSize(8.5).fillColor(DIM).text([c.address, c.contact].filter(Boolean).join('\n'), left, y + 4, { width, align: 'right' });
  y += 60;
  doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text('RUN OF SHOW', left, y);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(ACCENT).text(`${stage}  ·  ${fmtDate(day)}`);
  if (festival) doc.font('Helvetica').fontSize(10.5).fillColor(DIM).text(festival);
  y = doc.y + 12;

  const colX = []; let x = left;
  for (const col of ROS_COLS) { colX.push(x); x += col.w * width; }
  const pad = 6;
  const headerRow = () => {
    doc.font('Helvetica-Bold').fontSize(8.5);
    const hh = Math.max(...ROS_COLS.map(col => doc.heightOfString(col.label.toUpperCase(), { width: col.w * width - pad * 2, characterSpacing: 0.5 }))) + 14;
    doc.rect(left, y, width, hh).fill(ACCENT);
    ROS_COLS.forEach((col, i) => doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff')
      .text(col.label.toUpperCase(), colX[i] + pad, y + 7, { width: col.w * width - pad * 2, characterSpacing: 0.5 }));
    y += hh;
  };
  headerRow();
  const hl = String(highlight || '').trim().toLowerCase();
  (rows || []).forEach((r, n) => {
    const cells = ROS_COLS.map(col => col.type === 'time' ? fmtTime(r[col.key]) : String(r[col.key] || ''));
    doc.font('Helvetica').fontSize(10);
    const h = Math.max(...cells.map((t, i) => doc.heightOfString(t || ' ', { width: ROS_COLS[i].w * width - pad * 2 }))) + pad * 2;
    if (y + h > bottom()) { doc.addPage(); y = doc.page.margins.top; headerRow(); }
    const mine = hl && String(r.item || '').toLowerCase().includes(hl);
    if (mine) doc.rect(left, y, width, h).fill('#EEEAF4');
    else if (n % 2) doc.rect(left, y, width, h).fill('#F7F6F9');
    cells.forEach((t, i) => doc.font(mine ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(INK)
      .text(t, colX[i] + pad, y + pad, { width: ROS_COLS[i].w * width - pad * 2 }));
    y += h;
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.4).strokeColor(RULE).stroke();
  });
  if (!(rows || []).length) doc.font('Helvetica-Oblique').fontSize(10).fillColor(DIM).text('No items yet.', left, y + 10);
  footer(doc, `Run of show · ${stage} · ${fmtDate(day)}`);
  doc.end();
}

module.exports = { offerSheetPdf, advanceSheetPdf, welcomeLetterPdf, runOfShowPdf, fillTemplate, welcomeVars };
