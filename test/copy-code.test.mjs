import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const extension = await jiti.import("../extensions/copy-code/index.ts");

test("extractCodeBlocks preserves whitespace and language", () => {
  const markdown = [
    "Before",
    "",
    "```yaml",
    "apiVersion: v1",
    "metadata:",
    "  name: test",
    "```",
    "",
    "~~~python",
    "def hello():",
    "    return \"world\"",
    "~~~",
    "",
  ].join("\n");

  const blocks = extension.extractCodeBlocks(markdown);

  assert.deepEqual(blocks, [
    {
      index: 1,
      lang: "yaml",
      code: "apiVersion: v1\nmetadata:\n  name: test",
    },
    {
      index: 2,
      lang: "python",
      code: "def hello():\n    return \"world\"",
    },
  ]);
});

test("extractCodeBlocks strips structural indentation from sibling backtick and tilde fences", () => {
  const markdown = [
    "  ```ts",
    "  const top = true;",
    "    const nested = true;",
    " x",
    "",
    " \t",
    "     ```",
    "\t~~~sh",
    "\techo tab",
    "  echo spaces",
    "~~~",
  ].join("\n");

  assert.deepEqual(extension.extractCodeBlocks(markdown), [
    { index: 1, lang: "ts", code: "const top = true;\n  const nested = true;\nx\n\n \t" },
    { index: 2, lang: "sh", code: "echo tab\n echo spaces" },
  ]);
});

test("createCopyChoices adds an All option for multiple blocks", () => {
  const blocks = [
    { index: 1, lang: "bash", code: "echo one" },
    { index: 2, lang: "python", code: "print('two')" },
  ];

  const choices = extension.createCopyChoices(blocks);

  assert.equal(choices.length, 3);
  assert.equal(choices[0].label, "All code blocks (2 blocks)");
  assert.equal(choices[0].code, "echo one\n\nprint('two')");
  assert.match(choices[1].label, /^1\. bash/);
  assert.match(choices[2].label, /^2\. python/);
});

test("wrapIndex loops around both directions", () => {
  assert.equal(extension.wrapIndex(0, -1, 8), 7);
  assert.equal(extension.wrapIndex(7, 1, 8), 0);
  assert.equal(extension.wrapIndex(3, 1, 8), 4);
  assert.equal(extension.wrapIndex(3, -1, 8), 2);
  assert.equal(extension.wrapIndex(0, -1, 0), 0);
});

test("filterCopyChoices preserves original order for empty query", () => {
  const choices = extension.createCopyChoices([
    { index: 1, lang: "bash", code: "echo one" },
    { index: 2, lang: "python", code: "print('two')" },
  ]);

  const filtered = extension.filterCopyChoices(choices, "");
  assert.deepEqual(filtered, choices);
});

test("filterCopyChoices fuzzy-searches code content case-insensitively", () => {
  const choices = extension.createCopyChoices([
    { index: 1, lang: "bash", code: "echo one" },
    { index: 2, lang: "python", code: "print('two')" },
  ]);

  const filtered = extension.filterCopyChoices(choices, "PRINT TWO");
  assert.equal(filtered.length, 1);
  assert.match(filtered[0].label, /^2\. python/);
});

test("fuzzyScore returns non-negative for distant valid matches", () => {
  assert.ok(extension.fuzzyScore(`${"a".repeat(80)}z`, "z") >= 0);
  assert.equal(extension.fuzzyScore("hello", "z"), -1);
});

test("filterCopyChoices finds distant code content matches", () => {
  const choices = extension.createCopyChoices([
    { index: 1, lang: "text", code: `${"a".repeat(80)}z` },
  ]);

  const filtered = extension.filterCopyChoices(choices, "z");

  assert.equal(filtered.length, 1);
  assert.match(filtered[0].label, /^1\. text/);
});

test("filterCopyChoices does not let the aggregate option steal code searches", () => {
  const choices = extension.createCopyChoices([
    { index: 1, lang: "bash", code: "echo one" },
    { index: 2, lang: "python", code: "print('two')" },
  ]);

  assert.equal(choices[0].label, "All code blocks (2 blocks)");

  const filtered = extension.filterCopyChoices(choices, "print");
  assert.equal(filtered.length, 1);
  assert.match(filtered[0].label, /^2\. python/);
});

function assistantEntry(text) {
  return { type: "message", message: { role: "assistant", content: [{ type: "text", text }] } };
}

