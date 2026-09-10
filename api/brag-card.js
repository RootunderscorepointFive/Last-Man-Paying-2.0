// GET /api/brag-card?name=X&gw=N
// Public, shareable PNG "brag card" for one manager (defaults to the latest
// scored gameweek for that manager). Reads live committed data the same way
// weekly-image.js does — no treasurer auth, this is just personal stats.
const { getData, getFile } = require('../lib/github');
const { buildBrag } = require('../lib/brag');
const { renderBragPng } = require('../lib/brag-image');
const config = require('../config.json');

module.exports = async (req, res) => {
  try {
    const name = req.query && req.query.name ? String(req.query.name) : null;
    if (!name) return res.status(400).json({ error: 'name required' });

    const { data } = await getData();
    let fpl = {};
    try { fpl = await getFile('fpl_data.json'); } catch { /* no feed yet */ }

    const gwArg = req.query && req.query.gw ? req.query.gw : null;
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
  } catch (e) {
    console.error('brag-card:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
