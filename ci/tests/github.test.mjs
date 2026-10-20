import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intake, mergePr } from '../github.mjs';
const base = 'a'.repeat(40), head = 'b'.repeat(40), tree = 'c'.repeat(40);
const context = { repo: { owner: 'owner', repo: 'repo' }, actor: 'owner', eventName: 'issues', payload: { action: 'opened', issue: { number: 1 }, pull_request: { number: 2 } } };
test('public issue author cannot invoke Codex until maintainer explicitly labels it', async () => {
  let branchReads = 0;
  const github = { rest: { repos: { getCollaboratorPermissionLevel: async ({ username }) => ({ data: { permission: username === 'owner' ? 'admin' : 'read' } }),
    getBranch: async () => { branchReads++; return { data: { commit: { sha: base } } }; } }, issues: { get: async () => ({ data: { state: 'open', user: { login: 'outsider' }, title: 'Issue' } }) }, pulls: { list: async () => ({ data: [] }) } } };
  const outputs = {};
  const core = { setOutput: (key, value) => { outputs[key] = value; } };
  await assert.rejects(intake({ github, context, core }), /Maintainer/); assert.equal(branchReads, 0);
  await intake({ github, context: { ...context, payload: { ...context.payload, action: 'labeled', label: { name: 'codex:run' } } }, core });
  assert.equal(outputs.base, base);
});
test('merge refuses stale base/head or failed CI before any merge mutation', async () => {
  process.env.AUTOMATION_BOT = 'app[bot]';
  let merges = 0;
  const pr = { user: { login: 'app[bot]' }, state: 'open', draft: false, base: { ref: 'develop', sha: base },
    head: { ref: 'codex/issue-1', sha: head, repo: { full_name: 'owner/repo' } } };
  const github = { rest: { repos: { getBranchProtection: async () => ({ data: { required_status_checks: { strict: true, contexts: ['verify', 'Automation control checks'] } } }) }, pulls: { get: async () => ({ data: pr }), merge: async () => { merges++; } }, checks: { listForRef() {} } }, paginate: async () => [{ name: 'verify', app: { slug: 'github-actions' }, conclusion: 'failure' }] };
  await assert.rejects(mergePr({ github, context, head, base: 'd'.repeat(40), verifiedTree: tree, expectedCheck: 'verify' }), /changed after/);
  await assert.rejects(mergePr({ github, context, head, base, verifiedTree: tree, expectedCheck: 'verify' }), /not passed/);
  github.rest.repos.getBranchProtection = async () => ({ data: {} });
  await assert.rejects(mergePr({ github, context, head, base, verifiedTree: tree, expectedCheck: 'verify' }), /Strict develop protection/);
  assert.equal(merges, 0);
});
