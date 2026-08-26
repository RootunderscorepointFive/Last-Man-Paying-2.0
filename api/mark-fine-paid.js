// POST /api/mark-fine-paid  { password, name, target }
// target = a specific fine id, or 'all' for every outstanding (unpaid, un-reversed) fine.
const { requireTreasurer } = require('../lib/auth');
const { mutateData } = require('../lib/github');
const { outstandingOf, sendConfirmation, auditEntry } = require('../lib/email');
const { consumeCredit } = require('../lib/ledger');
const config = require('../config.json');

module.exports = async (req, res) => {
  const body = requireTreasurer(req, res);
  if (!body) return;
  const { name, target } = body;
  if (!name || !target) return res.status(400).json({ error: 'name and target required' });

  try {
    let marked = 0, paidAmount = 0, newBalance = 0;
    const result = await mutateData(
      `Treasurer: mark LMP fine paid — ${name} (${target === 'all' ? 'all outstanding' : target})`,
      (data) => {
        const m = data.managers.find(x => x.name === name);
        if (!m) return false;
        const now = new Date().toISOString();
        marked = 0; paidAmount = 0; // reset per attempt (mutate may re-run on 409)
        const pay = f => {
          if (f.reversed || f.paid_date) return;
          const { creditApplied, cashRequired } = consumeCredit(m, f.amount);
          f.paid_date = now;
          f.paid_by = cashRequired === 0 ? 'credit' : 'treasurer';
          if (creditApplied) f.credit_applied = creditApplied;
          marked++;
          paidAmount += cashRequired;
        };
        if (target === 'all') m.fines.forEach(pay);
        else { const f = m.fines.find(x => x.id === target); if (!f) return false; pay(f); }
        newBalance = outstandingOf(m, config.joining_fee || 300).total;
        data.generated_at = now;
        return true;
      }
    );
    if (result && result.aborted) return res.status(409).json({ error: 'manager or fine not found' });

    // Confirmation email — best-effort, never blocks or fails the payment record.
    if (marked > 0 && paidAmount > 0) {
      try {
        const conf = await sendConfirmation({ name, paidAmount, newBalance });
        if (conf.sent) {
          await mutateData(`Email: payment confirmation — ${name}`,
            (d) => { (d.email_log = d.email_log || []).push(auditEntry({ type: 'confirmation', recipient: name, subject: conf.subject })); return true; });
        }
      } catch (e) { console.error('mark-fine-paid confirmation email:', name, e.message); }
    }

    return res.status(200).json({ ok: true, marked });
  } catch (e) {
    console.error('mark-fine-paid:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
