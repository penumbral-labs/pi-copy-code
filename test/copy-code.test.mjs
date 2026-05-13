import assert from "node:assert/strict";
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

test("extension registers /copy-code and ctrl+alt+c", () => {
  const registered = { commands: [], shortcuts: [] };

  extension.default({
    registerCommand(name, options) {
      registered.commands.push({ name, options });
    },
    registerShortcut(shortcut, options) {
      registered.shortcuts.push({ shortcut, options });
    },
  });

  assert.equal(registered.commands[0].name, "copy-code");
  assert.equal(registered.shortcuts[0].shortcut, "ctrl+alt+c");
});
