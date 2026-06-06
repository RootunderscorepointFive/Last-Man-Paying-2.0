// POST /api/reverse-fine  { password, name, fineId, reason }
// Never deletes — sets reversed:true with audit. If it was a bottom fine, also
// drops that GW from bottom_finishes so counts/totals stay consistent.
const { requireTreasurer } = require('../lib/auth');
const { mutateData } = require('../lib/github');

module.exports = async (req, res) => {
  const body = requireTreasurer(req, res);
  if (!body) return;
  const { name, fineId, reason } = body;
  if (!name || !fineId) return res.status(400).json({ error: 'name and fineId required' });
  if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'reason required' });

  try {
    const result = await mutateData(`Treasurer: reverse fine ${fineId} — ${name}`, (data) => {
      const m = data.managers.find(x => x.name === name);
      if (!m) return false;
      const f = m.fines.find(x => x.id === fineId);
      if (!f || f.reversed) return false; // not found or already reversed
      const now = new Date().toISOString();
      f.reversed = true;
      f.reversed_reason = String(reason).trim();
      f.reversed_by = 'treasurer';
      f.reversed_date = now;
      if (f.type === 'bottom' && f.gw != null) m.bottom_finishes = m.bottom_finishes.filter(g => g !== f.gw);
      data.generated_at = now;
      return true;
    });
    if (result && result.aborted) return res.status(404).json({ error: 'manager/fine not found or already reversed' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('reverse-fine:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
