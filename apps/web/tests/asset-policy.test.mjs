import { readFile, readdir, mkdtemp, mkdir, writeFile, rm, symlink, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditPublicAssets, inspectGlb } from "../scripts/audit-public-assets.mjs";
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
  const archive = new URL("../../../assets/archive/site-public/", import.meta.url);
  const archived = JSON.parse(await readFile(new URL("manifest.json", archive), "utf8")).files;
  const published = (await readdir(root, { recursive: true })).filter(path => path.endsWith(".mp4")).sort();
  assert.deepEqual(audit.files.filter(file => !archived.some(entry => entry.path === file.path)).map(file => file.path).sort(), published, "Review audio tracks of new or removed public demos");
  for (const file of audit.files) {
    assert.equal(file.audioStreams, 0);
    const fileRoot = archived.some(entry => entry.path === file.path) ? archive : root;
    const hash = createHash("sha256").update(await readFile(new URL(file.path, fileRoot))).digest("hex");
    assert.equal(hash, file.sha256, `Recheck audio streams and update the audit for ${file.path}`);
  }
});

test("approved eight originals remain byte-identical in the non-public archive only", async () => {
  const archive = new URL("../../../assets/archive/site-public/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", archive), "utf8"));
  const before = JSON.parse(await readFile(new URL("../../../docs/public-asset-audit-2026-11-03.json", import.meta.url), "utf8"));
  assert.equal(manifest.files.length, 8);
  assert.equal(new Set(manifest.files.map(file => file.path)).size, 8);
  assert.equal(manifest.files.reduce((total, file) => total + file.bytes, 0), 26979762);
  for (const file of manifest.files) {
    const original = before.files.find(entry => entry.path === file.path);
    assert.ok(original, file.path);
    assert.equal(file.sha256, original.sha256);
    assert.equal(file.bytes, original.bytes);
    const bytes = await readFile(new URL(file.path, archive));
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
    await assert.rejects(access(new URL(file.path, new URL("../public/", import.meta.url))), { code: "ENOENT" });
  }
  const publicFiles = await readdir(new URL("../public/", import.meta.url), { recursive: true });
  assert.equal(publicFiles.filter(path => path.endsWith(".blend")).length, 0);
});

test("asset inventory includes unreferenced originals and compares build bytes without modifying them", async () => {
  const root = await mkdtemp(join(tmpdir(), "pulbase-assets-"));
  try {
    const source = join(root, "public"), built = join(root, "built");
    await mkdir(source); await mkdir(built);
    await writeFile(join(source, "original.blend"), "original");
    await writeFile(join(source, "unused.svg"), "<svg/>");
    await writeFile(join(source, "missing.png"), "missing");
    await writeFile(join(source, ".assetsignore"), "_worker.js");
    await writeFile(join(built, "original.blend"), "original");
    await writeFile(join(built, "unused.svg"), "changed");
    await writeFile(join(built, "bundle.js"), "generated");
    await writeFile(join(built, ".assetsignore"), "_worker.js\n.dev.vars");
    const report = await auditPublicAssets(source, built);
    assert.equal(report.fileCount, 4);
    assert.equal(report.extensions[".blend"].count, 1);
    assert.deepEqual(report.build, { matched: 1, missing: ["missing.png"], changed: ["unused.svg"], configurationChanges: [".assetsignore"], additionalPaths: ["bundle.js"] });
    assert.equal(await readFile(join(source, "unused.svg"), "utf8"), "<svg/>");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("asset inventory refuses symlinks instead of following files outside the audited directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "pulbase-assets-"));
  try {
    await writeFile(join(root, "source.svg"), "<svg/>");
    await symlink(join(root, "source.svg"), join(root, "link.svg"));
    await assert.rejects(auditPublicAssets(root), /symlinks/);
    await symlink(root, join(root, "root-link"));
    await assert.rejects(auditPublicAssets(join(root, "root-link")), /symlinks/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("GLB inspection distinguishes embedded and external resources and rejects broken headers", () => {
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0", generator: "fixture" }, buffers: [{ uri: "data:application/octet-stream;base64,AA==" }], images: [{ uri: "texture.png" }] }));
  const bytes = Buffer.alloc(20 + json.length);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(json.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20);
  assert.deepEqual(inspectGlb(bytes), { generator: "fixture", copyright: null, externalResources: ["texture.png"], embeddedDataUris: 1, imageCount: 1 });
  assert.throws(() => inspectGlb(Buffer.from("broken")), /Invalid GLB/);
});
