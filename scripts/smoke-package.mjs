import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertMinimumNpmVersion, selectNpmInvocation } from "./npm-invocation.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const pinnedPeerPackages = Object.keys(packageJson.peerDependencies).map((name) => {
  const version = packageJson.devDependencies[name];
  assert.equal(typeof version, "string", `${name} must have a pinned development baseline`);
  return `${name}@${version}`;
});
const jitiModuleUrl = import.meta.resolve("jiti");
const npmInvocation = selectNpmInvocation({
  platform: process.platform,
  npmExecPath: process.env.npm_execpath,
  nodeExecPath: process.execPath,
  npmRunCommand: "npm run smoke-package",
});
const npmArguments = (arguments_) => [...npmInvocation.prefixArguments, ...arguments_];
const npmVersion = execFileSync(npmInvocation.command, npmArguments(["--version"]), { encoding: "utf8" }).trim();
assertMinimumNpmVersion(npmVersion, "11.10.0");
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "pi-copy-code-smoke-"));

try {
  const packOutput = execFileSync(
    npmInvocation.command,
    npmArguments(["pack", "--json", "--ignore-scripts", "--pack-destination", temporaryRoot]),
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  const [{ filename }] = JSON.parse(packOutput);
  const installRoot = path.join(temporaryRoot, "install");
  const harnessRoot = path.join(temporaryRoot, "harness");
  mkdirSync(harnessRoot);

  execFileSync(npmInvocation.command, npmArguments(["init", "--yes"]), {
    cwd: temporaryRoot,
    stdio: "ignore",
  });
  execFileSync(
    npmInvocation.command,
    npmArguments([
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--min-release-age=0",
      "--prefix",
      installRoot,
      path.join(temporaryRoot, filename),
      ...pinnedPeerPackages,
    ]),
    { cwd: temporaryRoot, stdio: "pipe" },
  );
  execFileSync(npmInvocation.command, npmArguments(["init", "--yes"]), {
    cwd: harnessRoot,
    stdio: "ignore",
  });

  const installedPackageRoot = path.join(installRoot, "node_modules", ...packageJson.name.split("/"));
  const extensionPath = path.join(installedPackageRoot, packageJson.pi.extensions[0]);
  assert.equal(existsSync(path.join(installRoot, "node_modules", "jiti")), false, "clean install must omit jiti");
  for (const name of Object.keys(packageJson.peerDependencies)) {
    const installedPackage = JSON.parse(
      readFileSync(path.join(installRoot, "node_modules", ...name.split("/"), "package.json"), "utf8"),
    );
    assert.equal(installedPackage.version, packageJson.devDependencies[name], `${name} must use the pinned baseline`);
  }
  const harness = `
    import assert from "node:assert/strict";
    import { createJiti } from ${JSON.stringify(jitiModuleUrl)};

    const jiti = createJiti(import.meta.url, { moduleCache: false });
    const extension = await jiti.import(${JSON.stringify(extensionPath)});
    const commands = [];
    const shortcuts = [];
    extension.default({
      on() {},
      registerCommand(name) { commands.push(name); },
      registerShortcut(shortcut) { shortcuts.push(shortcut); },
    });
    assert.deepEqual(commands, ["copy-code"]);
    assert.deepEqual(shortcuts, ["ctrl+alt+c", "ctrl+super+c", "alt+c"]);
    console.log("Loaded packed source and verified /copy-code plus three shortcuts");
  `;
  const harnessPath = path.join(harnessRoot, "smoke.mjs");
  writeFileSync(harnessPath, harness);
  const output = execFileSync(process.execPath, [harnessPath], { cwd: harnessRoot, encoding: "utf8" });

  console.log(`${packageJson.name}@${packageJson.version}: ${output.trim()}`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
