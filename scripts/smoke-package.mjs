import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const jitiModuleUrl = import.meta.resolve("jiti");
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "pi-copy-code-smoke-"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  const packOutput = execFileSync(
    npmCommand,
    ["pack", "--json", "--ignore-scripts", "--pack-destination", temporaryRoot],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  const [{ filename }] = JSON.parse(packOutput);
  const installRoot = path.join(temporaryRoot, "install");
  const harnessRoot = path.join(temporaryRoot, "harness");
  mkdirSync(harnessRoot);

  execFileSync(npmCommand, ["init", "--yes"], { cwd: temporaryRoot, stdio: "ignore" });
  execFileSync(
    npmCommand,
    ["install", "--ignore-scripts", "--omit=dev", "--prefix", installRoot, path.join(temporaryRoot, filename)],
    { cwd: temporaryRoot, stdio: "pipe" },
  );
  execFileSync(npmCommand, ["init", "--yes"], { cwd: harnessRoot, stdio: "ignore" });

  const installedPackageRoot = path.join(installRoot, "node_modules", ...packageJson.name.split("/"));
  const extensionPath = path.join(installedPackageRoot, packageJson.pi.extensions[0]);
  assert.equal(existsSync(path.join(installRoot, "node_modules", "jiti")), false, "clean install must omit jiti");
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