function userEntry(text) {
  return { type: "message", message: { role: "user", content: [{ type: "text", text }] } };
}

test("extractMessageBlocks returns chronological ordinals for code messages", () => {
  const entries = [
    assistantEntry("first\n```bash\necho one\n```"),
    userEntry("a question"),
    assistantEntry("second\n```python\nprint('two')\n```"),
  ];

  const messages = extension.extractMessageBlocks(entries);

  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map((m) => m.ordinal), [1, 2]);
  assert.equal(messages[0].blocks[0].code, "echo one");
  // Newest surfaced message is last.
  assert.equal(messages.at(-1).blocks[0].code, "print('two')");
});

test("extractMessageBlocks skips assistant messages without code blocks", () => {
  const entries = [
    assistantEntry("just prose, no fences"),
    assistantEntry("```bash\necho hi\n```"),
  ];

  const messages = extension.extractMessageBlocks(entries);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].ordinal, 1);
  assert.equal(messages[0].blocks[0].code, "echo hi");
});

test("extractMessageBlocks caps at the most recent messages and relabels ordinals", () => {
  const entries = Array.from({ length: 15 }, (_, i) =>
    assistantEntry(`msg ${i}\n\`\`\`bash\necho ${i}\n\`\`\``),
  );

  const messages = extension.extractMessageBlocks(entries, 10);

  assert.equal(messages.length, 10);
  // Ordinals restart at 1 after the cap slice; newest message wins the last slot.
  assert.deepEqual(messages.map((m) => m.ordinal), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(messages[0].blocks[0].code, "echo 5");
  assert.equal(messages.at(-1).blocks[0].code, "echo 14");
});

test("extractMessageBlocks tolerates non-array and empty input", () => {
  assert.deepEqual(extension.extractMessageBlocks([]), []);
  assert.deepEqual(extension.extractMessageBlocks([userEntry("hi")]), []);
});

test("responseTabLabels label newest as Current, older as Prev N (display order)", () => {
  assert.deepEqual(extension.responseTabLabels(1), ["Current"]);
  assert.deepEqual(extension.responseTabLabels(3), ["Current", "Prev 1", "Prev 2"]);
});

test("tabWindow shows every tab when they all fit", () => {
  const win = extension.tabWindow([10, 10, 10], 2, 100);
  assert.deepEqual(win, { start: 0, end: 3, leftMore: false, rightMore: false });
});

test("tabWindow keeps the active tail tab visible and scrolls older ones off", () => {
  // 6 tabs of width 12 (+ separators) cannot fit in 30 cols; active is newest (5).
  const widths = Array.from({ length: 6 }, () => 12);
  const win = extension.tabWindow(widths, 5, 30);

  assert.ok(win.start <= 5 && win.end === 6, "active tail tab stays in window");
  assert.equal(win.leftMore, true, "older tabs are off-screen to the left");
  assert.equal(win.rightMore, false, "newest is already the rightmost");
});

test("tabWindow keeps a mid-list active tab within the window", () => {
  const widths = Array.from({ length: 8 }, () => 12);
  const win = extension.tabWindow(widths, 3, 30);

  assert.ok(win.start <= 3 && 3 < win.end, "active index is inside [start, end)");
  assert.ok(win.end - win.start >= 1);
});

test("tabWindow handles a single tab", () => {
  const win = extension.tabWindow([12], 0, 30);
  assert.deepEqual(win, { start: 0, end: 1, leftMore: false, rightMore: false });
});

test("splitEditorCommand preserves quoted editor commands", () => {
  assert.deepEqual(extension.splitEditorCommand('"/Applications/MacVim.app/Contents/bin/mvim" --wait'), [
    "/Applications/MacVim.app/Contents/bin/mvim",
    "--wait",
  ]);
  assert.deepEqual(extension.splitEditorCommand('nvim --cmd "set background=dark"'), [
    "nvim",
    "--cmd",
    "set background=dark",
  ]);
  assert.deepEqual(extension.splitEditorCommand('"C:\\Program Files\\Neovim\\bin\\nvim.exe"'), [
    "C:\\Program Files\\Neovim\\bin\\nvim.exe",
  ]);
});

test("buildEditorSpawn uses direct argv on POSIX and for native Windows executables", () => {
  assert.deepEqual(
    extension.buildEditorSpawn('nvim --cmd "set background=dark"', "/tmp/code & notes.txt", "linux"),
    { command: "nvim", args: ["--cmd", "set background=dark", "/tmp/code & notes.txt"], options: {} },
  );
  assert.deepEqual(
    extension.buildEditorSpawn('"C:\\Tools\\edit.exe" --wait', "C:\\Temp\\code & notes.txt", "win32"),
    {
      command: "C:\\Tools\\edit.exe",
      args: ["--wait", "C:\\Temp\\code & notes.txt"],
      options: {},
    },
  );
  assert.deepEqual(
    extension.buildEditorSpawn('"C:\\Tools\\edit.com"', "C:\\Temp\\code.txt", "win32"),
    { command: "C:\\Tools\\edit.com", args: ["C:\\Temp\\code.txt"], options: {} },
  );
});

test("buildEditorSpawn safely wraps Windows shims and extension-less commands in one cmd command string", () => {
  assert.deepEqual(
    extension.buildEditorSpawn(
      '"C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd" --wait --reuse-window',
      "C:\\Temp Files\\code & notes (1) ^ done.txt",
      "win32",
      "C:\\Windows\\System32\\cmd.exe",
    ),
    {
      command: "C:\\Windows\\System32\\cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        '"C:\\Program^ Files\\Microsoft^ VS^ Code\\bin\\code.cmd ^"--wait^" ^"--reuse-window^" ^"C:\\Temp^ Files\\code^ ^&^ notes^ ^(1^)^ ^^^ done.txt^""',
      ],
      options: { windowsVerbatimArguments: true },
    },
  );
  assert.deepEqual(
    extension.buildEditorSpawn("code --wait", "C:\\Temp\\code.txt", "win32"),
    {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", '"code ^"--wait^" ^"C:\\Temp\\code.txt^""'],
      options: { windowsVerbatimArguments: true },
    },
  );
  assert.deepEqual(
    extension.buildEditorSpawn("nvim", "C:\\Temp\\code.txt", "win32"),
    {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", '"nvim ^"C:\\Temp\\code.txt^""'],
      options: { windowsVerbatimArguments: true },
    },
  );
});

