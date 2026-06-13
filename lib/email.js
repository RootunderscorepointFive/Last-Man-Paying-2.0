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
  return { fines, finesTotal, joiningOwed, total: joiningOwed + finesTotal };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const typeLabel = t => String(t).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const pad = (label, val) => `${label} ${'.'.repeat(Math.max(3, 20 - label.length))} ${val}`;

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
    return `<tr><td style="padding:2px 0">${esc(typeLabel(f.type))} fine <span style="color:#888">(${when}${f.reason ? ` · ${esc(f.reason)}` : ''})</span></td><td style="padding:2px 0;text-align:right;font-variant-numeric:tabular-nums">R${f.amount}</td></tr>`;
  }).join('');
  const joiningRow = out.joiningOwed
    ? `<tr><td style="padding:2px 0">Joining fee</td><td style="padding:2px 0;text-align:right">R${out.joiningOwed}</td></tr>`
    : `<tr><td style="padding:2px 0">Joining fee</td><td style="padding:2px 0;text-align:right;color:#1E9E6A">paid ✓</td></tr>`;

  const html =
`<div style="font-family:ui-monospace,Menlo,Consolas,monospace;color:#15181E;max-width:560px;line-height:1.6;font-size:14px">
  <p>Hi ${esc(first)},</p>
  <p>A quick one from the league treasurer — your account has an outstanding balance.</p>
  <h3 style="margin:22px 0 4px;font-size:12px;letter-spacing:.12em;color:#6B7484">WHERE YOU STAND</h3>
  <div style="font-weight:700">${esc(ctx.epithet || '—')}</div>
  <div style="color:#444">${esc(ctx.team)} · ${posText} · ${ptsText} pts</div>
  <h3 style="margin:22px 0 4px;font-size:12px;letter-spacing:.12em;color:#6B7484">WHAT YOU OWE</h3>
  <table style="width:100%;border-collapse:collapse">${joiningRow}${oweRows}</table>
  <p style="font-weight:700;font-size:16px;margin:14px 0">TOTAL OUTSTANDING: R${out.total}</p>
  <h3 style="margin:22px 0 4px;font-size:12px;letter-spacing:.12em;color:#6B7484">HOW TO PAY</h3>
  <table style="border-collapse:collapse">
    <tr><td style="padding:1px 16px 1px 0;color:#6B7484">Bank</td><td>${esc(banking.bank)} (${esc(banking.account_type)})</td></tr>
    <tr><td style="padding:1px 16px 1px 0;color:#6B7484">Account holder</td><td>${esc(banking.account_holder)}</td></tr>
    <tr><td style="padding:1px 16px 1px 0;color:#6B7484">Account number</td><td>${esc(banking.account_number)}</td></tr>
    <tr><td style="padding:1px 16px 1px 0;color:#6B7484">Branch code</td><td>${esc(banking.branch_code)}</td></tr>
    <tr><td style="padding:1px 16px 1px 0;color:#6B7484">Reference</td><td><b>${esc(ref)}</b> &nbsp;<span style="color:#888">← use exactly this</span></td></tr>
  </table>
  <p style="margin:22px 0 6px">${esc(zinger)}</p>
  <p style="color:#6B7484">— The Treasurer</p>
</div>`;

  return { subject, text, html };
}

// ── CONFIRMATION email (auto-sent when a payment is marked paid) ─────────────
function confirmationEmail({ name, paidAmount, newBalance }) {
  const first = firstNameOf(name);
  const subject = 'FPL — payment received';
  const text = `Hi ${first}, your R${paidAmount} has been credited. Outstanding balance: R${newBalance}. Cheers — The Treasurer`;
  const html =
`<div style="font-family:ui-monospace,Menlo,Consolas,monospace;color:#15181E;max-width:520px;line-height:1.6;font-size:14px">
  <p>Hi ${esc(first)},</p>
  <p>Your <b>R${paidAmount}</b> has been credited.</p>
  <p>Outstanding balance: <b>R${newBalance}</b>.</p>
  <p style="color:#6B7484">Cheers — The Treasurer</p>
</div>`;
  return { subject, text, html };
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
  resendSend, reminderEmail, confirmationEmail, sendConfirmation,
  outstandingOf, auditEntry, zingerFor,
  FROM_EMAIL, FROM_NAME, firstNameOf, ordinal,
};
