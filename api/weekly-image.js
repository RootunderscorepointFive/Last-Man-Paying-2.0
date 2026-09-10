// GET /api/weekly-image?gw=N            — league-wide weekly summary infographic
// GET /api/weekly-image?name=X&gw=N      — one manager's personal "brag card"
// Both public, shareable PNGs (no treasurer auth — just stats). Sharing one
// function keeps the deployment under Vercel Hobby's 12-function cap; see
// lib/weekly-image.js / lib/brag-image.js for the two card layouts, both
// built on the same lib/satori-render.js pipeline.
const { getData, getFile } = require('../lib/github');
const { buildWeekly } = require('../lib/weekly');
const { renderWeeklyPng } = require('../lib/weekly-image');
const { buildBrag } = require('../lib/brag');
const { renderBragPng } = require('../lib/brag-image');
const config = require('../config.json');

module.exports = async (req, res) => {
  try {
    const { data } = await getData();
    let fpl = {};
    try { fpl = await getFile('fpl_data.json'); } catch { /* no feed yet — buildWeekly/buildBrag handle it */ }

    const gwArg = req.query && req.query.gw ? req.query.gw : null;
    const name = req.query && req.query.name ? String(req.query.name) : null;

    if (name) {
      const brag = buildBrag(fpl, data, config, name, gwArg);
      if (!brag.ready) {
        const code = brag.reason === 'manager not found' ? 404 : 409;
        return res.status(code).json({ error: brag.reason === 'manager not found' ? 'Manager not found.' : 'No scored gameweek yet for this manager.' });
      }
      const png = await renderBragPng(brag);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `inline; filename="lmp-${name.replace(/\W+/g, '-')}-gw${brag.gw}.png"`);
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
      return res.status(200).send(png);
    }

    const weekly = buildWeekly(fpl, data, config, gwArg);
    if (!weekly.ready) return res.status(409).json({ error: 'No scored gameweek yet.' });

    const png = await renderWeeklyPng(weekly);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="lmp-gw${weekly.gw}.png"`);
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).send(png);
  } catch (e) {
    console.error('weekly-image:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