test("resolveEditorCommand falls through an empty VISUAL while injected commands retain precedence", () => {
  assert.equal(extension.resolveEditorCommand(undefined, { VISUAL: "", EDITOR: "nvim" }), "nvim");
  assert.equal(extension.resolveEditorCommand("code --wait", { VISUAL: "vim", EDITOR: "nvim" }), "code --wait");
  assert.equal(extension.resolveEditorCommand("", { VISUAL: "vim", EDITOR: "nvim" }), "");
});

test("picker Ctrl+C cancels both normal and search modes", () => {
  for (const enterSearch of [false, true]) {
    const results = [];
    const picker = new extension.CodeBlockPickerComponent(
      [{ ordinal: 1, blocks: [{ index: 1, lang: "js", code: "one" }, { index: 2, lang: "js", code: "two" }] }],
      {},
      {},
      { requestRender() {} },
      "copy",
      (result) => results.push(result),
    );
    if (enterSearch) picker.handleInput("/");
    picker.handleInput("\x03");
    assert.deepEqual(results, [undefined]);
  }
});

test("external editor uses private storage, edits, and cleans up without following a predictable symlink", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-copy-code-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const victim = path.join(root, "victim.txt");
  const predictable = path.join(root, "pi-copy-code.txt");
  const editorScript = path.join(root, "editor.mjs");
  fs.writeFileSync(victim, "do not overwrite");
  fs.symlinkSync(victim, predictable);
  fs.writeFileSync(editorScript, "import fs from 'node:fs'; fs.appendFileSync(process.argv.at(-1), '\\nedited\\n');");
  const tuiCalls = [];
  const results = [];
  const component = new extension.ExternalEditorComponent(
    "original",
    {
      stop() { tuiCalls.push("stop"); },
      start() { tuiCalls.push("start"); },
      requestRender(full) { tuiCalls.push(["render", full]); },
    },
    (result) => results.push(result),
    { editorCommand: `"${process.execPath}" "${editorScript}"`, tempRoot: root },
  );

  component.render(80);
  await waitUntil(() => results.length === 1);

  assert.deepEqual(results, [{ code: "original\nedited" }]);
  assert.deepEqual(tuiCalls, ["stop", "start", ["render", true]]);
  assert.equal(fs.readFileSync(victim, "utf8"), "do not overwrite");
  assert.deepEqual(fs.readdirSync(root).sort(), ["editor.mjs", "pi-copy-code.txt", "victim.txt"]);
});

