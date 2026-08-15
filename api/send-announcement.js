// POST /api/send-announcement  { password, subject, body, recipients: ["Full Name", ...] }
// Treasurer-only general comms (deadline reminders, rules, invites). Not debt.
// Defensive batch: a missing address or Resend error skips that recipient and
// the batch continues. One audit entry logs the recipient NAMES + subject (no body).
const { requireTreasurer } = require('../lib/auth');
const { mutateData } = require('../lib/github');
const { resendSend, announcementEmail } = require('../lib/email');

module.exports = async (req, res) => {
  const body = requireTreasurer(req, res);
  if (!body) return;

  const recipients = Array.isArray(body.recipients) ? body.recipients : null;
  const subject = (body.subject || '').trim();
  const message = body.body || '';
  if (!recipients || !recipients.length) return res.status(400).json({ error: 'recipients[] required' });
  if (!subject) return res.status(400).json({ error: 'subject required' });
  if (!String(message).trim()) return res.status(400).json({ error: 'body required' });

  let emails;
  try { emails = JSON.parse(process.env.MANAGER_EMAILS || '{}'); }
  catch { return res.status(500).json({ error: 'MANAGER_EMAILS env is not valid JSON' }); }

  try {
    const sent = [], skipped = [];
    for (const name of recipients) {
      const to = emails[name];
      if (!to) { skipped.push({ name, reason: 'no email on file' }); continue; }
      const { subject: subj, html, text } = announcementEmail({ name, subject, body: message });
      try { await resendSend({ to, subject: subj, html, text }); sent.push(name); }
      catch (e) { console.error('send-announcement send failed:', name, e.message); skipped.push({ name, reason: 'send failed' }); }
      await new Promise(r => setTimeout(r, 120)); // stay under Resend's ~10 req/s
    }

    if (sent.length) {
      await mutateData(
        `Email: announcement to ${sent.length} — "${subject.slice(0, 60)}"`.slice(0, 200),
        (d) => {
          (d.email_log = d.email_log || []).push({ type: 'announcement', recipients: sent, subject, sent_at: new Date().toISOString(), sent_by: 'treasurer' });
          d.generated_at = new Date().toISOString();
          return true;
        }
      );
    }

    return res.status(200).json({ ok: true, sent: sent.length, skipped: skipped.length, sentNames: sent, skippedDetails: skipped });
  } catch (e) {
    console.error('send-announcement:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
