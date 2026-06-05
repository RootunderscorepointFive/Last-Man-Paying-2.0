// Read + write data.json in the repo via the GitHub Contents API.
// GITHUB_TOKEN (fine-grained PAT, Contents: read & write on this repo only)
// lives in the Vercel env; never exposed to the client.
const REPO = process.env.GH_REPO || 'RootunderscorepointFive/Last-Man-Paying-2.0';
const BRANCH = process.env.GH_BRANCH || 'main';
const FILE = 'data.json';
const API = `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(FILE)}`;

function ghHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'LMP-Terminal',
  };
}

async function getData() {
  const r = await fetch(`${API}?ref=${BRANCH}`, { headers: ghHeaders() });
  if (!r.ok) throw new Error(`github GET ${r.status}`);
  const j = await r.json();
  return { data: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')), sha: j.sha };
}

async function commitData(data, sha, message) {
  const r = await fetch(API, {
    method: 'PUT',
    headers: ghHeaders(),
    body: JSON.stringify({
      message,
      branch: BRANCH,
      sha,
      content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
      committer: { name: 'lmp-treasurer-bot', email: 'github-actions[bot]@users.noreply.github.com' },
    }),
  });
  if (r.status === 409) { const e = new Error('conflict'); e.conflict = true; throw e; }
  if (!r.ok) throw new Error(`github PUT ${r.status}`);
  return r.json();
}

// Read → mutate(data) (edit in place; return false to abort) → commit.
// Retries on 409 in case the daily sync committed between our read and write.
async function mutateData(message, mutate) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, sha } = await getData();
    if (mutate(data) === false) return { aborted: true };
    try { await commitData(data, sha, message); return { ok: true }; }
    catch (e) { if (e.conflict && attempt < 2) continue; throw e; }
  }
}

module.exports = { getData, commitData, mutateData };