test("external editor removes a final CRLF from edited code", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-copy-code-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const editorScript = path.join(root, "editor.mjs");
  fs.writeFileSync(editorScript, "import fs from 'node:fs'; fs.writeFileSync(process.argv.at(-1), 'edited\\r\\n');");
  const results = [];
  const component = new extension.ExternalEditorComponent(
    "original",
    { stop() {}, start() {}, requestRender() {} },
    (result) => results.push(result),
    { editorCommand: `"${process.execPath}" "${editorScript}"`, tempRoot: root },
  );

  component.render(80);
  await waitUntil(() => results.length === 1);

  assert.deepEqual(results, [{ code: "edited" }]);
});

test("external editor spawn failure completes once, restores the TUI, and cleans up", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-copy-code-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tuiCalls = [];
  const results = [];
  const component = new extension.ExternalEditorComponent(
    "original",
    {
      stop() { tuiCalls.push("stop"); },
      start() { tuiCalls.push("start"); },
      requestRender(full) { tuiCalls.push(["render", full]); },
    },
    (result) => results.push(result),
    { editorCommand: path.join(root, "missing-editor"), tempRoot: root },
  );

  component.render(80);
  await waitUntil(() => results.length === 1);

  assert.equal(results.length, 1);
  assert.match(results[0].error, /^Unable to start editor:/);
  assert.deepEqual(tuiCalls, ["stop", "start", ["render", true]]);
  assert.deepEqual(fs.readdirSync(root), []);
});

test("external editor reports a missing editor without stopping the TUI", async () => {
  const results = [];
  const component = new extension.ExternalEditorComponent(
    "original",
    { stop() { throw new Error("must not stop"); } },
    (result) => results.push(result),
    { editorCommand: "" },
  );

  component.render(80);
  await waitUntil(() => results.length === 1);

  assert.deepEqual(results, [{ error: "No external editor configured. Set $VISUAL or $EDITOR." }]);
});

test("external editor reports a nonzero editor status and restores the TUI", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-copy-code-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const editorScript = path.join(root, "editor.mjs");
  fs.writeFileSync(editorScript, "process.exit(7);");
  const tuiCalls = [];
  const results = [];
  const component = new extension.ExternalEditorComponent(
    "original",
    {
      stop() { tuiCalls.push("stop"); },
      start() { tuiCalls.push("start"); },
      requestRender(full) { tuiCalls.push(["render", full]); },
    },
    (result) => results.push(result),
    { editorCommand: `"${process.execPath}" "${editorScript}"`, tempRoot: root },
  );

  component.render(80);
  await waitUntil(() => results.length === 1);

  assert.deepEqual(results, [{ error: "Editor exited with status 7" }]);
  assert.deepEqual(tuiCalls, ["stop", "start", ["render", true]]);
});

test("external editor preserves edited code when temporary cleanup fails", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-copy-code-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const editorScript = path.join(root, "editor.mjs");
  fs.writeFileSync(editorScript, "// leave the file unchanged\n");
  const results = [];
  const component = new extension.ExternalEditorComponent(
    "original",
    { stop() {}, start() {}, requestRender() {} },
    (result) => results.push(result),
    {
      editorCommand: `"${process.execPath}" "${editorScript}"`,
      tempRoot: root,
      removeTemp() { throw new Error("cleanup denied"); },
    },
  );

  component.render(80);
  await waitUntil(() => results.length === 1);

  assert.deepEqual(results, [{ code: "original", warnings: ["Unable to remove editor files: cleanup denied"] }]);
});

test("external editor preserves edited code when TUI restoration fails", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-copy-code-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const editorScript = path.join(root, "editor.mjs");
  fs.writeFileSync(editorScript, "// leave the file unchanged\n");
  const results = [];
  const component = new extension.ExternalEditorComponent(
    "original",
    {
      stop() {},
      start() { throw new Error("terminal unavailable"); },
      requestRender() { throw new Error("must not render after failed start"); },
    },
    (result) => results.push(result),
    { editorCommand: `"${process.execPath}" "${editorScript}"`, tempRoot: root },
  );

  component.render(80);
  await waitUntil(() => results.length === 1);

  assert.deepEqual(results, [{ code: "original", warnings: ["Unable to restore terminal UI: terminal unavailable"] }]);
  assert.deepEqual(fs.readdirSync(root), ["editor.mjs"]);
});

