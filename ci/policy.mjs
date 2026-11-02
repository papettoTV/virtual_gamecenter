// Trusted control-plane policy. Candidate PRs may not modify this directory.
export const shaPattern = /^[a-f0-9]{40}$/;
export function assertSha(sha) {
  if (!shaPattern.test(sha ?? '')) throw Error('A full commit SHA is required');
  return sha;
}
export function assertIssueNumber(value) {
  if (!/^[1-9][0-9]{0,8}$/.test(String(value))) throw Error('Invalid issue number');
  return Number(value);
}
export function allowedPath(path) {
  if (typeof path !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(path)
    || path.split('/').some(p => !p || p === '.' || p === '..')) return false;
  // Application behavior is editable; deployment/control-plane inputs are not.
  // Check both sides of a rename in assertChanges; never allow instruction files.
  if (/(?:^|\/)(?:AGENTS|SKILL|CLAUDE|GEMINI)\.md$/i.test(path)
    || /(?:^|\/)(?:\.agents|\.codex|\.github)(?:\/|$)/i.test(path)
    || /(?:^|\/)[^/]*\.config\.[^/]+$/i.test(path)) return false;
  if (path.startsWith('apps/web/src/pages/')) return false;
  if (/^apps\/web\/public\/(?:_worker\.js|_routes\.json|_redirects|_headers)(?:\/|$)/i.test(path)) return false;
  return /^apps\/web\/src\/.+\.(?:ts|tsx|js|jsx|mjs|css|json|svg)$/.test(path)
    || /^apps\/web\/tests\/.+\.(?:ts|tsx|js|jsx|mjs|css|json|html|svg)$/.test(path)
    || /^apps\/web\/public\/.+\.(?:js|mjs|css|json|html|svg|txt)$/.test(path)
    || /^apps\/web\/public\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:png|jpg|jpeg)$/.test(path)
    || path === 'apps/web/index.html'
    || /^docs\/.+\.md$/.test(path);
}
export function assertChanges(files) {
  if (!files.length || files.length > 60) throw Error('Expected 1–60 changed files');
  for (const file of files) {
    if (!allowedPath(file.filename) || (file.previous_filename && !allowedPath(file.previous_filename))) {
      throw Error(`Human review required for protected path: ${file.filename}`);
    }
  }
}
export function assertReview(value) {
  if (!value || value.pass !== true || !Array.isArray(value.findings) || value.findings.length) {
    throw Error('Codex review did not pass');
  }
}
export function assertAutomatedPr(pr, { repository, bot }) {
  if (!bot || pr.user?.login !== bot || pr.base?.ref !== 'develop' || pr.state !== 'open' || pr.draft
    || pr.head?.repo?.full_name !== repository || !/^codex\/issue-[1-9][0-9]*$/.test(pr.head?.ref ?? '')) {
    throw Error('Only open, same-repository automation PRs targeting develop are eligible');
  }
  assertSha(pr.head.sha);
  assertSha(pr.base.sha);
}
export function assertProductionApproval({ ref, enabled, sha }) {
  assertSha(sha);
  if (ref !== 'refs/heads/main' || enabled !== 'true') throw Error('Production is disabled or not running from main');
}
