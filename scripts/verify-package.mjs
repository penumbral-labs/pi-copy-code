import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { npmPackFailureMessage, selectNpmInvocation } from "./npm-invocation.mjs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lockfile = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const expectedFiles = [...packageJson.files, "package.json"].sort();
const npmInvocation = selectNpmInvocation({
  platform: process.platform,
  npmExecPath: process.env.npm_execpath,
  nodeExecPath: process.execPath,
  npmRunCommand: "npm run verify-package",
});

assert.equal(lockfile.name, packageJson.name, "package-lock.json name must match package.json");
assert.equal(lockfile.version, packageJson.version, "package-lock.json version must match package.json");
assert.equal(lockfile.packages[""].version, packageJson.version, "lockfile root version must match package.json");
assert.equal(packageJson.dependencies, undefined, "the package must not have runtime dependencies");
assert.equal(packageJson.optionalDependencies, undefined, "the package must not have optional runtime dependencies");
assert.equal(packageJson.scripts?.preinstall, undefined, "preinstall scripts are not allowed");
assert.equal(packageJson.scripts?.install, undefined, "install scripts are not allowed");
assert.equal(packageJson.scripts?.postinstall, undefined, "postinstall scripts are not allowed");

const pack = spawnSync(
  npmInvocation.command,
  [...npmInvocation.prefixArguments, "pack", "--dry-run", "--json", "--ignore-scripts"],
  {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  },
);

if (pack.error || pack.status !== 0) {
  process.stderr.write(npmPackFailureMessage(pack));
  process.exit(pack.status ?? 1);
}

const [manifest] = JSON.parse(pack.stdout);
const actualFiles = manifest.files.map(({ path }) => path).sort();
assert.deepEqual(actualFiles, expectedFiles, "npm tarball contents must match the public allowlist");
assert.deepEqual(manifest.bundled, [], "the package must not bundle dependencies");

console.log(`Verified ${manifest.name}@${manifest.version}: ${actualFiles.join(", ")}`);
