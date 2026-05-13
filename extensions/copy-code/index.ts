import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { MarkdownTheme, TUI } from "@earendil-works/pi-tui";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type AnyContext = ExtensionCommandContext | ExtensionContext;

export type CodeBlock = {
  index: number;
  lang: string;
  code: string;
};

export type CopyChoice = {
  label: string;
  code: string;
  lang: string;
};

type CopyAction = "copy" | "edit";

type PickerResult = {
  action: CopyAction;
  code: string;
} | null;

function latestAssistantMarkdown(ctx: AnyContext): string | undefined {
  const sessionManager = ctx.sessionManager as any;
  const entries =
    typeof sessionManager.getBranch === "function"
      ? sessionManager.getBranch()
      : sessionManager.getEntries();

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const message = entry?.type === "message" ? entry.message : undefined;
    if (message?.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }

    const text = message.content
      .filter((content: any) => content?.type === "text" && typeof content.text === "string")
      .map((content: any) => content.text)
      .join("\n");

    if (text.trim()) {
      return text;
    }
  }

  return undefined;
}

export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: CodeBlock[] = [];

  let fenceChar: "`" | "~" | undefined;
  let fenceLength = 0;
  let lang = "";
  let buffer: string[] = [];

  for (const line of lines) {
    if (!fenceChar) {
      const open = line.match(/^[ \t]*(`{3,}|~{3,})([^\r\n]*)$/);
      if (!open) {
        continue;
      }

      fenceChar = open[1][0] as "`" | "~";
      fenceLength = open[1].length;
      lang = (open[2] || "").trim().split(/\s+/)[0] || "";
      buffer = [];
      continue;
    }

    const fenceLiteral = fenceChar === "`" ? "`" : "~";
    const close = new RegExp(`^[ \\t]*${fenceLiteral}{${fenceLength},}[ \\t]*$`);
    if (close.test(line)) {
      blocks.push({ index: blocks.length + 1, lang, code: buffer.join("\n") });
      fenceChar = undefined;
      fenceLength = 0;
      lang = "";
      buffer = [];
      continue;
    }

    buffer.push(line);
  }

  return blocks;
}

function copyNative(text: string): string | undefined {
  const attempts: [string, string[]][] =
    process.platform === "darwin"
      ? [["pbcopy", []]]
      : process.platform === "win32"
        ? [["clip.exe", []]]
        : process.env.WAYLAND_DISPLAY
          ? [
              ["wl-copy", []],
              ["xclip", ["-selection", "clipboard"]],
              ["xsel", ["--clipboard", "--input"]],
            ]
          : [
              ["xclip", ["-selection", "clipboard"]],
              ["xsel", ["--clipboard", "--input"]],
              ["wl-copy", []],
            ];

  for (const [command, args] of attempts) {
    const result = spawnSync(command, args, {
      input: text,
      encoding: "utf8",
      stdio: ["pipe", "ignore", "ignore"],
    });

    if (!result.error && result.status === 0) {
      return command;
    }
  }

  return undefined;
}

function copyOsc52(text: string): boolean {
  const encoded = Buffer.from(text, "utf8").toString("base64");
  if (encoded.length > 100_000) {
    return false;
  }

  process.stdout.write(`\x1b]52;c;${encoded}\x07`);
  return true;
}

function copyToClipboard(text: string): string {
  const native = copyNative(text);
  if (native) {
    return native;
  }

  if (copyOsc52(text)) {
    return "OSC 52";
  }

  throw new Error("Clipboard unavailable: no native command found and text is too large for terminal copy");
}

function lineCount(text: string): number {
  return text === "" ? 0 : text.split("\n").length;
}

function describeBlock(block: CodeBlock): string {
  const codeLines = block.code.split("\n");
  const first = codeLines.find((line) => line.trim())?.trim().slice(0, 60) || "(blank)";
  const lines = block.code === "" ? 0 : codeLines.length;
  return `${block.index}. ${block.lang || "text"} (${lines} line${lines === 1 ? "" : "s"}) ${first}`;
}

export function createCopyChoices(blocks: CodeBlock[]): CopyChoice[] {
  if (blocks.length <= 1) {
    return blocks.map((block) => ({ label: describeBlock(block), code: block.code, lang: block.lang }));
  }

  return [
    { label: `All code blocks (${blocks.length} blocks)`, code: blocks.map((b) => b.code).join("\n\n"), lang: "" },
    ...blocks.map((block) => ({ label: describeBlock(block), code: block.code, lang: block.lang })),
  ];
}

class CodeBlockPickerComponent {
  private selected = 0;
  private items: CopyChoice[];

  constructor(
    blocks: CodeBlock[],
    private theme: Theme,
    private mdTheme: MarkdownTheme,
    private tui: TUI,
    private enterAction: CopyAction,
    private done: (result: PickerResult) => void,
  ) {
    this.items = createCopyChoices(blocks);
  }

  render(width: number): string[] {
    const listWidth = Math.min(36, Math.floor(width * 0.38));
    const previewWidth = Math.max(10, width - listWidth - 3);
    const maxHeight = Math.min(28, Math.max(this.items.length + 6, 14));

    const listLines = this.items.map((item, i) => {
      const prefix = i === this.selected ? "> " : "  ";
      const text = prefix + item.label;
      const styled =
        i === this.selected
          ? this.theme.fg("accent", text)
          : this.theme.fg("dim", text);
      return truncateToWidth(styled, listWidth, undefined, true);
    });

    const selected = this.items[this.selected];
    const mdText = selected.lang
      ? `\`\`\`${selected.lang}\n${selected.code}\n\`\`\``
      : selected.code;
    const md = new Markdown(mdText, 0, 1, this.mdTheme);
    const previewLines = md.render(previewWidth).slice(0, maxHeight - 4);

    const border = (s: string) => this.theme.fg("border", s);
    const divider = border("│");
    const lines: string[] = [];

    lines.push(
      border("┌") +
        border("─".repeat(listWidth)) +
        border("┬") +
        border("─".repeat(previewWidth)) +
        border("┐"),
    );

    for (let i = 0; i < maxHeight - 2; i++) {
      const left = listLines[i] || " ".repeat(listWidth);
      const right = truncateToWidth(previewLines[i] || "", previewWidth, undefined, true);
      lines.push(divider + left + divider + right + divider);
    }

    lines.push(
      border("└") +
        border("─".repeat(listWidth)) +
        border("┴") +
        border("─".repeat(previewWidth)) +
        border("┘"),
    );

    const enterLabel = this.enterAction === "edit" ? "enter edit" : "enter copy";
    const hint = ` ↑↓/j/k navigate • ${enterLabel} • e edit • esc/q cancel `;
    const hintWidth = visibleWidth(hint);
    const pad = Math.max(0, width - hintWidth);
    lines.push(this.theme.fg("dim", " ".repeat(Math.floor(pad / 2)) + hint));

    return lines;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "up") || data === "k") {
      this.selected = Math.max(0, this.selected - 1);
      this.tui.requestRender();
    } else if (matchesKey(data, "down") || data === "j") {
      this.selected = Math.min(this.items.length - 1, this.selected + 1);
      this.tui.requestRender();
    } else if (matchesKey(data, "enter")) {
      this.done({ action: this.enterAction, code: this.items[this.selected].code });
    } else if (data === "e") {
      this.done({ action: "edit", code: this.items[this.selected].code });
    } else if (matchesKey(data, "escape") || data === "q") {
      this.done(null);
    }
  }

  invalidate(): void {}
}

