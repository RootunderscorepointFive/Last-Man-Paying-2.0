// POST /api/override-bottom3  { password, gw, payers:[names], reason }
// Sets the definitive payer list for a gameweek (FPL API dispute resolution).
// Managers removed: their active bottom fine for that GW is reversed + the GW
// dropped from bottom_finishes. Managers added: a bottom fine is created + GW
// added to bottom_finishes. Logged to data.overrides for traceability.
const { requireTreasurer } = require('../lib/auth');
const { mutateData } = require('../lib/github');

const GW_FINE = 100; // matches config.gw_fine

module.exports = async (req, res) => {
  const body = requireTreasurer(req, res);
  if (!body) return;
  let { gw, payers, reason } = body;
  gw = Number(gw);
  if (!gw) return res.status(400).json({ error: 'gw required' });
  if (!Array.isArray(payers)) return res.status(400).json({ error: 'payers array required' });
  if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'reason required' });
  const want = new Set(payers);

  try {
    const now = new Date().toISOString();
    await mutateData(`Treasurer: override GW${gw} bottom-3 result`, (data) => {
      data.managers.forEach(m => {
        const has = m.bottom_finishes.includes(gw);
        const should = want.has(m.name);
        if (has && !should) {
          const f = m.fines.find(x => x.type === 'bottom' && x.gw === gw && !x.reversed);
          if (f) { f.reversed = true; f.reversed_reason = `GW${gw} bottom-3 override: ${reason}`; f.reversed_by = 'treasurer'; f.reversed_date = now; }
          m.bottom_finishes = m.bottom_finishes.filter(g => g !== gw);
        } else if (!has && should) {
          m.bottom_finishes.push(gw); m.bottom_finishes.sort((a, b) => a - b);
          m.fines.push({
            id: `f_${m.entry}_ovr${gw}_${Date.now()}`,
            gw, amount: GW_FINE, type: 'bottom', status: 'confirmed',
            reason: `GW${gw} bottom-3 (treasurer override): ${String(reason).trim()}`,
            paid_date: null,
            reversed: false, reversed_reason: null, reversed_by: null, reversed_date: null,
            added_by: 'treasurer-override', added_date: now,
            edited_by: null, edited_date: null, edit_history: [],
          });
        }
      });
      (data.overrides = data.overrides || []).push({ gw, payers: [...want], reason: String(reason).trim(), by: 'treasurer', date: now });
      data.generated_at = now;
      return true;
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('override-bottom3:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
