// POST /api/mark-joining-paid  { password, name, reason? }
// Reference treasurer action. Password-gated; writes audit metadata; commits
// data.json back to the repo (which triggers a redeploy).
const { requireTreasurer } = require('../lib/auth');
const { mutateData } = require('../lib/github');

module.exports = async (req, res) => {
  const body = requireTreasurer(req, res);
  if (!body) return; // 401 / 405 already sent

  const { name, reason } = body;
  if (!name) return res.status(400).json({ error: 'manager name required' });

  try {
    const result = await mutateData(`Treasurer: mark joining fee paid — ${name}`, (data) => {
      const m = data.managers.find(x => x.name === name);
      if (!m) return false; // abort → not found
      m.joining_fee_paid = true;
      m.joining_fee_paid_by = 'treasurer';
      m.joining_fee_paid_date = new Date().toISOString();
      if (reason) m.joining_fee_paid_reason = reason;
      data.generated_at = new Date().toISOString();
      return true;
    });
    if (result && result.aborted) return res.status(404).json({ error: 'manager not found' });
    return res.status(200).json({ ok: true, name });
  } catch (e) {
    console.error('mark-joining-paid:', e.message); // logged server-side only
    return res.status(500).json({ error: 'Server error' });
  }
};
