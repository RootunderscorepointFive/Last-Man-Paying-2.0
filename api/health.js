// GET /api/health — verify the function runtime + env wiring.
// Reports only whether each secret is SET (booleans) — never the values.
module.exports = (req, res) => {
  const fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';
  res.status(200).json({
    ok: true,
    service: 'lmp-terminal',
    env: {
      treasurer_password_set: !!process.env.TREASURER_PASSWORD,
      github_token_set: !!process.env.GITHUB_TOKEN,
      resend_key_set: !!process.env.RESEND_API_KEY,
      manager_emails_set: !!process.env.MANAGER_EMAILS,
    },
    email: {
      from_email: fromEmail,
      from_name: process.env.FROM_NAME || 'LMP Treasurer',
      reply_to: process.env.REPLY_TO_EMAIL || null,
      sandbox: /@resend\.dev$/.test(fromEmail),
    },
    time: new Date().toISOString(),
  });
};
