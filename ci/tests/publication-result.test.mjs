import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { PublicationStopped, publicationFailure, publicationFailureText, validatePublicationResult } from '../publication-result.mjs';

test('valid patches retain the existing schema while empty patches explain an intentional stop', () => {
  const value = { summary: '変更しました', patch: 'diff --git a/docs/a.md b/docs/a.md\n' };
  assert.equal(validatePublicationResult(value), value);
  for (const patch of ['', ' \n']) {
    assert.throws(() => validatePublicationResult({ summary: '保護対象です', patch }), error => error.code === 'no_patch' && error.message.includes('保護対象です'));
  }
});

test('malformed, oversized and binary results remain rejected without echoing their contents', () => {
  for (const value of [null, {}, { summary: 'a'.repeat(4001), patch: 'diff' }, { summary: '説明', patch: 'a'.repeat(90001) },
    { summary: '説明', patch: 'GIT binary patch' }, { summary: 1, patch: 'diff' }, { summary: '説明', patch: null }]) {
    assert.throws(() => validatePublicationResult(value), error => error.code === 'invalid_result');
  }
  const result = publicationFailure(new Error('SECRET_FROM_GIT'));
  assert.equal(result.code, 'publish_failed'); assert.ok(!result.reason.includes('SECRET_FROM_GIT'));
});

test('failure comments display bounded known reasons, not arbitrary JSON or execution details', () => {
  const failure = publicationFailure(new PublicationStopped('no_patch', '保護対象\n人の対応が必要'));
  const text = publicationFailureText(JSON.stringify(failure));
  assert.match(text, /停止区分：`no_patch`/); assert.match(text, /> 保護対象\n> 人の対応が必要/);
  for (const value of [undefined, '', '{}', 'null', '{', JSON.stringify({ code: 'injected', reason: 'bad' }), JSON.stringify({ code: 'no_patch', reason: 'a'.repeat(5001) })]) {
    assert.equal(publicationFailureText(value), '');
  }
});

test('trusted workflow forwards publisher failure output to the separate reporting runner', async () => {
  const workflow = parse(await readFile(new URL('../../.github/workflows/codex-issue.yml', import.meta.url), 'utf8'));
  assert.equal(workflow.jobs.publish.outputs.failure, '${{ steps.publish.outputs.failure }}');
  const publisher = workflow.jobs.publish.steps.find(step => step.id === 'publish');
  assert.ok(publisher); assert.notEqual(publisher['continue-on-error'], true);
  const report = workflow.jobs.failure.steps.at(-1);
  assert.equal(report.env.PUBLICATION_FAILURE, '${{ needs.publish.outputs.failure }}');
  assert.match(report.with.script, /failureJson: process.env.PUBLICATION_FAILURE/);
  assert.ok(!report.with.script.includes('${{'));
});
