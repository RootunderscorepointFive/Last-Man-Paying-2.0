// POST /api/edit-fine  { password, name, fineId, amount?, reason?, note }
// note ("what changed and why") is required and appended to edit_history.
const { requireTreasurer } = require('../lib/auth');
const { mutateData } = require('../lib/github');

module.exports = async (req, res) => {
  const body = requireTreasurer(req, res);
  if (!body) return;
  let { name, fineId, amount, reason, note } = body;
  if (!name || !fineId) return res.status(400).json({ error: 'name and fineId required' });
  if (!note || !String(note).trim()) return res.status(400).json({ error: 'edit note required' });

  try {
    const result = await mutateData(`Treasurer: edit fine ${fineId} — ${name}`, (data) => {
      const m = data.managers.find(x => x.name === name);
      if (!m) return false;
      const f = m.fines.find(x => x.id === fineId);
      if (!f) return false;
      const before = { amount: f.amount, reason: f.reason };
      if (amount != null && amount !== '' && Number(amount) > 0) f.amount = Number(amount);
      if (reason != null && String(reason).trim()) f.reason = String(reason).trim();
      const now = new Date().toISOString();
      f.edited_by = 'treasurer';
      f.edited_date = now;
      (f.edit_history = f.edit_history || []).push({
        at: now, by: 'treasurer', note: String(note).trim(),
        before, after: { amount: f.amount, reason: f.reason },
      });
      data.generated_at = now;
      return true;
    });
    if (result && result.aborted) return res.status(409).json({ error: 'manager/fine not found' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('edit-fine:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
