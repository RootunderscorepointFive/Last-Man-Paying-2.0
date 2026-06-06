// POST /api/mark-fine-paid  { password, name, target }
// target = a specific fine id, or 'all' for every outstanding (unpaid, un-reversed) fine.
const { requireTreasurer } = require('../lib/auth');
const { mutateData } = require('../lib/github');

module.exports = async (req, res) => {
  const body = requireTreasurer(req, res);
  if (!body) return;
  const { name, target } = body;
  if (!name || !target) return res.status(400).json({ error: 'name and target required' });

  try {
    let marked = 0;
    const result = await mutateData(
      `Treasurer: mark LMP fine paid — ${name} (${target === 'all' ? 'all outstanding' : target})`,
      (data) => {
        const m = data.managers.find(x => x.name === name);
        if (!m) return false;
        const now = new Date().toISOString();
        const pay = f => { if (!f.reversed && !f.paid_date) { f.paid_date = now; f.paid_by = 'treasurer'; marked++; } };
        if (target === 'all') m.fines.forEach(pay);
        else { const f = m.fines.find(x => x.id === target); if (!f) return false; pay(f); }
        data.generated_at = now;
        return true;
      }
    );
    if (result && result.aborted) return res.status(404).json({ error: 'manager or fine not found' });
    return res.status(200).json({ ok: true, marked });
  } catch (e) {
    console.error('mark-fine-paid:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
