// POST /api/record-payment  { password, name, amount }
// Records a real payment amount against a member. The amount (plus any credit
// already on account) is allocated to the joining fee first, then to unpaid fines
// oldest-first. Any surplus over what they owe is banked as `credits`, which
// offsets future charges. Fines are atomic — only settled when fully covered.
const { requireTreasurer } = require('../lib/auth');
const { mutateData } = require('../lib/github');
const { outstandingOf, sendConfirmation, auditEntry } = require('../lib/email');
const config = require('../config.json');

module.exports = async (req, res) => {
  const body = requireTreasurer(req, res);
  if (!body) return;
  let { name, amount } = body;
  amount = Number(amount);
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!(amount > 0)) return res.status(400).json({ error: 'amount must be positive' });

  const fee = config.joining_fee || 250;
  try {
    let allocated = [], creditsAfter = 0, newBalance = 0;
    const result = await mutateData(
      `Treasurer: record payment R${amount} — ${name}`,
      (data) => {
        const m = data.managers.find(x => x.name === name);
        if (!m) return false;
        const now = new Date().toISOString();
        allocated = [];                          // reset per attempt (mutate may re-run on 409)
        let pool = amount + Math.max(0, m.credits || 0);
        m.credits = 0;

        // 1) Joining fee first.
        if (!m.joining_fee_paid && pool >= fee) {
          m.joining_fee_paid = true;
          m.joining_fee_paid_by = 'payment';
          m.joining_fee_paid_date = now;
          pool -= fee;
          allocated.push({ kind: 'joining', amount: fee });
        }
        // 2) Unpaid, non-reversed fines, oldest-first. Atomic: only settle a fine
        //    the pool can cover in full; a partial remainder stays as credit.
        const unpaid = m.fines
          .filter(f => !f.reversed && !f.paid_date)
          .sort((a, b) => String(a.added_date || '').localeCompare(String(b.added_date || '')) || (a.gw || 0) - (b.gw || 0));
        for (const f of unpaid) {
          if (pool < f.amount) continue;
          f.paid_date = now;
          f.paid_by = 'payment';
          pool -= f.amount;
          allocated.push({ kind: 'fine', id: f.id, gw: f.gw || null, amount: f.amount });
        }
        // 3) Surplus banks as credit toward future charges.
        m.credits = pool;
        creditsAfter = pool;

        (m.payments = m.payments || []).push({
          id: `p_${m.entry}_${Date.now()}`, amount, date: now,
          recorded_by: 'treasurer', allocated: allocated.slice(), credit_after: creditsAfter,
        });
        newBalance = outstandingOf(m, fee).total;
        data.generated_at = now;
        return true;
      }
    );
    if (result && result.aborted) return res.status(409).json({ error: 'manager not found' });

    // Confirmation email — best-effort, never blocks the record.
    try {
      const conf = await sendConfirmation({ name, paidAmount: amount, newBalance });
      if (conf && conf.sent) {
        await mutateData(`Email: payment confirmation — ${name}`,
          (d) => { (d.email_log = d.email_log || []).push(auditEntry({ type: 'confirmation', recipient: name, subject: conf.subject })); return true; });
      }
    } catch (e) { console.error('record-payment confirmation email:', name, e.message); }

    return res.status(200).json({ ok: true, allocated, credits: creditsAfter, outstanding: newBalance });
  } catch (e) {
    console.error('record-payment:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
