// Renders one manager's personal "brag card" to a PNG buffer (Satori -> resvg).
// Driven by the object from lib/brag.js. Portrait aspect (1080x1350) — sized
// for sharing to a phone screen/story rather than the weekly summary's wider
// landscape-ish infographic.

const { C, col, row, txt, photo, renderPng } = require('./satori-render');

const stat = (label, value, sub, color) => col([
  txt(label, { color: C.dim, fontSize: 18, letterSpacing: 2 }),
  txt(value, { color: color || C.text, fontSize: 42, fontWeight: 700, marginTop: 6 }),
  txt(sub || '', { color: C.dim, fontSize: 18, marginTop: 2 }),
], { background: C.panel, border: '1px solid ' + C.line, borderRadius: 14, padding: '18px 22px', flex: 1 });

const ordinal = n => {
  if (n == null) return '—';
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

function card(d) {
  const HH = 420;
  const height = 980 + (d.bottomFinishes > 0 ? 100 : 0);
  return col([
    // Header — group photo framed to the faces, title overlaid with a scrim.
    { type: 'div', props: { style: { display: 'flex', position: 'relative', width: 1080, height: HH, overflow: 'hidden' }, children: [
      ...(photo() ? [{ type: 'img', props: { src: photo(), width: 1080, height: 1080, style: { position: 'absolute', left: 0, top: -260 } } }] : []),
      { type: 'div', props: { style: { position: 'absolute', left: 0, top: 0, width: 1080, height: HH, display: 'flex', background: 'linear-gradient(160deg, rgba(8,9,12,0.92) 0%, rgba(8,9,12,0.6) 45%, rgba(8,9,12,0.15) 75%)' } } },
      col([
        row([ txt('>_', { color: C.amber, fontSize: 26, fontWeight: 700 }), txt('LAST MAN PAYING', { color: C.text, fontSize: 26, fontWeight: 700, marginLeft: 12, letterSpacing: 3 }) ]),
        txt(d.team, { color: C.amber, fontSize: 52, fontWeight: 700, marginTop: 14 }),
        txt(d.name + (d.season ? ' · ' + d.season : ''), { color: C.dim, fontSize: 21, marginTop: 6 }),
      ], { position: 'absolute', top: 0, left: 0, width: 1080, height: HH, justifyContent: 'center', paddingLeft: 48 }),
    ] } },
    // Body
    col([
      d.epithet ? col([
        txt(d.epithet, { color: C.amber, fontSize: 30, fontWeight: 700 }),
        txt(d.epithetTagline || '', { color: C.dim, fontSize: 18, marginTop: 4 }),
      ], { marginBottom: 24 }) : null,
      row([
        stat('GW' + d.gw + ' POINTS', d.gwPts, d.gwRank ? ordinal(d.gwRank) + ' of ' + d.totalMgrs + ' this GW' : '', C.green),
        stat('SEASON TOTAL', d.seasonTotal, d.seasonRank ? ordinal(d.seasonRank) + ' of ' + d.totalMgrs + ' overall' : '', C.amber),
      ], { gap: 20 }),
      row([
        stat('BEST GW SO FAR', d.bestGW, 'season high', C.green),
        stat('CAPTAIN', d.captain || '—', d.tripleCaptain ? 'triple captain' : (d.captain ? 'this GW' : 'not the latest GW'), d.captain ? C.blue : C.dim),
      ], { gap: 20, marginTop: 20 }),
      d.bottomFinishes > 0 ? row([
        txt('BOTTOM-3 FINISHES', { color: C.dim, fontSize: 18, letterSpacing: 2, flex: 1 }),
        txt(String(d.bottomFinishes), { color: C.red, fontSize: 24, fontWeight: 700 }),
      ], { marginTop: 24, padding: '14px 22px', background: C.panel, border: '1px solid ' + C.line, borderRadius: 12 }) : null,
    ].filter(Boolean), { padding: '32px 48px', flex: 1 }),
    row([ txt('LMP> whoami --gw ' + d.gw + '  ·  last man paying', { color: C.dim, fontSize: 18 }) ], { padding: '0 48px 26px' }),
  ], { width: 1080, height, background: C.bg, fontFamily: 'IBM Plex Mono' });
}

async function renderBragPng(data) {
  const height = 980 + (data.bottomFinishes > 0 ? 100 : 0);
  return renderPng(card(data), { width: 1080, height });
}

module.exports = { renderBragPng };
