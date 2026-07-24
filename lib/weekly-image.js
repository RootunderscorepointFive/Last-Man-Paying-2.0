// Renders the weekly-summary infographic to a PNG buffer (Satori -> resvg).
// Driven by the object from lib/weekly.js. Shared by the image endpoint and the
// weekly email (attachment), so the shared image and the email are identical.
//
// satori 0.29 is ESM; this file is CJS (required by CJS api handlers), so satori
// is loaded via dynamic import. Fonts + group photo are bundled repo assets
// (see vercel.json includeFiles) and cached at module scope.

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const asset = p => path.join(ROOT, p);

let _fonts = null, _photo = null;
function fonts() {
  if (!_fonts) {
    _fonts = [
      { name: 'IBM Plex Mono', data: fs.readFileSync(asset('assets/fonts/IBMPlexMono-Regular.ttf')), weight: 400, style: 'normal' },
      { name: 'IBM Plex Mono', data: fs.readFileSync(asset('assets/fonts/IBMPlexMono-Bold.ttf')), weight: 700, style: 'normal' },
    ];
  }
  return _fonts;
}
function photo() {
  if (_photo == null) {
    try { _photo = 'data:image/jpeg;base64,' + fs.readFileSync(asset('assets/group-photo/group-photo.jpeg')).toString('base64'); }
    catch { _photo = ''; }
  }
  return _photo;
}

const C = { bg: '#08090C', text: '#D7DCE3', dim: '#8a95a2', amber: '#FFB224', green: '#3DDC97', red: '#ff5d5d', blue: '#5eaaff', panel: '#0f1218', line: '#1c2230' };
const col = (children, style = {}) => ({ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', ...style }, children } });
const row = (children, style = {}) => ({ type: 'div', props: { style: { display: 'flex', alignItems: 'center', ...style }, children } });
const txt = (s, style = {}) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children: String(s) } });

const stat = (label, value, sub, color) => col([
  txt(label, { color: C.dim, fontSize: 19, letterSpacing: 2 }),
  txt(value, { color: color || C.text, fontSize: 44, fontWeight: 700, marginTop: 6 }),
  txt(sub || '', { color: C.dim, fontSize: 19, marginTop: 2 }),
], { background: C.panel, border: '1px solid ' + C.line, borderRadius: 14, padding: '20px 24px', flex: 1 });

function card(d) {
  const HH = 500;
  const R = n => 'R' + Number(n || 0).toLocaleString();
  const top = d.top || { pts: '—', name: 'No data' };
  const moverVal = d.mover ? ((d.mover.delta >= 0 ? '+' : '−') + Math.abs(d.mover.delta) + ' places') : '—';
  const cap = d.captain;

  return col([
    // Header — group photo framed to the faces, title overlaid with a scrim.
    { type: 'div', props: { style: { display: 'flex', position: 'relative', width: 1080, height: HH, overflow: 'hidden' }, children: [
      ...(photo() ? [{ type: 'img', props: { src: photo(), width: 1080, height: 1080, style: { position: 'absolute', left: 0, top: -295 } } }] : []),
      { type: 'div', props: { style: { position: 'absolute', left: 0, top: 0, width: 1080, height: HH, display: 'flex', background: 'linear-gradient(160deg, rgba(8,9,12,0.9) 0%, rgba(8,9,12,0.55) 40%, rgba(8,9,12,0.1) 75%)' } } },
      col([
        row([ txt('>_', { color: C.amber, fontSize: 28, fontWeight: 700 }), txt('LAST MAN PAYING', { color: C.text, fontSize: 28, fontWeight: 700, marginLeft: 12, letterSpacing: 3 }) ]),
        txt('GW ' + d.gw + ' · WEEKLY REPORT', { color: C.amber, fontSize: 60, fontWeight: 700, marginTop: 12 }),
        txt('Season ' + (d.season || ''), { color: C.dim, fontSize: 23, marginTop: 6 }),
      ], { position: 'absolute', top: 0, left: 0, width: 1080, height: HH, justifyContent: 'center', paddingLeft: 48 }),
    ] } },
    // Body
    col([
      row([
        stat('TOP SCORER · GW' + d.gw, top.pts + (typeof top.pts === 'number' ? ' pts' : ''), top.name, C.green),
        stat('CAPTAIN OF THE WEEK', cap ? cap.count + '×' : '—', cap ? cap.name + ' · most-backed' : 'no squads yet', C.amber),
      ], { gap: 20 }),
      row([
        stat('BIGGEST MOVER', moverVal, d.mover ? d.mover.name : 'no movement', d.mover && d.mover.delta >= 0 ? C.green : (d.mover ? C.red : C.dim)),
        stat('FINES THIS GW', R(d.finesThisGw), 'prize pool ' + R(d.poolLevied), C.red),
      ], { gap: 20, marginTop: 20 }),
      // The Drop
      col([
        txt('THE DROP · BOTTOM ' + d.drop.length + ' · R100 EACH', { color: C.red, fontSize: 23, fontWeight: 700, letterSpacing: 2, marginBottom: 14 }),
        ...d.drop.map((p, i) => row([
          txt(String(i + 1), { color: C.red, fontSize: 28, fontWeight: 700, width: 44 }),
          col([ txt(p.name, { color: C.text, fontSize: 28, fontWeight: 700 }), txt(p.team, { color: C.dim, fontSize: 19 }) ], { flex: 1 }),
          txt(p.pts + ' pts', { color: C.red, fontSize: 28, fontWeight: 700 }),
        ], { background: C.panel, border: '1px solid ' + C.line, borderRadius: 12, padding: '14px 22px', marginBottom: 11 })),
      ], { marginTop: 24 }),
      // Top of the table
      col([
        txt('TOP OF THE TABLE', { color: C.dim, fontSize: 21, letterSpacing: 2, marginBottom: 8 }),
        ...d.standings.map((m, i) => row([
          txt(String(i + 1), { color: C.amber, fontSize: 25, fontWeight: 700, width: 44 }),
          txt(m.name, { color: C.text, fontSize: 25, flex: 1 }),
          txt(m.pts + ' pts', { color: C.green, fontSize: 25 }),
        ], { padding: '8px 0', borderBottom: '1px solid ' + C.line })),
      ], { marginTop: 20 }),
    ], { padding: '32px 48px', flex: 1 }),
    row([ txt('LMP> resolve_bottom --gw ' + d.gw + '  ·  last man paying', { color: C.dim, fontSize: 19 }) ], { padding: '0 48px 26px' }),
  ], { width: 1080, height: 1560, background: C.bg, fontFamily: 'IBM Plex Mono' });
}

async function renderWeeklyPng(data) {
  const satori = (await import('satori')).default;
  const { Resvg } = require('@resvg/resvg-js');
  const svg = await satori(card(data), { width: 1080, height: 1560, fonts: fonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1080 } }).render().asPng();
}

module.exports = { renderWeeklyPng };
