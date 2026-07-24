// Email via Resend + content builders for Phase 7 (reminders + payment confirmations).
//
// Design notes:
//  - Sender is FROM_EMAIL (env) so swapping the sandbox sender for a verified
//    domain later is a one-line env change, never a code hunt.
//  - REPLY_TO_EMAIL (env, optional) lets replies reach the treasurer even while
//    the sandbox sender (onboarding@resend.dev) can't receive mail.
//  - The audit log stores manager NAME as recipient, never the email address —
//    data.json is a public repo and must contain no PII.

const FROM_EMAIL = () => process.env.FROM_EMAIL || 'onboarding@resend.dev';
const FROM_NAME  = () => process.env.FROM_NAME  || 'LMP Treasurer';

// ── one-line-swap closing zinger, keyed by EPITHET (not person — epithets
// regenerate each season, the line should follow the title). R<x> = total owed.
const ZINGERS = {
  'Wooden Spoon':      "The view from the bottom isn't the only thing costing you.",
  'The Regular':       "This is becoming a habit, mate.",
  'Old Reliable':      "Reliable in the wrong weeks — let's see that reliability with the EFT.",
  'Trigger Happy':     "40 transfers and counting. One more click — pay R<x>.",
  'Departure Lounge':  "Still stuck at the gate. Settle up before final boarding.",
  'The Fugitive':      "The pot's put out an APB. Hand yourself in — R<x> bail.",
  'Glass Cannon':      "Your scores swing ±19. The fine is flat — R<x>.",
  'The Vibe':          "No fuss all season — don't ruin the streak. R<x> outstanding.",
  'Best Bench':        "372 points rotting on your bench won't pay this — but your banking app will.",
  'The Banker':        "Top scorer five times over — surely the transfer is a tap-in.",
  'The Dark Horse':    "You snuck into 5th unnoticed. Don't let R<x> sneak past you too.",
  'One-Hit Wonder':    "One unforgettable week. One very forgettable debt. Sort it — R<x>.",
  'The Tinkerman':     "Maybe the next transfer should be moving R<x> into the league account.",
  'Steady Eddie':      "Steadiest scorer in the league — be just as steady about settling up.",
  'The Phoenix':       "You rose from the ashes — now rise to the occasion. R<x>.",
  'The Patient One':   "You're patient with transfers; the pot's been patient with you. Time's up — R<x>.",
  "The Chef's Special":"Champion on the pitch, debtor in the ledger. Even the winner pays — R<x>.",
};
const zingerFor = (epithet, total) =>
  (ZINGERS[epithet] || "Settle up when you can — R<x> outstanding.").replace(/R<x>/g, 'R' + total);

const firstNameOf = n => (n || '').trim().split(/\s+/)[0] || n;
const ordinal = n => n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[(n % 100 >> 3 === 1) ? 0 : n % 10] || 'th');

