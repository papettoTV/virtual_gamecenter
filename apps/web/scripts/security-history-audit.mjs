import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const patterns = {
  stripe_secret: /\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{20,}/,
  stripe_webhook: /\bwhsec_[A-Za-z0-9]{24,}/,
  google_secret: /\bGOCSPX-[A-Za-z0-9_-]{20,}/,
  github_token: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/,
  private_key: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/,
};

export function findCredentialCategories(text, localSecrets = []) {
  const categories = Object.entries(patterns).filter(([, pattern]) => pattern.test(text)).map(([category]) => category);
  if (localSecrets.some(secret => secret.length >= 12 && text.includes(secret))) categories.push("local_credential");
  return categories;
}

export function auditHistory(root, localSecrets = []) {
  const git = (args, input) => execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], input, maxBuffer: 32 * 1024 * 1024,
  });
  if (git(["rev-parse", "--is-shallow-repository"]).trim() !== "false") throw Error("Full local history required");
  const objects = git(["rev-list", "--objects", "--all"]).split("\n").filter(Boolean).map(line => line.split(" ", 1)[0]);
  const metadata = git(["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], objects.join("\n") + "\n");
  const summary = { scope: "local-all-refs", objects: objects.length, scannedBlobs: 0, scannedCommits: 0, skippedLarge: 0, skippedBinary: 0, findings: [] };
  for (const line of metadata.trim().split("\n")) {
    const [object, type, size] = line.split(" ");
    if (!["blob", "commit"].includes(type)) continue;
    if (Number(size) > 2 * 1024 * 1024) { summary.skippedLarge++; continue; }
    const content = git(["cat-file", type, object]);
    if (content.includes("\0")) { summary.skippedBinary++; continue; }
    if (type === "blob") summary.scannedBlobs++; else summary.scannedCommits++;
    for (const category of findCredentialCategories(content, localSecrets)) summary.findings.push({ object, type, category });
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw Error("No arguments accepted");
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const localFile = fileURLToPath(new URL("../.dev.vars", import.meta.url));
    const local = existsSync(localFile) ? parseEnv(readFileSync(localFile, "utf8")) : {};
    const credentials = Object.entries(local).filter(([key, value]) => /SECRET|TOKEN|PASSWORD|API_KEY/.test(key) && value && !/replace_me|example/i.test(value));
    const result = auditHistory(root, credentials.map(([, value]) => value));
    console.log(JSON.stringify({ ...result, localCredentialsCompared: credentials.filter(([, value]) => value.length >= 12).length, shortLocalCredentialsExcluded: credentials.filter(([, value]) => value.length < 12).length }, null, 2));
    if (result.findings.length) process.exitCode = 1;
  } catch {
    console.error("History audit incomplete; credentials and repository contents suppressed.");
    process.exitCode = 1;
  }
}
