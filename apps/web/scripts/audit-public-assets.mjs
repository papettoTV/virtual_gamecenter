import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function inspectGlb(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2
    || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a
    || bytes.readUInt32LE(12) > bytes.length - 20) throw new Error("Invalid GLB header");
  const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"));
  const resources = [...(document.buffers ?? []), ...(document.images ?? [])].flatMap(entry => entry.uri ? [entry.uri] : []);
  return {
    generator: document.asset?.generator ?? null,
    copyright: document.asset?.copyright ?? null,
    externalResources: resources.filter(uri => !uri.startsWith("data:")),
    embeddedDataUris: resources.filter(uri => uri.startsWith("data:")).length,
    imageCount: (document.images ?? []).length,
  };
}

async function inventory(root) {
  if ((await lstat(root)).isSymbolicLink()) throw new Error("Asset symlinks are not audited");
  const files = [];
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error("Asset symlinks are not audited");
      if (stat.isDirectory()) await visit(path);
      else if (stat.isFile()) {
        const bytes = await readFile(path);
        const extension = extname(name).toLowerCase();
        files.push({
          path: relative(root, path).split(sep).join("/"),
          extension,
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          ...(extension === ".glb" ? { glb: inspectGlb(bytes) } : {}),
        });
      } else throw new Error("Asset is not a regular file");
    }
  }
  await visit(root);
  return files;
}

export async function auditPublicAssets(publicRoot, builtRoot) {
  const files = await inventory(publicRoot);
  const extensions = {};
  for (const file of files) {
    extensions[file.extension] ??= { count: 0, bytes: 0 };
    extensions[file.extension].count++;
    extensions[file.extension].bytes += file.bytes;
  }
  const result = { schemaVersion: 1, fileCount: files.length, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), extensions, files };
  if (builtRoot) {
    const built = await inventory(builtRoot);
    const byPath = new Map(built.map(file => [file.path, file]));
    result.build = {
      matched: files.filter(file => byPath.get(file.path)?.sha256 === file.sha256).length,
      missing: files.filter(file => !byPath.has(file.path)).map(file => file.path),
      changed: files.filter(file => file.path !== ".assetsignore" && byPath.has(file.path) && byPath.get(file.path).sha256 !== file.sha256).map(file => file.path),
      configurationChanges: files.filter(file => file.path === ".assetsignore" && byPath.has(file.path) && byPath.get(file.path).sha256 !== file.sha256).map(file => file.path),
      additionalPaths: built.filter(file => !files.some(source => source.path === file.path)).map(file => file.path),
    };
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--built")) throw new Error("Usage: node scripts/audit-public-assets.mjs [--built]");
  const result = await auditPublicAssets(fileURLToPath(new URL("../public/", import.meta.url)),
    process.argv[2] ? fileURLToPath(new URL("../dist/client/", import.meta.url)) : undefined);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.build && (result.build.missing.length || result.build.changed.length)) process.exitCode = 1;
}
