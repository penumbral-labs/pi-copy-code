import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lockfile = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const expectedFiles = ["LICENSE", "README.md", "extensions/copy-code/index.ts", "package.json"];
if (packageJson.files.includes("CHANGELOG.md") && existsSync(new URL("../CHANGELOG.md", import.meta.url))) {
  expectedFiles.splice(1, 0, "CHANGELOG.md");
}

assert.equal(lockfile.name, packageJson.name, "package-lock.json name must match package.json");
assert.equal(lockfile.version, packageJson.version, "package-lock.json version must match package.json");
assert.equal(lockfile.packages[""].version, packageJson.version, "lockfile root version must match package.json");
assert.equal(packageJson.dependencies, undefined, "the package must not have runtime dependencies");
assert.equal(packageJson.scripts?.preinstall, undefined, "preinstall scripts are not allowed");
assert.equal(packageJson.scripts?.install, undefined, "install scripts are not allowed");
assert.equal(packageJson.scripts?.postinstall, undefined, "postinstall scripts are not allowed");

const pack = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8",
});

if (pack.status !== 0) {
  process.stderr.write(pack.stderr);
  process.exit(pack.status ?? 1);
}

const [manifest] = JSON.parse(pack.stdout);
const actualFiles = manifest.files.map(({ path }) => path).sort();
assert.deepEqual(actualFiles, expectedFiles, "npm tarball contents must match the public allowlist");
assert.deepEqual(manifest.bundled, [], "the package must not bundle dependencies");

console.log(`Verified ${manifest.name}@${manifest.version}: ${actualFiles.join(", ")}`);
