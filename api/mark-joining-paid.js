// POST /api/mark-joining-paid  { password, name, reason? }
// Reference treasurer action. Password-gated; writes audit metadata; commits
// data.json back to the repo (which triggers a redeploy).
const { requireTreasurer } = require('../lib/auth');
const { mutateData } = require('../lib/github');
const { outstandingOf, sendConfirmation, auditEntry } = require('../lib/email');
const { consumeCredit } = require('../lib/ledger');
const config = require('../config.json');

module.exports = async (req, res) => {
  const body = requireTreasurer(req, res);
  if (!body) return; // 401 / 405 already sent

  const { name, reason } = body;
  if (!name) return res.status(400).json({ error: 'manager name required' });

  try {
    let didMark = false, paidAmount = 0, newBalance = 0;
    const fee = config.joining_fee || 300;
    const result = await mutateData(`Treasurer: mark joining fee paid — ${name}`, (data) => {
      const m = data.managers.find(x => x.name === name);
      if (!m) return false; // abort → not found
      didMark = !m.joining_fee_paid; // only a real state change counts as "received"
      if (didMark) {
        const { creditApplied, cashRequired } = consumeCredit(m, fee);
        paidAmount = cashRequired;
        if (creditApplied) m.joining_fee_credit_applied = creditApplied;
      }
      m.joining_fee_paid = true;
      m.joining_fee_paid_by = didMark && paidAmount === 0 ? 'credit' : 'treasurer';
      m.joining_fee_paid_date = new Date().toISOString();
      if (reason) m.joining_fee_paid_reason = reason;
      newBalance = outstandingOf(m, fee).total;
      data.generated_at = new Date().toISOString();
      return true;
    });
    if (result && result.aborted) return res.status(409).json({ error: 'manager not found' });

    // Confirmation email — only if new cash was actually received; best-effort.
    if (didMark && paidAmount > 0) {
      try {
        const conf = await sendConfirmation({ name, paidAmount, newBalance });
        if (conf.sent) {
          await mutateData(`Email: payment confirmation — ${name}`,
            (d) => { (d.email_log = d.email_log || []).push(auditEntry({ type: 'confirmation', recipient: name, subject: conf.subject })); return true; });
        }
      } catch (e) { console.error('mark-joining-paid confirmation email:', name, e.message); }
    }

    return res.status(200).json({ ok: true, name });
  } catch (e) {
    console.error('mark-joining-paid:', e.message); // logged server-side only
    return res.status(500).json({ error: 'Server error' });
  }
};
