// ros.js
// Run of show rows for one festival stage on one day. Artist rows come from
// the offers booked on that stage + date (accepted/completed only), timed
// from their advance sheet: Performance time = Performance start – stop (falling
// back to the offer's set time + set length). Stored rows add the Stage Setup
// text for artist rows (matched by offer_id) and any manual rows (gates,
// curfew, meet & greets). A Changeover row is added automatically between
// each pair of consecutive acts (previous set end → next set start); its
// Stage Setup is stored by the following act's offer_id ({ co: id }). Each
// act with a Load in time on its advance sheet also gets a "<Act> Load In"
// row; its Stage Setup is stored as { li: id }.
// Festival-wide fixed rows (catering) are added to every stage and day,
// shown in red and never stored. Everything is sorted by start time.

const db = require('../db/init');
const { RESTRICTED_STATUSES } = require('../public/fields');

// Fixed rows per festival: on every stage, every festival day (or only the
// weekdays in `days`, 0 = Sunday … 6 = Saturday).
const FIXED_ROWS = [{
  match: /rock the locks/i,
  rows: [
    { item: 'Catered Breakfast', time: '08:00', end: '11:00' },
    { item: 'Catered Lunch', time: '12:00', end: '15:00' },
    { item: 'Catered Dinner', time: '17:00', end: '20:00' },
    { item: 'Catered After Show Meals', time: '21:00', end: '00:00', days: [5, 6] },
    { item: 'Catered After Show Meals', time: '21:00', end: '22:30', days: [0] },
  ],
}];

const toMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const fromMin = (n) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

// "75 min", "1.5 hours", "1 hr 15 min", "90" → minutes
function setLengthMinutes(text) {
  const s = String(text || '').toLowerCase();
  let min = 0;
  const h = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/.exec(s);
  const m = /(\d+)\s*(m|min|mins|minute|minutes)\b/.exec(s);
  if (h) min += Math.round(parseFloat(h[1]) * 60);
  if (m) min += Number(m[1]);
  if (!h && !m && /^\s*\d+\s*$/.test(s)) min = Number(s);
  return min || null;
}

// "1 hr 30 min" / "45 min"; end before start = runs past midnight.
function durationText(start, end) {
  const a = toMin(start), b = toMin(end);
  if (a === null || b === null) return '';
  let d = b - a;
  if (d <= 0) d += 24 * 60;
  const hrs = Math.floor(d / 60), mins = d % 60;
  return [hrs && `${hrs} hr`, mins && `${mins} min`].filter(Boolean).join(' ');
}

const norm = (s) => String(s || '').trim().toLowerCase();
const parseRows = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };

// Returns { rows, pending, overlaps } — pending = offers on this slot not yet
// accepted; overlaps = [[actA, actB]] whose sets overlap (no changeover added).
function runOfShowRows(festivalName, stage, day) {
  const fest = db.prepare('SELECT id FROM festivals WHERE name = ?').get(festivalName);
  const stored = fest
    ? parseRows((db.prepare('SELECT rows FROM festival_ros WHERE festival_id = ? AND stage = ? AND day = ?').get(fest.id, stage, day) || {}).rows)
    : [];
  const offers = db.prepare(`SELECT o.id, o.status, o.artist_name, o.stage, o.show_time, o.set_length,
      a.headliner_set_time, a.set_end_time, a.load_in_time
    FROM offers o LEFT JOIN advances a ON a.offer_id = o.id
    WHERE o.festival_name = ? AND o.event_date = ? AND o.status NOT IN ('declined', 'cancelled')`).all(festivalName, day)
    .filter(o => norm(o.stage) === norm(stage));

  const setupFor = new Map(stored.filter(r => r.offer_id).map(r => [Number(r.offer_id), r.setup || '']));
  const coSetupFor = new Map(stored.filter(r => r.co).map(r => [Number(r.co), r.setup || '']));
  const liSetupFor = new Map(stored.filter(r => r.li).map(r => [Number(r.li), r.setup || '']));
  const artistRows = offers.filter(o => RESTRICTED_STATUSES.includes(o.status)).map(o => {
    const start = o.headliner_set_time || o.show_time || '';
    let end = o.set_end_time || '';
    if (!end && toMin(start) !== null && setLengthMinutes(o.set_length)) end = fromMin(toMin(start) + setLengthMinutes(o.set_length));
    return { offer_id: o.id, item: o.artist_name || '', setup: setupFor.get(o.id) || '', time: start, end, duration: durationText(start, end) };
  });
  const loadIns = offers.filter(o => RESTRICTED_STATUSES.includes(o.status) && toMin(o.load_in_time) !== null).map(o => ({
    li: o.id, item: `${o.artist_name || 'Artist'} Load In`, setup: liSetupFor.get(o.id) || '', time: o.load_in_time, end: '', duration: '',
  }));
  const manualRows = stored.filter(r => !r.offer_id && !r.co && !r.li).map(r => ({
    item: r.item || '', setup: r.setup || '', time: r.time || '', end: r.end || '',
    duration: r.duration || durationText(r.time, r.end),
  }));
  const weekday = new Date(day + 'T00:00:00').getDay();
  const fixedRows = ((FIXED_ROWS.find(f => f.match.test(festivalName || '')) || {}).rows || [])
    .filter(r => !r.days || r.days.includes(weekday))
    .map(({ days, ...r }) => ({ ...r, setup: '', duration: durationText(r.time, r.end), fixed: true }));
  // Changeovers between consecutive acts (in set-time order).
  const timed = artistRows.filter(r => toMin(r.time) !== null).sort((a, b) => toMin(a.time) - toMin(b.time));
  const changeovers = [], overlaps = [];
  for (let i = 0; i + 1 < timed.length; i++) {
    const a = timed[i], b = timed[i + 1];
    if (toMin(a.end) === null) continue;
    // A set ending after midnight (end earlier than start) ends the next day.
    const aEnd = toMin(a.end) + (toMin(a.end) < toMin(a.time) ? 1440 : 0);
    if (aEnd > toMin(b.time)) { overlaps.push([a.item, b.item]); continue; }
    if (aEnd === toMin(b.time)) continue; // back to back, no gap
    changeovers.push({ co: b.offer_id, item: 'Changeover', setup: coSetupFor.get(b.offer_id) || '', time: a.end, end: b.time, duration: durationText(a.end, b.time) });
  }
  // Sort by start time (a changeover sorts after a row starting at the same
  // minute); rows without a time keep their order at the end.
  const all = [...artistRows, ...loadIns, ...manualRows, ...changeovers, ...fixedRows].map((r, i) => ({ r, i, t: toMin(r.time), co: r.co ? 1 : 0 }));
  all.sort((a, b) => (a.t ?? 1e9) - (b.t ?? 1e9) || a.co - b.co || a.i - b.i);
  return { rows: all.map(x => x.r), pending: offers.filter(o => !RESTRICTED_STATUSES.includes(o.status)).length, overlaps };
}

module.exports = { runOfShowRows, durationText };
