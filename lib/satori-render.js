// Shared Satori building blocks — fonts, colors, and the col/row/txt helpers
// every rendered card (weekly summary, brag card, ...) is built from.
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

async function renderPng(element, { width, height }) {
  const satori = (await import('satori')).default;
  const { Resvg } = require('@resvg/resvg-js');
  const svg = await satori(element, { width, height, fonts: fonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
}

module.exports = { C, col, row, txt, fonts, photo, renderPng };
