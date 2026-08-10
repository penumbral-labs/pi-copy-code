import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const extension = await jiti.import("../extensions/copy-code/index.ts");

const windowsOnly = { skip: process.platform !== "win32" };

test("Windows cmd editor shim preserves spaces and metacharacters", windowsOnly, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi copy &(caret^)-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const shim = path.join(root, "editor shim &(caret^).cmd");
  const recorder = path.join(root, "record args &(caret^).mjs");
  const recorded = path.join(root, "received args.json");
  const editorArguments = ["space value", "ampersand&value", "parentheses(value)", "caret^value"];

  fs.writeFileSync(
    recorder,
    [
      'import fs from "node:fs";',
      `const recorded = ${JSON.stringify(recorded)};`,
      "const args = process.argv.slice(2);",
      "const file = args.pop();",
      "fs.writeFileSync(recorded, JSON.stringify({ args, file }));",
      'fs.writeFileSync(file, "edited\\r\\n");',
    ].join("\n"),
  );
  fs.writeFileSync(
    shim,
    ["@echo off", '"%~1" "%~2" "%~3" "%~4" "%~5" "%~6" "%~7"', "exit /b %errorlevel%"].join("\r\n"),
  );

  const editorCommand = [shim, process.execPath, recorder, ...editorArguments]
    .map((argument) => `"${argument}"`)
    .join(" ");
  const results = [];
  const component = new extension.ExternalEditorComponent(
    "original",
    { stop() {}, start() {}, requestRender() {} },
    (result) => results.push(result),
    { editorCommand, tempRoot: root },
  );

  component.render(80);
  await waitUntil(() => results.length === 1);

  const received = JSON.parse(fs.readFileSync(recorded, "utf8"));
  assert.deepEqual(received.args, editorArguments);
  assert.equal(path.basename(received.file), "code.txt");
  assert.equal(path.dirname(path.dirname(received.file)), root);
  assert.deepEqual(results, [{ code: "edited" }]);
});

async function waitUntil(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for editor result");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
