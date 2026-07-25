// GET /api/weekly-image?gw=N
// Public, shareable PNG infographic of the weekly summary (defaults to the latest
// scored gameweek). Reads live committed data the same way the other endpoints do.
const { getData, getFile } = require('../lib/github');
const { buildWeekly } = require('../lib/weekly');
const { renderWeeklyPng } = require('../lib/weekly-image');
const config = require('../config.json');

module.exports = async (req, res) => {
  try {
    const { data } = await getData();
    let fpl = {};
    try { fpl = await getFile('fpl_data.json'); } catch { /* no feed yet — buildWeekly handles it */ }

    const gwArg = req.query && req.query.gw ? req.query.gw : null;
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