test("external editor setup failure completes once without restarting the TUI", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-copy-code-test-"));
  fs.rmSync(root, { recursive: true });
  const tuiCalls = [];
  const results = [];
  const component = new extension.ExternalEditorComponent(
    "original",
    {
      stop() { tuiCalls.push("stop"); },
      start() { tuiCalls.push("start"); },
      requestRender(full) { tuiCalls.push(["render", full]); },
    },
    (result) => results.push(result),
    { editorCommand: "nvim", tempRoot: root },
  );

  component.render(80);
  component.render(80);
  await waitUntil(() => results.length === 1);

  assert.equal(results.length, 1);
  assert.match(results[0].error, /^Unable to prepare editor file:/);
  assert.deepEqual(tuiCalls, []);
});

test("external editor Ctrl+C cancels exactly once before process handoff", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-copy-code-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const results = [];
  const component = new extension.ExternalEditorComponent(
    "original",
    { stop() {}, start() {}, requestRender() {} },
    (result) => results.push(result),
    { editorCommand: "nvim", tempRoot: root },
  );

  component.render(80);
  component.handleInput("\x03");
  component.handleInput("\x03");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(results, [undefined]);
  assert.deepEqual(fs.readdirSync(root), []);
});

test("edit errors preserve cleanup warnings before reporting failure", async () => {
  const harness = registerForClipboardTests({ nativeCommand: "pbcopy" });
  const context = createClipboardContext(harness);
  context.ui.custom = () =>
    Promise.resolve({
      error: "Editor exited with status 7",
      warnings: ["Unable to remove editor files: cleanup denied"],
    });

  await harness.commands[0].options.handler("edit", context);

  assert.deepEqual(harness.notifications, [
    { message: "Copy warning: Unable to remove editor files: cleanup denied", type: "warning" },
    { message: "Copy failed: Editor exited with status 7", type: "error" },
  ]);
});

test("native and OSC 52 clipboard outcomes have accurate messages and rendering", async () => {
  const native = registerForClipboardTests({ nativeCommand: "pbcopy" });
  await native.commands[0].options.handler("", createClipboardContext(native));
  assert.deepEqual(native.notifications, [{ message: "Copied 1 line via pbcopy", type: "info" }]);

  const osc52 = registerForClipboardTests({ nativeCommand: null, isTTY: true });
  await osc52.commands[0].options.handler("", createClipboardContext(osc52));
  assert.deepEqual(osc52.notifications, [
    { message: "Sent 1 line to terminal clipboard via OSC 52 (best effort)", type: "info" },
  ]);
  assert.deepEqual(osc52.renderCalls, [true]);
  assert.match(osc52.writes.join(""), /^\x1b\]52;c;/);
});

test("production OSC 52 render path forces a real TUI render without awaiting the overlay", async () => {
  const harness = registerForClipboardTests({ nativeCommand: null, isTTY: true, useProductionRender: true });
  const context = createClipboardContext(harness);
  context.ui.custom = (factory, options) => {
    assert.deepEqual(options, { overlay: true });
    factory(
      { requestRender(force) { harness.renderCalls.push(force); } },
      {},
      {},
      () => harness.doneCalls.push(true),
    );
    return new Promise(() => {});
  };

  await Promise.race([
    harness.commands[0].options.handler("", context),
    new Promise((_, reject) => setTimeout(() => reject(new Error("copy command hung on render overlay")), 100)),
  ]);

  assert.deepEqual(harness.renderCalls, [true]);
  assert.deepEqual(harness.doneCalls, [true]);
  assert.deepEqual(harness.notifications, [
    { message: "Sent 1 line to terminal clipboard via OSC 52 (best effort)", type: "info" },
  ]);
});

test("OSC 52 render failure does not invert a successful clipboard send", async () => {
  const harness = registerForClipboardTests({ nativeCommand: null, isTTY: true, useProductionRender: true });
  const context = createClipboardContext(harness);
  context.ui.custom = (factory) => {
    factory({ requestRender() { throw new Error("render failed"); } }, {}, {}, () => {});
    return Promise.reject(new Error("overlay failed"));
  };

  await harness.commands[0].options.handler("", context);

  assert.equal(harness.writes.length, 1);
  assert.deepEqual(harness.notifications, [
    { message: "Sent 1 line to terminal clipboard via OSC 52 (best effort)", type: "info" },
  ]);
});

