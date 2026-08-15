// POST /api/send-reminders  { password, recipients: ["Full Name", ...] }
// Sends a personalised outstanding-balance reminder to each selected manager.
// Defensive batch: a missing address or a Resend error skips that one recipient
// and the batch continues. Only successful sends are written to the audit log.
const { requireTreasurer } = require('../lib/auth');
const { getData, getFile, mutateData } = require('../lib/github');
const { resendSend, reminderEmail, outstandingOf, auditEntry } = require('../lib/email');
const config = require('../config.json');

module.exports = async (req, res) => {
  const body = requireTreasurer(req, res);
  if (!body) return;

  const recipients = Array.isArray(body.recipients) ? body.recipients : null;
  if (!recipients || !recipients.length) return res.status(400).json({ error: 'recipients[] required' });

  let emails;
  try { emails = JSON.parse(process.env.MANAGER_EMAILS || '{}'); }
  catch { return res.status(500).json({ error: 'MANAGER_EMAILS env is not valid JSON' }); }

  try {
    const { data } = await getData();
    let fpl = null;
    try { fpl = await getFile('fpl_data.json'); } catch { /* standings are flavour; degrade gracefully */ }

    const standings = (fpl && fpl.standings) || [];
    const ranked = [...standings].sort((a, b) => b.pts - a.pts);
    const posByName = {}; ranked.forEach((s, i) => { posByName[s.manager] = i + 1; });
    const ptsByName = {}; standings.forEach(s => { ptsByName[s.manager] = s.pts; });
    const fieldSize = data.managers.length;
    const banking = config.banking || {};

    const sent = [];
    const skipped = [];
    const audit = [];

    for (const name of recipients) {
      const m = data.managers.find(x => x.name === name);
      if (!m) { skipped.push({ name, reason: 'unknown manager' }); continue; }

      const out = outstandingOf(m, config.joining_fee || 250);
      if (out.total <= 0) { skipped.push({ name, reason: 'nothing outstanding' }); continue; }

      const to = emails[name];
      if (!to) { skipped.push({ name, reason: 'no email on file' }); continue; }

      const { subject, html, text } = reminderEmail({
        name, epithet: m.epithet, team: m.team,
        position: posByName[name] || fieldSize, fieldSize,
        pts: ptsByName[name] || 0, out, banking,
      });

      try {
        await resendSend({ to, subject, html, text });
        sent.push(name);
        audit.push(auditEntry({ type: 'reminder', recipient: name, subject }));
      } catch (e) {
        console.error('send-reminders send failed:', name, e.message);
        skipped.push({ name, reason: 'send failed' });
      }
      await new Promise(r => setTimeout(r, 120)); // stay under Resend's ~10 req/s
    }

    // Persist audit AFTER sends (so a 409 retry never re-sends; appending is
    // idempotent because each retry re-reads fresh data before pushing once).
    if (audit.length) {
      await mutateData(
        `Email: ${audit.length} reminder${audit.length > 1 ? 's' : ''} sent — ${sent.join(', ')}`.slice(0, 240),
        (d) => { (d.email_log = d.email_log || []).push(...audit); d.generated_at = new Date().toISOString(); return true; }
      );
    }

    return res.status(200).json({ ok: true, sent: sent.length, skipped: skipped.length, sentNames: sent, skippedDetails: skipped });
  } catch (e) {
    console.error('send-reminders:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
