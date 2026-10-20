import { createHmac, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { assertSha } from './policy.mjs';
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
export function oauthHeader(credentials, { nonce = randomBytes(16).toString('hex'), timestamp = Math.floor(Date.now() / 1000).toString() } = {}) {
  const oauth = { oauth_consumer_key: credentials.apiKey, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp, oauth_token: credentials.accessToken, oauth_version: '1.0' };
  if (['apiKey', 'apiSecret', 'accessToken', 'accessSecret'].some(key => typeof credentials[key] !== 'string' || !credentials[key])) throw Error('Missing X user-context credentials');
  const parameters = Object.entries(oauth).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${encode(k)}=${encode(v)}`).join('&');
  const base = `POST&${encode('https://api.x.com/2/tweets')}&${encode(parameters)}`;
  oauth.oauth_signature = createHmac('sha1', `${encode(credentials.apiSecret)}&${encode(credentials.accessSecret)}`).update(base).digest('base64');
  return `OAuth ${Object.entries(oauth).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${encode(k)}="${encode(v)}"`).join(', ')}`;
}
export function announcementText(text) {
  // Conservative 140 Unicode code-point limit also fits Japanese weighted length limits.
  if (typeof text !== 'string' || !text.trim() || Array.from(text).length > 140 || /[\u0000-\u0008\u000B-\u001F]/.test(text)) throw Error('Announcement must be 1–140 Unicode characters');
  return text.trim();
}
export async function announce({ sha, text, state, credentials, confirmed, request = fetch, now = () => new Date().toISOString() }) {
  assertSha(sha); text = announcementText(text);
  if (!confirmed) throw Error('Production regression success is required');
  // Reserve before HTTP. A timeout or state-write failure never causes automatic re-posting.
  const previous = await state.read(sha);
  if (previous?.status === 'sent') return { status: 'already-sent', id: previous.id };
  if (previous) throw Error('Announcement reserved or outcome uncertain; reconcile with X manually');
  const authorization = oauthHeader(credentials);
  await state.reserve(sha, { status: 'pending', sha, reservedAt: now() });
  let id;
  try {
    const response = await request('https://api.x.com/2/tweets', { method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }), signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw Error('X rejected announcement');
    const data = await response.json();
    if (!/^[0-9]+$/.test(data?.data?.id ?? '')) throw Error('Invalid X response');
    id = data.data.id;
  } catch {
    await state.finish(sha, { status: 'uncertain', sha, checkedAt: now() });
    throw Error('X announcement not confirmed; do not retry before manual reconciliation');
  }
  await state.finish(sha, { status: 'sent', sha, id, sentAt: now() });
  return { status: 'sent', id };
}
export function githubState({ repository, token, request = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !token) throw Error('GitHub announcement state configuration missing');
  const branch = 'automation-state';
  const objectShas = new Map();
  async function api(path, options = {}) {
    const response = await request(`https://api.github.com/repos/${repository}/${path}`, {
      ...options, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (response.status === 404 && !options.method) return null;
    if (!response.ok) throw Error('GitHub announcement state request failed');
    return response.json();
  }
  const path = sha => `contents/x-announcements/${assertSha(sha)}.json`;
  async function save(sha, value, update) {
    const previous = objectShas.get(sha);
    if (update && !previous) throw Error('Missing state reservation');
    const result = await api(path(sha), { method: 'PUT', body: JSON.stringify({ branch,
      message: `Record X announcement state for ${sha}`, content: Buffer.from(JSON.stringify(value, null, 2)).toString('base64'),
      ...(update ? { sha: previous } : {}) }) });
    objectShas.set(sha, result.content.sha);
  }
  return {
    async read(sha) {
      const result = await api(`${path(sha)}?ref=${branch}`);
      if (!result) return null;
      objectShas.set(sha, result.sha);
      return JSON.parse(Buffer.from(result.content, 'base64').toString());
    },
    reserve: (sha, value) => save(sha, value, false),
    finish: (sha, value) => save(sha, value, true),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  announce({ sha: process.env.PULBASE_RELEASE_SHA, text: process.env.PULBASE_ANNOUNCEMENT,
    confirmed: process.env.PULBASE_PRODUCTION_REGRESSION_PASSED === 'true',
    credentials: { apiKey: process.env.X_API_KEY, apiSecret: process.env.X_API_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN, accessSecret: process.env.X_ACCESS_TOKEN_SECRET },
    state: githubState({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN }),
  }).then(result => console.log(JSON.stringify(result)))
    .catch(() => { console.error('X announcement stopped; inspect persistent state before retrying.'); process.exitCode = 1; });
}