test("OSC 52 rejects oversized TTY payloads without writing", async () => {
  const harness = registerForClipboardTests({ nativeCommand: null, isTTY: true });
  const context = createClipboardContext(harness);
  context.sessionManager.getEntries = () => [assistantEntry(`\`\`\`text\n${"x".repeat(75_001)}\n\`\`\``)];

  await harness.commands[0].options.handler("", context);

  assert.deepEqual(harness.writes, []);
  assert.deepEqual(harness.notifications, [
    { message: "Copy failed: Clipboard unavailable: OSC 52 payload is too large", type: "error" },
  ]);
});

test("clipboard fallback reports terminal unavailable without a TTY", async () => {
  const harness = registerForClipboardTests({ nativeCommand: null, isTTY: false });
  await harness.commands[0].options.handler("", createClipboardContext(harness));
  assert.deepEqual(harness.notifications, [
    { message: "Copy failed: Clipboard unavailable: no native command found and terminal clipboard is not available", type: "error" },
  ]);
  assert.deepEqual(harness.renderCalls, []);
  assert.deepEqual(harness.writes, []);
});

test("extension registers /copy-code with native and remapped shortcuts", () => {
  const registered = { commands: [], shortcuts: [], handlers: new Map() };

  extension.default({
    on(event, handler) {
      registered.handlers.set(event, handler);
    },
    registerCommand(name, options) {
      registered.commands.push({ name, options });
    },
    registerShortcut(shortcut, options) {
      registered.shortcuts.push({ shortcut, options });
    },
  });

  assert.equal(registered.commands[0].name, "copy-code");
  assert.deepEqual(
    registered.shortcuts.map(({ shortcut }) => shortcut),
    ["ctrl+alt+c", "ctrl+super+c", "alt+c"],
  );
  assert.equal(typeof registered.handlers.get("session_start"), "function");
  assert.equal(typeof registered.handlers.get("session_shutdown"), "function");
});

test("session_start registers a terminal listener for copy-code shortcuts", () => {
  const { handlers, listeners, cleanupCalls } = registerForTerminalInputTests();
  const ctx = createTerminalInputContext({ listeners, cleanupCalls });

  handlers.get("session_start")({}, ctx);

  assert.equal(listeners.length, 1);
  assert.equal(cleanupCalls.length, 0);
});

for (const [shortcut, input] of [
  ["ctrl+alt+c", "\x1b\x03"],
  ["ctrl+super+c", "\x1b[99;13u"],
  ["physical Ctrl+Meta+C with Ctrl/Command remapped", "\x1bc"],
]) {
  test(`terminal listener consumes ${shortcut} and runs copy-code once`, () => {
    const { handlers, listeners, cleanupCalls } = registerForTerminalInputTests();
    const notifications = [];
    const ctx = createTerminalInputContext({ listeners, cleanupCalls, notifications });

    handlers.get("session_start")({}, ctx);
    const result = listeners[0](input);

    assert.deepEqual(result, { consume: true });
    assert.deepEqual(notifications, [{ message: "No code blocks found in recent assistant messages", type: "warning" }]);
  });
}

test("terminal listener consumes matching presses while copy-code is in flight without starting another run", async () => {
  const { handlers, listeners, cleanupCalls } = registerForTerminalInputTests();
  const notifications = [];
  let chooseCount = 0;
  let finishChoosing;
  const ctx = createTerminalInputContext({
    listeners,
    cleanupCalls,
    notifications,
    markdown: ["```js", "console.log('one')", "```", "", "```js", "console.log('two')", "```"].join("\n"),
    custom() {
      chooseCount += 1;
      return new Promise((resolve) => {
        finishChoosing = () => resolve(undefined);
      });
    },
  });

  handlers.get("session_start")({}, ctx);
  const first = listeners[0]("\x1b\x03");
  const second = listeners[0]("\x1bc");

  assert.deepEqual(first, { consume: true });
  assert.deepEqual(second, { consume: true });
  assert.equal(chooseCount, 1);

  finishChoosing();
  await waitForMicrotasks();

  assert.equal(chooseCount, 1);
  assert.deepEqual(notifications, [{ message: "Copy cancelled", type: "info" }]);
});

