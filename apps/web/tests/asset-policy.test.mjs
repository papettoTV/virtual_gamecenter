import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";

test("published notices preserve current browser dependency licenses and versions", async () => {
  const notices = await readFile(new URL("../public/third-party-notices.html", import.meta.url), "utf8");
  assert.ok(notices.includes('<meta charset="utf-8">'));
  for (const name of ["react", "react-dom", "scheduler", "three"]) {
    const root = new URL(`../node_modules/${name}/`, import.meta.url);
    const metadata = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
    const license = await readFile(new URL("LICENSE", root), "utf8");
    assert.ok(notices.includes(`${name} ${metadata.version}`), `Update the published ${name} version`);
    assert.ok(notices.includes(license.trim()), `Preserve the complete ${name} license`);
  }
});

test("all public MP4 demos match the files checked for absent audio streams", async () => {
  const root = new URL("../public/", import.meta.url);
  const audit = JSON.parse(await readFile(new URL("../config/demo-media-audit.json", import.meta.url), "utf8"));
  const published = (await readdir(root, { recursive: true })).filter(path => path.endsWith(".mp4")).sort();
  assert.deepEqual(audit.files.map(file => file.path).sort(), published, "Review audio tracks of new or removed public demos");
  for (const file of audit.files) {
    assert.equal(file.audioStreams, 0);
    const hash = createHash("sha256").update(await readFile(new URL(file.path, root))).digest("hex");
    assert.equal(hash, file.sha256, `Recheck audio streams and update the audit for ${file.path}`);
  }
});