// Outstanding = unpaid joining fee + every non-reversed fine with no paid_date.
// Mirrors the dashboard's ledger maths exactly.
function outstandingOf(manager, joiningFee = 250) {
  const fines = manager.fines
    .filter(f => !f.reversed && !f.paid_date)
    .map(f => ({ gw: f.gw || null, amount: f.amount, type: f.type, reason: f.reason || '' }));
  const finesTotal = fines.reduce((a, f) => a + f.amount, 0);
  const joiningOwed = manager.joining_fee_paid ? 0 : joiningFee;
  const gross = joiningOwed + finesTotal;
  // Prepaid credit (from overpayment) offsets what's owed; any surplus is carried.
  const credits = Math.max(0, manager.credits || 0);
  const appliedCredit = Math.min(credits, gross);
  const remainingCredit = credits - appliedCredit;
  return { fines, finesTotal, joiningOwed, gross, credits, appliedCredit, remainingCredit, total: gross - appliedCredit };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const typeLabel = t => String(t).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const pad = (label, val) => `${label} ${'.'.repeat(Math.max(3, 20 - label.length))} ${val}`;

// ── HTML email scaffolding (Terminal aesthetic) ──────────────────────────────
// Email clients are hostile: Gmail strips <style> and refuses SVG, Outlook uses
// Word's renderer. So: tables + inline styles + bgcolor attrs only, and the logo
// is rebuilt from coloured cells/text (the chevron prompt, LMP wordmark + cursor
// block, and the green/amber/red step) rather than the SVG, which won't render.
const MONO = "'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace";
const C = { bg:'#08090C', panel:'#0E1116', card:'#0B0D11', line:'#1E242E', line2:'#2C3542',
  amber:'#FFB224', amberDim:'#6a4a14', amberWash:'#241a06', text:'#D7DCE3', muted:'#8a95a2',
  faint:'#4D5663', green:'#3DDC97', red:'#FF5D5D', redWash:'#1a0e0e', redLine:'#5a2a2a' };
const blk = c => `<span style="display:inline-block;width:14px;height:17px;background:${c};margin-left:4px;vertical-align:middle;"></span>`;

function brandHeader() {
  return `<tr><td bgcolor="${C.panel}" style="background:${C.panel};padding:18px 24px;border-bottom:2px solid ${C.amber};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="vertical-align:middle;font-family:${MONO};">
        <span style="font-size:26px;font-weight:bold;color:${C.amber};">&rsaquo;</span>
        <span style="font-size:26px;font-weight:bold;color:${C.text};letter-spacing:3px;padding-left:6px;">LMP</span>
        <span style="display:inline-block;width:12px;height:22px;background:${C.amber};vertical-align:middle;margin-left:6px;"></span>
        <div style="font-size:11px;letter-spacing:4px;color:${C.muted};padding-top:8px;">LAST MAN PAYING</div>
      </td>
      <td align="right" style="vertical-align:middle;white-space:nowrap;">${blk(C.green)}${blk(C.amber)}${blk(C.red)}</td>
    </tr></table>
  </td></tr>`;
}

function emailShell(inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${C.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg};">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:${C.card};border:1px solid ${C.line};">
        ${brandHeader()}
        <tr><td style="padding:24px;font-family:${MONO};font-size:14px;line-height:1.6;color:${C.text};">
          ${inner}
        </td></tr>
        <tr><td bgcolor="${C.panel}" style="background:${C.panel};padding:12px 24px;border-top:1px solid ${C.line};font-family:${MONO};font-size:10px;letter-spacing:2px;color:${C.faint};text-transform:uppercase;">LMP Terminal · Last Man Paying</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const section = t => `<div style="margin:22px 0 8px;font-family:${MONO};font-size:11px;letter-spacing:3px;color:${C.amber};font-weight:bold;">${t}</div>`;

// ── REMINDER email ──────────────────────────────────────────────────────────
// ctx: { name, epithet, team, position, fieldSize, pts, out, banking }
function reminderEmail(ctx) {
  const first = firstNameOf(ctx.name);
  const { out, banking } = ctx;
  const ref = (banking.reference_format || '{first_name} FPL').replace('{first_name}', first);
  const posText = `${ordinal(ctx.position)} of ${ctx.fieldSize}`;
  const ptsText = Number(ctx.pts).toLocaleString('en-US');
  const subject = `FPL Last Man Paying — outstanding R${out.total}`;

  // owed line items
  const oweLines = [];
  oweLines.push(out.joiningOwed
    ? pad('Joining fee', `R${out.joiningOwed}`)
    : pad('Joining fee', 'paid ✓'));
  for (const f of out.fines) {
    const when = f.gw ? `GW${f.gw}` : 'manual';
    oweLines.push(pad(`${typeLabel(f.type)} fine`, `R${f.amount}`) + `   (${when}${f.reason ? ` · "${f.reason}"` : ''})`);
  }
  const zinger = zingerFor(ctx.epithet, out.total);

  const text =
`Hi ${first},

A quick one from the league treasurer — your account has an outstanding balance.

WHERE YOU STAND
${ctx.epithet || '—'}
${ctx.team} · ${posText} · ${ptsText} pts

WHAT YOU OWE
${oweLines.join('\n')}

TOTAL OUTSTANDING: R${out.total}

HOW TO PAY
${pad('Bank', `${banking.bank} (${banking.account_type})`)}
${pad('Account holder', banking.account_holder)}
${pad('Account number', banking.account_number)}
${pad('Branch code', banking.branch_code)}
${pad('Reference', ref)}      ← please use exactly this

${zinger}

— The Treasurer`;

  const oweRows = out.fines.map(f => {
    const when = f.gw ? `GW${f.gw}` : 'manual';
    return `<tr><td style="padding:3px 0;color:${C.text};">${esc(typeLabel(f.type))} fine <span style="color:${C.muted};">(${when}${f.reason ? ` · ${esc(f.reason)}` : ''})</span></td><td align="right" style="padding:3px 0;color:${C.red};white-space:nowrap;">R${f.amount}</td></tr>`;
  }).join('');
  const joiningRow = out.joiningOwed
    ? `<tr><td style="padding:3px 0;color:${C.text};">Joining fee</td><td align="right" style="padding:3px 0;color:${C.red};">R${out.joiningOwed}</td></tr>`
    : `<tr><td style="padding:3px 0;color:${C.text};">Joining fee</td><td align="right" style="padding:3px 0;color:${C.green};">paid ✓</td></tr>`;

  const bankRow = (k, v) => `<tr><td style="padding:2px 18px 2px 0;color:${C.muted};white-space:nowrap;">${esc(k)}</td><td style="padding:2px 0;color:${C.text};">${esc(v)}</td></tr>`;

  const inner =
`<p style="margin:0 0 14px;">Hi ${esc(first)},</p>
  <p style="margin:0 0 4px;">A quick one from the league treasurer — your account has an outstanding balance.</p>
  ${section('WHERE YOU STAND')}
  <div style="font-weight:bold;color:${C.text};font-size:15px;">${esc(ctx.epithet || '—')}</div>
  <div style="color:${C.muted};">${esc(ctx.team)} · ${posText} · ${ptsText} pts</div>
  ${section('WHAT YOU OWE')}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${MONO};font-size:14px;">${joiningRow}${oweRows}</table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;"><tr>
    <td bgcolor="${C.redWash}" style="background:${C.redWash};border:1px solid ${C.redLine};padding:12px 14px;color:${C.red};font-weight:bold;font-size:16px;">TOTAL OUTSTANDING: R${out.total}</td>
  </tr></table>
  ${section('HOW TO PAY')}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.panel}" style="background:${C.panel};border:1px solid ${C.line2};border-top:2px solid ${C.amber};"><tr><td style="padding:14px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-family:${MONO};font-size:13px;">
      ${bankRow('Bank', `${banking.bank} (${banking.account_type})`)}
      ${bankRow('Account holder', banking.account_holder)}
      ${bankRow('Account number', banking.account_number)}
      ${bankRow('Branch code', banking.branch_code)}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;"><tr>
      <td bgcolor="${C.amberWash}" style="background:${C.amberWash};border:1px solid ${C.amberDim};padding:9px 12px;font-family:${MONO};font-size:13px;">
        <span style="color:${C.muted};">Reference</span> &nbsp;<span style="color:${C.amber};font-weight:bold;">${esc(ref)}</span>
        <span style="color:${C.muted};"> &larr; use exactly this</span>
      </td>
    </tr></table>
  </td></tr></table>
  <p style="margin:22px 0 6px;font-style:italic;color:${C.text};">${esc(zinger)}</p>
  <p style="margin:0;color:${C.muted};">&mdash; The Treasurer</p>`;

  return { subject, text, html: emailShell(inner) };
}

// ── CONFIRMATION email (auto-sent when a payment is marked paid) ─────────────
function confirmationEmail({ name, paidAmount, newBalance }) {
  const first = firstNameOf(name);
  const subject = 'FPL — payment received';
  const text = `Hi ${first}, your R${paidAmount} has been credited. Outstanding balance: R${newBalance}. Cheers — The Treasurer`;
  const balColor = Number(newBalance) > 0 ? C.red : C.green;
  const inner =
`<p style="margin:0 0 14px;">Hi ${esc(first)},</p>
  <p style="margin:0 0 10px;">Your <span style="color:${C.green};font-weight:bold;">R${paidAmount}</span> has been credited.</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 14px;"><tr>
    <td style="font-family:${MONO};color:${C.muted};padding-right:10px;">Outstanding balance</td>
    <td style="font-family:${MONO};color:${balColor};font-weight:bold;">R${newBalance}</td>
  </tr></table>
  <p style="margin:0;color:${C.muted};">Cheers &mdash; The Treasurer</p>`;
  return { subject, text, html: emailShell(inner) };
}

// ── ANNOUNCEMENT email (general league comms — not debt) ─────────────────────
// Same Terminal shell as the reminder, but an amber ANNOUNCEMENT header instead
// of the red outstanding panel, and no WHAT YOU OWE / HOW TO PAY / zinger.
function announcementEmail({ name, subject, body }) {
  const first = firstNameOf(name);
  const safeBody = esc(body).replace(/\r?\n/g, '<br>');
  const inner =
`<p style="margin:0 0 16px;">Hi ${esc(first)},</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr>
    <td bgcolor="${C.amberWash}" style="background:${C.amberWash};border:1px solid ${C.amberDim};border-left:3px solid ${C.amber};padding:12px 14px;">
      <div style="font-family:${MONO};font-size:11px;letter-spacing:3px;color:${C.amber};font-weight:bold;">&rsaquo; ANNOUNCEMENT</div>
      ${subject ? `<div style="color:${C.text};font-weight:bold;font-size:15px;margin-top:5px;">${esc(subject)}</div>` : ''}
    </td>
  </tr></table>
  <div style="color:${C.text};">${safeBody}</div>
  <p style="margin:24px 0 0;color:${C.muted};">&mdash; The Treasurer</p>`;
  const text = `Hi ${first},\n\n> ANNOUNCEMENT${subject ? '\n'+subject : ''}\n\n${body}\n\n— The Treasurer`;
  return { subject: subject || 'FPL Last Man Paying — announcement', text, html: emailShell(inner) };
}

// ── Resend transport ────────────────────────────────────────────────────────
async function resendSend({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) { const e = new Error('RESEND_API_KEY not set'); e.code = 'NO_KEY'; throw e; }
  const payload = { from: `${FROM_NAME()} <${FROM_EMAIL()}>`, to: [to], subject, html, text };
  if (process.env.REPLY_TO_EMAIL) payload.reply_to = process.env.REPLY_TO_EMAIL;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    const e = new Error(`resend ${r.status}: ${t.slice(0, 200)}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

// Best-effort confirmation send: resolves the address from MANAGER_EMAILS,
// sends, and reports whether it went. Throws only on a transport error (caller
// treats that as non-fatal — the payment itself is already recorded).
async function sendConfirmation({ name, paidAmount, newBalance }) {
  let emails; try { emails = JSON.parse(process.env.MANAGER_EMAILS || '{}'); } catch { emails = {}; }
  const to = emails[name];
  if (!to) return { sent: false, reason: 'no email on file' };
  const { subject, html, text } = confirmationEmail({ name, paidAmount, newBalance });
  await resendSend({ to, subject, html, text });
  return { sent: true, subject };
}

// Audit entry — name only as recipient, no email, no body.
const auditEntry = ({ type, recipient, subject }) => ({
  type, recipient, subject,
  sent_at: new Date().toISOString(),
  sent_by: 'treasurer',
});

module.exports = {
  resendSend, reminderEmail, confirmationEmail, announcementEmail, sendConfirmation,
  outstandingOf, auditEntry, zingerFor,
  FROM_EMAIL, FROM_NAME, firstNameOf, ordinal,
};