test("terminal listener allows a later matching press after in-flight copy-code settles", async () => {
  const { handlers, listeners, cleanupCalls } = registerForTerminalInputTests();
  const notifications = [];
  let chooseCount = 0;
  let finishChoosing;
  const ctx = createTerminalInputContext({
    listeners,
    cleanupCalls,
    notifications,
    markdown: ["```js", "console.log('one')", "```", "", "```js", "console.log('two')", "```"].join("\n"),
    custom() {
      chooseCount += 1;
      return new Promise((resolve) => {
        finishChoosing = () => resolve(undefined);
      });
    },
  });

  handlers.get("session_start")({}, ctx);
  const first = listeners[0]("\x1b\x03");
  assert.deepEqual(first, { consume: true });
  assert.equal(chooseCount, 1);

  finishChoosing();
  await waitForMicrotasks();
  assert.equal(chooseCount, 1);

  const second = listeners[0]("\x1b\x03");
  assert.deepEqual(second, { consume: true });
  assert.equal(chooseCount, 2);

  finishChoosing();
  await waitForMicrotasks();

  assert.equal(chooseCount, 2);
  assert.deepEqual(notifications, [
    { message: "Copy cancelled", type: "info" },
    { message: "Copy cancelled", type: "info" },
  ]);
});

test("terminal listener clears in-flight state after copy-code rejects", async () => {
  const { handlers, listeners, cleanupCalls } = registerForTerminalInputTests();
  const notifications = [];
  let customCalls = 0;
  const ctx = createTerminalInputContext({
    listeners,
    cleanupCalls,
    notifications,
    markdown: ["```js", "console.log('one')", "```", "", "```js", "console.log('two')", "```"].join("\n"),
    custom() {
      customCalls += 1;
      return Promise.reject(new Error(`picker failed ${customCalls}`));
    },
  });

  handlers.get("session_start")({}, ctx);
  const first = listeners[0]("\x1b\x03");
  assert.deepEqual(first, { consume: true });
  await waitForMicrotasks();

  const second = listeners[0]("\x1b\x03");
  assert.deepEqual(second, { consume: true });
  await waitForMicrotasks();

  assert.equal(customCalls, 2);
  assert.deepEqual(notifications, [
    { message: "Copy failed: picker failed 1", type: "error" },
    { message: "Copy failed: picker failed 2", type: "error" },
  ]);
});

test("terminal listener passes nonmatching input through", () => {
  const { handlers, listeners, cleanupCalls } = registerForTerminalInputTests();
  const notifications = [];
  const ctx = createTerminalInputContext({ listeners, cleanupCalls, notifications });

  handlers.get("session_start")({}, ctx);
  const result = listeners[0]("x");

  assert.equal(result, undefined);
  assert.deepEqual(notifications, []);
});

test("terminal listener preserves release and repeat behavior for both shortcuts", () => {
  const { handlers, listeners, cleanupCalls } = registerForTerminalInputTests();
  const notifications = [];
  const ctx = createTerminalInputContext({
    listeners,
    cleanupCalls,
    notifications,
    markdown: ["```js", "console.log('one')", "```", "", "```js", "console.log('two')", "```"].join("\n"),
    custom() {
      throw new Error("release/repeat should not run copy-code");
    },
  });

  handlers.get("session_start")({}, ctx);
  const altRepeat = listeners[0]("\x1b[99;7:2u");
  const altRelease = listeners[0]("\x1b[99;7:3u");
  const superRepeat = listeners[0]("\x1b[99;13:2u");
  const superRelease = listeners[0]("\x1b[99;13:3u");

  assert.deepEqual(altRepeat, { consume: true });
  assert.deepEqual(altRelease, { consume: true });
  assert.deepEqual(superRepeat, { consume: true });
  assert.deepEqual(superRelease, { consume: true });
  assert.deepEqual(notifications, []);
});

test("terminal listener is cleaned up on session shutdown and before re-registration", () => {
  const { handlers, listeners, cleanupCalls } = registerForTerminalInputTests();
  const ctx = createTerminalInputContext({ listeners, cleanupCalls });

  handlers.get("session_start")({}, ctx);
  handlers.get("session_start")({}, ctx);
  assert.deepEqual(cleanupCalls, [0]);

  handlers.get("session_shutdown")({}, ctx);
  assert.deepEqual(cleanupCalls, [0, 1]);
});

test("command and terminal entry points share the in-flight guard", async () => {
  const { handlers, listeners, cleanupCalls, commands } = registerForTerminalInputTests();
  let chooseCount = 0;
  let finishChoosing;
  const ctx = createTerminalInputContext({
    listeners,
    cleanupCalls,
    markdown: ["```js", "console.log('one')", "```", "", "```js", "console.log('two')", "```"].join("\n"),
    custom() {
      chooseCount += 1;
      return new Promise((resolve) => {
        finishChoosing = () => resolve(undefined);
      });
    },
  });

  handlers.get("session_start")({}, ctx);
  const commandRun = commands[0].options.handler("", ctx);
  const terminalResult = listeners[0]("\x1b\x03");

  assert.deepEqual(terminalResult, { consume: true });
  assert.equal(chooseCount, 1);

  finishChoosing();
  await commandRun;
});

