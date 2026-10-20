import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { auditHistory, findCredentialCategories } from "../scripts/security-history-audit.mjs";

test("credential findings expose categories only, not matched values", () => {
  const secret = "synthetic-secret-for-local-audit";
  assert.deepEqual(findCredentialCategories(secret, [secret]), ["local_credential"]);
  assert.deepEqual(findCredentialCategories("sk_test_replace_me whsec_ci_example GOCSPX-example", ["short"]), []);
  assert.deepEqual(findCredentialCategories("sk_test_" + "x".repeat(24)), ["stripe_secret"]);
  assert.deepEqual(findCredentialCategories("GOCSPX-" + "x".repeat(24)), ["google_secret"]);
  assert.deepEqual(findCredentialCategories("ghp_" + "x".repeat(40)), ["github_token"]);
  assert.deepEqual(findCredentialCategories(["-----BEGIN", "PRIVATE KEY-----"].join(" ")), ["private_key"]);
});

test("history audit detects removed credentials and commit messages without printing contents", () => {
  const root = mkdtempSync(join(tmpdir(), "pulbase-history-test-"));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  const secret = "synthetic-removed-secret-in-history";
  try {
    git("init"); git("config", "user.name", "Audit test"); git("config", "user.email", "audit@example.invalid");
    writeFileSync(join(root, "fixture.txt"), secret);
    git("add", "."); git("commit", "-m", secret);
    writeFileSync(join(root, "fixture.txt"), "removed");
    git("add", "."); git("commit", "-m", "Remove synthetic credential");
    const result = auditHistory(root, [secret]);
    assert.equal(result.scannedCommits, 2);
    assert.equal(result.findings.length, 2);
    assert.ok(result.findings.every(finding => finding.category === "local_credential"));
    assert.equal(JSON.stringify(result).includes(secret), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
