// Treasurer auth — constant-time password check, generic 401.
// TREASURER_PASSWORD lives only in the Vercel env; it is never sent to the client.
const crypto = require('crypto');

// Hash both inputs to fixed-length digests before comparing, so the comparison
// time does not depend on the submitted password's length or content (no timing
// or length-based leak). Returns true only on an exact match.
function checkPassword(submitted) {
  const expected = process.env.TREASURER_PASSWORD || '';
  const h = s => crypto.createHash('sha256').update(String(s)).digest();
  const match = crypto.timingSafeEqual(h(submitted || ''), h(expected));
  return expected.length > 0 && match;
}

// Gate a request. On failure it writes the response and returns null, so callers
// do: `const body = requireTreasurer(req,res); if (!body) return;`
function requireTreasurer(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return null;
  }
  const body = req.body || {};
  if (!checkPassword(body.password)) {
    res.status(401).json({ error: 'Unauthorized' }); // generic — no detail, no stack
    return null;
  }
  return body;
}

// The shared password only proves "a treasurer" — every write in the app still
// gets attributed to the literal string 'treasurer', with no way to tell who
// actually did it. The client sends whoever's logged in as `treasurer_name`;
// this just trims it and falls back to the old generic label if it's blank
// (an old cached page, or someone who cleared the field).
function treasurerName(body) {
  const n = String((body && body.treasurer_name) || '').trim();
  return n || 'treasurer';
}

module.exports = { checkPassword, requireTreasurer, treasurerName };
