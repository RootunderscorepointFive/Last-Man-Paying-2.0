// POST /api/send-weekly-summary  { password, gw?, recipients? }
// Treasurer-only. Renders the weekly infographic once and emails it (attached),
// with the headline numbers as text in the body. Defaults to every manager with
// an email on file. Mirrors the defensive batch behaviour of send-announcement.
const { requireTreasurer } = require('../lib/auth');
const { getData, getFile, mutateData } = require('../lib/github');
const { buildWeekly } = require('../lib/weekly');
const { renderWeeklyPng } = require('../lib/weekly-image');
const { resendSend, weeklySummaryEmail } = require('../lib/email');
const config = require('../config.json');

module.exports = async (req, res) => {
  const body = requireTreasurer(req, res);
  if (!body) return;

  let emails;
  try { emails = JSON.parse(process.env.MANAGER_EMAILS || '{}'); }
  catch { return res.status(500).json({ error: 'MANAGER_EMAILS env is not valid JSON' }); }

  try {
    const { data } = await getData();
    let fpl = {};
    try { fpl = await getFile('fpl_data.json'); } catch { /* no feed yet */ }

    const weekly = buildWeekly(fpl, data, config, body.gw || null);
    if (!weekly.ready) return res.status(409).json({ error: 'No scored gameweek yet to summarise.' });

    // Render the infographic once; attach the same PNG to every send.
    const png = await renderWeeklyPng(weekly);
    const attachments = [{ filename: `lmp-gw${weekly.gw}.png`, content: png.toString('base64') }];
    const { subject, html, text } = weeklySummaryEmail(weekly);

    const names = Array.isArray(body.recipients) && body.recipients.length
      ? body.recipients
      : (data.managers || []).map(m => m.name);

    const sent = [], skipped = [];
    for (const name of names) {
      const to = emails[name];
      if (!to) { skipped.push({ name, reason: 'no email on file' }); continue; }
      try { await resendSend({ to, subject, html, text, attachments }); sent.push(name); }
      catch (e) { console.error('send-weekly-summary send failed:', name, e.message); skipped.push({ name, reason: 'send failed' }); }
      await new Promise(r => setTimeout(r, 120)); // stay under Resend's ~10 req/s
    }

    if (sent.length) {
      await mutateData(
        `Email: GW${weekly.gw} weekly summary to ${sent.length}`.slice(0, 200),
        (d) => {
          (d.email_log = d.email_log || []).push({ type: 'weekly_summary', gw: weekly.gw, recipients: sent, subject, sent_at: new Date().toISOString(), sent_by: 'treasurer' });
          d.generated_at = new Date().toISOString();
          return true;
        }
      );
    }

    return res.status(200).json({ ok: true, gw: weekly.gw, sent: sent.length, skipped: skipped.length, sentNames: sent, skippedDetails: skipped });
  } catch (e) {
    console.error('send-weekly-summary:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