async function chooseCopyAction(
  blocks: CodeBlock[],
  ctx: ExtensionCommandContext,
  enterAction: CopyAction,
): Promise<PickerResult> {
  if (blocks.length === 1) {
    return { action: enterAction, code: blocks[0].code };
  }

  const mdTheme = { ...getMarkdownTheme(), codeBlockIndent: "" };

  return await ctx.ui.custom<PickerResult>(
    (tui, theme, _keybindings, done) =>
      new CodeBlockPickerComponent(blocks, theme, mdTheme, tui, enterAction, done),
    { overlay: true },
  );
}

class ExternalEditorComponent {
  private started = false;

  constructor(
    private code: string,
    private tui: TUI,
    private done: (result: string | undefined) => void,
  ) {}

  render(width: number): string[] {
    if (!this.started) {
      this.started = true;
      setTimeout(() => this.openExternalEditor(), 0);
    }

    return [truncateToWidth("Opening external editor…", width, undefined, true)];
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      this.done(undefined);
    }
  }

  invalidate(): void {}

  private openExternalEditor(): void {
    const editorCommand = process.env.VISUAL || process.env.EDITOR;
    if (!editorCommand) {
      this.done(undefined);
      return;
    }

    const tmpFile = path.join(os.tmpdir(), `pi-copy-code-${Date.now()}.txt`);

    let edited: string | undefined;

    try {
      fs.writeFileSync(tmpFile, this.code, "utf-8");
      this.tui.stop();

      const [editor, ...editorArgs] = editorCommand.split(" ");
      const result = spawnSync(editor, [...editorArgs, tmpFile], {
        stdio: "inherit",
        shell: process.platform === "win32",
      });

      if (result.status === 0) {
        edited = fs.readFileSync(tmpFile, "utf-8").replace(/\n$/, "");
      }
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Best-effort cleanup only.
      }

      this.tui.start();
      this.tui.requestRender(true);
    }

    this.done(edited);
  }
}

