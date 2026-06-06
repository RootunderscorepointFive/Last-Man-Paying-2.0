// POST /api/add-fine  { password, name, amount, type, reason, gw? }
const { requireTreasurer } = require('../lib/auth');
const { mutateData } = require('../lib/github');

const VALID_TYPES = ['losers_fine', 'disciplinary', 'late_payment', 'adjustment', 'other'];

module.exports = async (req, res) => {
  const body = requireTreasurer(req, res);
  if (!body) return;
  let { name, amount, type, reason, gw } = body;
  amount = Number(amount);
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!(amount > 0)) return res.status(400).json({ error: 'amount must be positive' });
  if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'invalid fine type' });
  if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'reason required' });
  gw = (gw === '' || gw == null) ? null : Number(gw);

  try {
    const now = new Date().toISOString();
    const result = await mutateData(`Treasurer: add ${type} fine R${amount} — ${name}`, (data) => {
      const m = data.managers.find(x => x.name === name);
      if (!m) return false;
      m.fines.push({
        id: `f_${m.entry}_${Date.now()}`,
        gw, amount, type, status: 'confirmed',
        reason: String(reason).trim(),
        paid_date: null,
        reversed: false, reversed_reason: null, reversed_by: null, reversed_date: null,
        added_by: 'treasurer', added_date: now,
        edited_by: null, edited_date: null, edit_history: [],
      });
      data.generated_at = now;
      return true;
    });
    if (result && result.aborted) return res.status(404).json({ error: 'manager not found' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('add-fine:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
