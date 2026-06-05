// GET /api/health — verify the function runtime + env wiring.
// Reports only whether each secret is SET (booleans) — never the values.
module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'lmp-terminal',
    env: {
      treasurer_password_set: !!process.env.TREASURER_PASSWORD,
      github_token_set: !!process.env.GITHUB_TOKEN,
      resend_key_set: !!process.env.RESEND_API_KEY,
    },
    time: new Date().toISOString(),
  });
};