async function editCodeBeforeCopy(
  code: string,
  ctx: ExtensionCommandContext,
): Promise<string | undefined> {
  if (!(process.env.VISUAL || process.env.EDITOR)) {
    ctx.ui.notify("No external editor configured. Set $VISUAL or $EDITOR.", "warning");
    return undefined;
  }

  return await ctx.ui.custom<string | undefined>(
    (tui, _theme, _keybindings, done) => new ExternalEditorComponent(code, tui, done),
    { overlay: true },
  );
}

export default function copyCodeExtension(pi: ExtensionAPI) {
  async function run(args: string, ctx: AnyContext): Promise<void> {
    if ("waitForIdle" in ctx) {
      await ctx.waitForIdle();
    }

    const markdown = latestAssistantMarkdown(ctx);
    if (!markdown) {
      ctx.ui.notify("No assistant message found", "warning");
      return;
    }

    const blocks = extractCodeBlocks(markdown);
    if (blocks.length === 0) {
      ctx.ui.notify("No code blocks found in the last assistant message", "warning");
      return;
    }

    const arg = args.trim().toLowerCase();
    let text: string | undefined;

    // Backward-compatible hidden forms. The advertised UX is just /copy-code.
    if (arg === "all") {
      text = blocks.map((block) => block.code).join("\n\n");
    } else if (/^\d+$/.test(arg)) {
      text = blocks[Number(arg) - 1]?.code;
      if (text === undefined) {
        ctx.ui.notify(`No code block #${arg}`, "warning");
        return;
      }
    } else if (!arg || arg === "last" || arg === "select" || arg === "choose" || arg === "edit") {
      const result = await chooseCopyAction(
        blocks,
        ctx as ExtensionCommandContext,
        arg === "edit" ? "edit" : "copy",
      );
      if (result === null) {
        ctx.ui.notify("Copy cancelled", "info");
        return;
      }

      if (result.action === "edit") {
        const edited = await editCodeBeforeCopy(result.code, ctx as ExtensionCommandContext);
        if (edited === undefined) {
          ctx.ui.notify("Copy cancelled", "info");
          return;
        }
        text = edited;
      } else {
        text = result.code;
      }
    } else {
      ctx.ui.notify("Usage: /copy-code", "warning");
      return;
    }

    try {
      const via = copyToClipboard(text);
      const lines = lineCount(text);
      ctx.ui.notify(`Copied ${lines} line${lines === 1 ? "" : "s"} via ${via}`, "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Copy failed: ${message}`, "error");
    }
  }

  pi.registerCommand("copy-code", {
    description: "Copy code from the latest assistant message; prompts when multiple blocks",
    handler: run,
  });

  pi.registerShortcut("ctrl+alt+c", {
    description: "Copy code from the latest assistant message",
    handler: (ctx) => run("", ctx),
  });
}