test("session restart clears an abandoned in-flight guard", async () => {
  const { handlers, listeners, cleanupCalls, commands } = registerForTerminalInputTests();
  let chooseCount = 0;
  const ctx = createTerminalInputContext({
    listeners,
    cleanupCalls,
    markdown: ["```js", "console.log('one')", "```", "", "```js", "console.log('two')", "```"].join("\n"),
    custom() {
      chooseCount += 1;
      return new Promise(() => {});
    },
  });

  handlers.get("session_start")({}, ctx);
  void commands[0].options.handler("", ctx);
  assert.equal(chooseCount, 1);

  handlers.get("session_shutdown")({}, ctx);
  handlers.get("session_start")({}, ctx);
  const terminalResult = listeners.at(-1)("\x1b\x03");
  await waitForMicrotasks();

  assert.deepEqual(terminalResult, { consume: true });
  assert.equal(chooseCount, 2);
});

test("stale session completion cannot clear the active session guard", async () => {
  const { handlers, listeners, cleanupCalls, commands } = registerForTerminalInputTests();
  let chooseCount = 0;
  const finishChoosing = [];
  const ctx = createTerminalInputContext({
    listeners,
    cleanupCalls,
    markdown: ["```js", "console.log('one')", "```", "", "```js", "console.log('two')", "```"].join("\n"),
    custom() {
      chooseCount += 1;
      return new Promise((resolve) => {
        finishChoosing.push(() => resolve(undefined));
      });
    },
  });

  handlers.get("session_start")({}, ctx);
  void commands[0].options.handler("", ctx);
  assert.equal(chooseCount, 1);

  handlers.get("session_shutdown")({}, ctx);
  handlers.get("session_start")({}, ctx);
  const currentListener = listeners.at(-1);
  currentListener("\x1b\x03");
  assert.equal(chooseCount, 2);

  finishChoosing[0]();
  await waitForMicrotasks();
  currentListener("\x1b\x03");
  assert.equal(chooseCount, 2, "the stale run must not release the current session guard");

  finishChoosing[1]();
  await waitForMicrotasks();
  currentListener("\x1b\x03");
  assert.equal(chooseCount, 3);

  finishChoosing[2]();
  await waitForMicrotasks();
});

function registerForClipboardTests({ nativeCommand, isTTY = false, useProductionRender = false }) {
  const commands = [];
  const harness = { commands, notifications: [], renderCalls: [], doneCalls: [], writes: [] };
  const runtime = {
    copyNative: () => nativeCommand,
    stdout: { isTTY, write(data) { harness.writes.push(data); return true; } },
  };
  if (!useProductionRender) {
    runtime.requestFullRender = () => harness.renderCalls.push(true);
  }
  extension.default(
    {
      on() {},
      registerCommand(name, options) { commands.push({ name, options }); },
      registerShortcut() {},
    },
    runtime,
  );
  return harness;
}

function createClipboardContext(harness) {
  return {
    ui: { notify(message, type) { harness.notifications.push({ message, type }); } },
    sessionManager: { getEntries: () => [assistantEntry("```js\none\n```")] },
  };
}

function registerForTerminalInputTests() {
  const handlers = new Map();
  const listeners = [];
  const cleanupCalls = [];
  const commands = [];
  const shortcuts = [];

  extension.default({
    on(event, handler) {
      handlers.set(event, handler);
    },
    registerCommand(name, options) {
      commands.push({ name, options });
    },
    registerShortcut(shortcut, options) {
      shortcuts.push({ shortcut, options });
    },
  });

  return { handlers, listeners, cleanupCalls, commands, shortcuts };
}

function createTerminalInputContext({
  listeners,
  cleanupCalls,
  notifications = [],
  markdown,
  custom = () => Promise.resolve(undefined),
}) {
  return {
    hasUI: true,
    isIdle: () => true,
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
      onTerminalInput(handler) {
        const index = listeners.push(handler) - 1;
        return () => cleanupCalls.push(index);
      },
      custom,
    },
    sessionManager: {
      getEntries: () =>
        markdown
          ? [
              {
                type: "message",
                message: { role: "assistant", content: [{ type: "text", text: markdown }] },
              },
            ]
          : [],
    },
  };
}

async function waitForMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function waitUntil(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
