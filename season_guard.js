// Season-aware guard for the daily sync.
// Between seasons the FPL API keeps serving the *previous* season's final data
// (e.g. 2025/26 GW38). Running the sync then re-applies last season's fines and
// overwrites a clean rollover. This guard compares the API's season (inferred
// from the GW1 deadline year) against config.current_season and tells the
// workflow whether to proceed. Always exits 0; writes proceed=<bool> for the job.

const fs = require('fs');

const API = 'https://fantasy.premierleague.com/api';

// Times out a stalled request and retries transient network/timeout errors so
// the guard can't hang the job; on genuine failure it falls through to proceed.
async function fetchJSON(url, { retries = 2, timeoutMs = 15000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let r;
    try {
      r = await fetch(url, { headers: { 'User-Agent': 'LMP-Terminal/1.0' }, signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      if (attempt >= retries) throw new Error(`${url} -> ${e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e.message}`);
      await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
      continue;
    }
    clearTimeout(timer);
    if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
    return r.json();
  }
}

function emit(proceed) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `proceed=${proceed}\n`);
  console.log(`proceed=${proceed}`);
}

(async () => {
  try {
    const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    // "2026-27" -> 2026 (the calendar year the season kicks off in)
    const configYear = parseInt(String(config.current_season || '').split('-')[0], 10);

    const bootstrap = await fetchJSON(`${API}/bootstrap-static/`);
    const events = bootstrap.events || [];
    const gw1 = events.find(e => e.id === 1) || events[0];
    const apiYear = gw1 && gw1.deadline_time ? new Date(gw1.deadline_time).getUTCFullYear() : null;

    if (Number.isFinite(configYear) && apiYear && apiYear < configYear) {
      console.log(`Sync skipped — API serving previous season data (GW1 deadline ${apiYear}, current_season ${config.current_season}). Waiting for the ${config.current_season} season to start.`);
      return emit(false);
    }
    console.log(`Season check OK — API season ${apiYear ?? '?'} matches current_season ${config.current_season}. Proceeding.`);
    emit(true);
  } catch (e) {
    // Don't block on a transient API hiccup — let sync_fpl.js fail loudly instead.
    console.log(`Season guard could not determine season (${e.message}); proceeding and letting the sync handle it.`);
    emit(true);
  }
})();
