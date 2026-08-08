import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, isKeyRepeat, Markdown, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
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

export type MessageBlocks = {
  // 1-based chronological label among the collected messages (oldest = 1,
  // newest = messages.length).
  ordinal: number;
  blocks: CodeBlock[];
};

// Cap on how many prior assistant messages (that contain code) the picker will
// surface. Bounds in-memory work; nothing here is ever sent to the model.
export const DEFAULT_MESSAGE_CAP = 10;

type CopyAction = "copy" | "edit";

type PickerResult = {
  action: CopyAction;
  code: string;
} | undefined;

type TerminalInputResult = { consume?: boolean; data?: string } | undefined;

const COPY_CODE_SHORTCUTS = ["ctrl+alt+c", "ctrl+super+c", "alt+c"] as const;

export function handleCopyCodeTerminalInput(data: string, runCopyCode: () => void): TerminalInputResult {
  if (!COPY_CODE_SHORTCUTS.some((shortcut) => matchesKey(data, shortcut))) {
    return undefined;
  }

  if (!isKeyRelease(data) && !isKeyRepeat(data)) {
    runCopyCode();
  }

  return { consume: true };
}

function resolveEntries(ctx: AnyContext): any[] {
  const sessionManager = ctx.sessionManager as any;
  const entries =
    typeof sessionManager.getBranch === "function"
      ? sessionManager.getBranch()
      : sessionManager.getEntries();
  return Array.isArray(entries) ? entries : [];
}

function assistantMessageText(entry: any): string {
  const message = entry?.type === "message" ? entry.message : undefined;
  if (message?.role !== "assistant" || !Array.isArray(message.content)) {
    return "";
  }

  return message.content
    .filter((content: any) => content?.type === "text" && typeof content.text === "string")
    .map((content: any) => content.text)
    .join("\n");
}

// Pure helper: given raw session entries (chronological, oldest first), return
// the last `cap` assistant messages that contain code blocks. Messages without
// code blocks are skipped entirely. Ordinals are assigned chronologically after
// the cap is applied, so the newest surfaced message is `result.at(-1)`.
export function extractMessageBlocks(entries: any[], cap = DEFAULT_MESSAGE_CAP): MessageBlocks[] {
  const collected: CodeBlock[][] = [];

  for (const entry of entries) {
    const text = assistantMessageText(entry);
    if (!text.trim()) {
      continue;
    }

    const blocks = extractCodeBlocks(text);
    if (blocks.length === 0) {
      continue;
    }

    collected.push(blocks);
  }

  const tail = cap > 0 ? collected.slice(-cap) : collected.slice();
  return tail.map((blocks, i) => ({ ordinal: i + 1, blocks }));
}

function collectAssistantCodeBlocks(ctx: AnyContext, cap = DEFAULT_MESSAGE_CAP): MessageBlocks[] {
  return extractMessageBlocks(resolveEntries(ctx), cap);
}

export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: CodeBlock[] = [];

  let fenceChar: "`" | "~" | undefined;
  let fenceLength = 0;
  let fenceIndent = "";
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
      fenceIndent = line.slice(0, line.length - open[1].length - open[2].length);
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
      fenceIndent = "";
      lang = "";
      buffer = [];
      continue;
    }

    if (line.trim() === "") {
      buffer.push(line);
      continue;
    }

    let remove = 0;
    while (remove < fenceIndent.length && remove < line.length && /[ \t]/.test(line[remove])) {
      remove += 1;
    }
    buffer.push(line.slice(remove));
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

type ClipboardOutcome = { kind: "native"; command: string } | { kind: "osc52" };
type Stdout = Pick<NodeJS.WriteStream, "isTTY" | "write">;

function copyToClipboard(
  text: string,
  nativeCopy: (value: string) => string | undefined,
  stdout: Stdout,
): ClipboardOutcome {
  const native = nativeCopy(text);
  if (native) {
    return { kind: "native", command: native };
  }

  if (!stdout.isTTY) {
    throw new Error("Clipboard unavailable: no native command found and terminal clipboard is not available");
  }

  const encoded = Buffer.from(text, "utf8").toString("base64");
  if (encoded.length > 100_000) {
    throw new Error("Clipboard unavailable: OSC 52 payload is too large");
  }

  stdout.write(`\x1b]52;c;${encoded}\x07`);
  return { kind: "osc52" };
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

export function wrapIndex(index: number, delta: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return ((index + delta) % count + count) % count;
}

// Display-order labels for the response tab strip, laid out left-to-right with
// the newest response first. The current (newest) response is "Current" and
// older responses count how many steps back they are ("Prev 1", "Prev 2", ...).
// Index 0 is the leftmost (current) tab.
export function responseTabLabels(count: number): string[] {
  return Array.from({ length: count }, (_, i) => (i === 0 ? "Current" : `Prev ${i}`));
}

// Pure horizontal-scroll window for the tab strip. Given each tab cell's visible
// width, the active tab index, and the available width, returns the [start, end)
// index window that fits, always including activeIndex. A single-column marker is
// reserved on each side when there are more tabs off-screen. Separators between
// adjacent tabs are 1 column and accounted for internally. Expansion prefers the
// newer (right) neighbors first so context leans toward the latest response.
export function tabWindow(
  cellWidths: number[],
  activeIndex: number,
  width: number,
): { start: number; end: number; leftMore: boolean; rightMore: boolean } {
  const n = cellWidths.length;
  if (n === 0) {
    return { start: 0, end: 0, leftMore: false, rightMore: false };
  }

  const sep = 1;
  const totalAll = cellWidths.reduce((sum, w) => sum + w, 0) + (n - 1) * sep;
  if (totalAll <= width) {
    return { start: 0, end: n, leftMore: false, rightMore: false };
  }

  // Reserve up to one column per side for the ‹ / › markers while scrolling.
  const budget = Math.max(1, width - 2);
  const active = Math.min(Math.max(0, activeIndex), n - 1);

  let start = active;
  let end = active + 1; // [start, end)
  let used = cellWidths[active];
  let grow = true;
  while (grow) {
    grow = false;
    if (end < n && used + sep + cellWidths[end] <= budget) {
      used += sep + cellWidths[end];
      end += 1;
      grow = true;
    }
    if (start - 1 >= 0 && used + sep + cellWidths[start - 1] <= budget) {
      used += sep + cellWidths[start - 1];
      start -= 1;
      grow = true;
    }
  }

  return { start, end, leftMore: start > 0, rightMore: end < n };
}

// Case-insensitive subsequence fuzzy score. Returns -1 when the query does not
// match. Higher scores reward earlier matches and contiguous runs.
export function fuzzyScore(text: string, query: string): number {
  if (!query) {
    return 0;
  }

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  let cursor = 0;
  let score = 0;
  let streak = 0;

  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found === -1) {
      return -1;
    }
    if (found === cursor) {
      streak += 1;
      score += 5 + streak;
    } else {
      streak = 0;
      score += 1;
    }
    score -= Math.min(found, 20) * 0.1;
    cursor = found + 1;
  }

  // A matched query never returns the -1 no-match sentinel: the gap penalty
  // above can otherwise drive a valid (but distant) match below zero.
  return Math.max(0, score);
}

// Filters choices by a whitespace-delimited query where every token must match.
// Empty queries preserve the original order. The aggregate "All code blocks"
// choice (index 0 with that label) is matched on its label only, so a code
// search does not always surface it at the top via its concatenated contents.
export function filterCopyChoices(items: CopyChoice[], query: string): CopyChoice[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return items.slice();
  }

  const tokens = trimmed.split(/\s+/);

  const scored: { item: CopyChoice; score: number; order: number }[] = [];
  items.forEach((item, order) => {
    const isAggregate = order === 0 && item.label.startsWith("All code blocks");
    const haystack = isAggregate ? item.label : `${item.label}\n${item.lang}\n${item.code}`;

    let total = 0;
    let matched = true;
    for (const token of tokens) {
      const score = fuzzyScore(haystack, token);
      if (score < 0) {
        matched = false;
        break;
      }
      total += score;
    }

    if (matched) {
      scored.push({ item, score: total, order });
    }
  });

  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((entry) => entry.item);
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

function isBackspace(data: string): boolean {
  return data === "\x7f" || data === "\b" || matchesKey(data, "backspace");
}

function isPrintable(data: string): boolean {
  return data.length === 1 && data >= " " && data !== "\x7f";
}

export class CodeBlockPickerComponent {
  private selected = 0;
  private messageIndex: number;
  private readonly choicesByMessage: CopyChoice[][];
  private readonly maxChoices: number;
  private query = "";
  private searching = false;

  constructor(
    private messages: MessageBlocks[],
    private theme: Theme,
    private mdTheme: MarkdownTheme,
    private tui: TUI,
    private enterAction: CopyAction,
    private done: (result: PickerResult) => void,
  ) {
    this.choicesByMessage = messages.map((message) => createCopyChoices(message.blocks));
    this.maxChoices = this.choicesByMessage.reduce((max, choices) => Math.max(max, choices.length), 1);
    // Start on the newest message, matching the previous "latest message" behavior.
    this.messageIndex = Math.max(0, messages.length - 1);
  }

  private activeQuery(): string {
    return this.searching ? this.query : "";
  }

  private currentChoices(): CopyChoice[] {
    return this.choicesByMessage[this.messageIndex] ?? [];
  }

  private visibleItems(): CopyChoice[] {
    return filterCopyChoices(this.currentChoices(), this.activeQuery());
  }

  private switchMessage(delta: number): void {
    if (this.messages.length <= 1) {
      return;
    }
    this.messageIndex = wrapIndex(this.messageIndex, delta, this.messages.length);
    this.selected = 0;
    this.searching = false;
    this.query = "";
    this.tui.requestRender();
  }

  private exitSearch(): void {
    this.searching = false;
    this.query = "";
    this.selected = 0;
    this.tui.requestRender();
  }

  // Builds the full-width response tab strip, scrolled so the active tab is
  // always visible. Returns exactly `innerWidth` visible columns of content
  // (styled), without the surrounding box borders.
  private renderTabStrip(innerWidth: number): string {
    const count = this.messages.length;
    // Messages are stored chronologically (index 0 oldest, tail newest), but the
    // strip is displayed newest-first, so map the active message to its display
    // slot: display 0 = current (newest) = leftmost.
    const activeDisplay = count - 1 - this.messageIndex;
    const labels = responseTabLabels(count);
    const cells = labels.map((label) => ` ${label} `);
    const cellWidths = cells.map((cell) => visibleWidth(cell));
    const win = tabWindow(cellWidths, activeDisplay, innerWidth);
    const scrolling = win.leftMore || win.rightMore;

    const border = (s: string) => this.theme.fg("border", s);
    let out = "";
    let vis = 0;

    if (scrolling) {
      out += win.leftMore ? this.theme.fg("accent", "‹") : " ";
      vis += 1;
    }

    for (let i = win.start; i < win.end; i++) {
      if (i > win.start) {
        out += border("│");
        vis += 1;
      }
      out +=
        i === activeDisplay
          ? this.theme.fg("accent", cells[i])
          : this.theme.fg("dim", cells[i]);
      vis += cellWidths[i];
    }

    if (scrolling) {
      const rightMarker = win.rightMore ? this.theme.fg("accent", "›") : " ";
      const pad = Math.max(0, innerWidth - vis - 1);
      out += " ".repeat(pad) + rightMarker;
    } else {
      out += " ".repeat(Math.max(0, innerWidth - vis));
    }

    return out;
  }

  render(width: number): string[] {
    const listWidth = Math.min(36, Math.floor(width * 0.38));
    const previewWidth = Math.max(10, width - listWidth - 3);
    const maxHeight = Math.min(28, Math.max(this.maxChoices + 6, 14));

    const visibleItems = this.visibleItems();
    if (this.selected >= visibleItems.length) {
      this.selected = Math.max(0, visibleItems.length - 1);
    }

    const innerWidth = listWidth + previewWidth + 1;
    const boxRows = maxHeight - 2;
    const showSearch = this.searching;
    const showStrip = this.messages.length > 1;
    const searchRows = showSearch ? 1 : 0;
    const itemRows = Math.max(1, boxRows - searchRows);

    const offset = Math.min(
      Math.max(0, this.selected - itemRows + 1),
      Math.max(0, visibleItems.length - itemRows),
    );

    const leftLines: string[] = [];
    if (showSearch) {
      const counter = `${visibleItems.length}/${this.currentChoices().length}`;
      const searchLine = `/${this.query}█  ${counter}`;
      leftLines.push(truncateToWidth(this.theme.fg("accent", searchLine), listWidth, undefined, true));
    }
    if (visibleItems.length === 0) {
      leftLines.push(truncateToWidth(this.theme.fg("dim", "  (no matches)"), listWidth, undefined, true));
    } else {
      for (let i = offset; i < Math.min(visibleItems.length, offset + itemRows); i++) {
        const item = visibleItems[i];
        const prefix = i === this.selected ? "> " : "  ";
        const text = prefix + item.label;
        const styled =
          i === this.selected ? this.theme.fg("accent", text) : this.theme.fg("dim", text);
        leftLines.push(truncateToWidth(styled, listWidth, undefined, true));
      }
    }

    const selected = visibleItems[this.selected];
    let previewLines: string[] = [];
    if (selected) {
      const mdText = selected.lang
        ? `\`\`\`${selected.lang}\n${selected.code}\n\`\`\``
        : selected.code;
      const md = new Markdown(mdText, 0, 1, this.mdTheme);
      previewLines = md.render(previewWidth).slice(0, maxHeight - 4);
    }

    const border = (s: string) => this.theme.fg("border", s);
    const divider = border("│");
    const lines: string[] = [];

    if (showStrip) {
      lines.push(border("┌") + border("─".repeat(innerWidth)) + border("┐"));
      lines.push(divider + this.renderTabStrip(innerWidth) + divider);
      lines.push(
        border("├") +
          border("─".repeat(listWidth)) +
          border("┬") +
          border("─".repeat(previewWidth)) +
          border("┤"),
      );
    } else {
      lines.push(
        border("┌") +
          border("─".repeat(listWidth)) +
          border("┬") +
          border("─".repeat(previewWidth)) +
          border("┐"),
      );
    }

    for (let i = 0; i < boxRows; i++) {
      const left = leftLines[i] || " ".repeat(listWidth);
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
    const msgSegment = this.messages.length > 1 ? "←/→ responses • " : "";
    const hint = this.searching
      ? ` ↑↓ navigate • ${enterLabel} • ⌫/esc back `
      : ` ${msgSegment}↑↓/j/k blocks • ${enterLabel} • e edit • / search • esc/q cancel `;
    const hintWidth = visibleWidth(hint);
    const pad = Math.max(0, width - hintWidth);
    lines.push(this.theme.fg("dim", " ".repeat(Math.floor(pad / 2)) + hint));

    return lines;
  }

  handleInput(data: string): void {
    const visibleItems = this.visibleItems();

    if (matchesKey(data, "ctrl+c")) {
      this.done(undefined);
      return;
    }

    if (this.searching) {
      if (matchesKey(data, "escape")) {
        this.exitSearch();
      } else if (isBackspace(data)) {
        // Deleting past an empty query leaves search, like esc.
        if (this.query.length === 0) {
          this.exitSearch();
        } else {
          this.query = this.query.slice(0, -1);
          this.selected = 0;
          this.tui.requestRender();
        }
      } else if (matchesKey(data, "enter")) {
        const item = visibleItems[this.selected];
        if (item) {
          this.done({ action: this.enterAction, code: item.code });
        }
      } else if (matchesKey(data, "up")) {
        this.selected = wrapIndex(this.selected, -1, visibleItems.length);
        this.tui.requestRender();
      } else if (matchesKey(data, "down")) {
        this.selected = wrapIndex(this.selected, 1, visibleItems.length);
        this.tui.requestRender();
      } else if (isPrintable(data)) {
        this.query += data;
        this.selected = 0;
        this.tui.requestRender();
      }
      return;
    }

    if (data === "/") {
      this.searching = true;
      this.query = "";
      this.selected = 0;
      this.tui.requestRender();
    } else if (matchesKey(data, "left") || matchesKey(data, "shift+tab")) {
      // Left / shift+tab move toward the current (newest) response.
      this.switchMessage(1);
    } else if (matchesKey(data, "right") || matchesKey(data, "tab")) {
      // Right / tab walk back through older responses.
      this.switchMessage(-1);
    } else if (matchesKey(data, "up") || data === "k") {
      this.selected = wrapIndex(this.selected, -1, visibleItems.length);
      this.tui.requestRender();
    } else if (matchesKey(data, "down") || data === "j") {
      this.selected = wrapIndex(this.selected, 1, visibleItems.length);
      this.tui.requestRender();
    } else if (matchesKey(data, "enter")) {
      const item = visibleItems[this.selected];
      if (item) {
        this.done({ action: this.enterAction, code: item.code });
      }
    } else if (data === "e") {
      const item = visibleItems[this.selected];
      if (item) {
        this.done({ action: "edit", code: item.code });
      }
    } else if (matchesKey(data, "escape") || data === "q") {
      this.done(undefined);
    }
  }

  invalidate(): void {}
}

async function chooseCopyAction(
  messages: MessageBlocks[],
  ctx: AnyContext,
  enterAction: CopyAction,
): Promise<PickerResult> {
  // Only shortcut past the picker when there is a single block in a single
  // message; otherwise the picker is needed to navigate messages or blocks.
  if (messages.length === 1 && messages[0].blocks.length === 1) {
    return { action: enterAction, code: messages[0].blocks[0].code };
  }

  const mdTheme = { ...getMarkdownTheme(), codeBlockIndent: "" };

  return await ctx.ui.custom<PickerResult>(
    (tui, theme, _keybindings, done) =>
      new CodeBlockPickerComponent(messages, theme, mdTheme, tui, enterAction, done),
    { overlay: true },
  );
}

export function splitEditorCommand(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else if (
        quote === '"' &&
        char === "\\" &&
        i + 1 < command.length &&
        ['\\', '"', "$", "`"].includes(command[i + 1])
      ) {
        current += command[++i];
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

type EditorSpawn = {
  command: string;
  args: string[];
  options: { windowsVerbatimArguments?: boolean };
};

const CMD_META_CHARACTERS = /([()\][%!^"`<>&|;, *?])/g;

function escapeCmdCommand(command: string): string {
  return command.replace(CMD_META_CHARACTERS, "^$1");
}

function escapeCmdArgument(argument: string): string {
  return `"${argument
    .replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')
    .replace(/(?=(\\+?)?)\1$/, "$1$1")}"`.replace(CMD_META_CHARACTERS, "^$1");
}

export function buildEditorSpawn(
  editorCommand: string,
  file: string,
  platform: NodeJS.Platform = process.platform,
  commandProcessor = process.env.ComSpec || "cmd.exe",
): EditorSpawn {
  const [editor, ...editorArgs] = splitEditorCommand(editorCommand);
  if (!editor) {
    throw new Error("Editor command is empty");
  }

  const args = [...editorArgs, file];
  if (platform !== "win32" || /\.(?:exe|com)$/i.test(editor)) {
    return { command: editor, args, options: {} };
  }

  const commandString = [escapeCmdCommand(editor), ...args.map(escapeCmdArgument)].join(" ");
  return {
    command: commandProcessor,
    args: ["/d", "/s", "/c", `"${commandString}"`],
    options: { windowsVerbatimArguments: true },
  };
}

export function resolveEditorCommand(
  injected: string | undefined,
  env: { VISUAL?: string; EDITOR?: string } = process.env,
): string | undefined {
  return injected !== undefined ? injected : env.VISUAL || env.EDITOR;
}

type EditorWarning = { warnings?: string[] };
type EditorResult = ({ code: string } & EditorWarning) | ({ error: string } & EditorWarning) | undefined;
type ExternalEditorOptions = {
  editorCommand?: string;
  tempRoot?: string;
  removeTemp?: (directory: string) => void;
};

export class ExternalEditorComponent {
  private started = false;
  private completed = false;
  private handedOff = false;

  constructor(
    private code: string,
    private tui: TUI,
    private done: (result: EditorResult) => void,
    private options: ExternalEditorOptions = {},
  ) {}

  render(width: number): string[] {
    if (!this.started) {
      this.started = true;
      setTimeout(() => this.openExternalEditor(), 0);
    }
    return [truncateToWidth("Opening external editor…", width, undefined, true)];
  }

  handleInput(data: string): void {
    if (!this.handedOff && (matchesKey(data, "ctrl+c") || matchesKey(data, "escape") || data === "q")) {
      this.finish(undefined);
    }
  }

  invalidate(): void {}

  private finish(result: EditorResult): void {
    if (!this.completed) {
      this.completed = true;
      this.done(result);
    }
  }

  private openExternalEditor(): void {
    if (this.completed) {
      return;
    }

    const editorCommand = resolveEditorCommand(this.options.editorCommand);
    if (!editorCommand) {
      this.finish({ error: "No external editor configured. Set $VISUAL or $EDITOR." });
      return;
    }

    let tmpDir: string | undefined;
    let tmpFile: string;
    try {
      tmpDir = fs.mkdtempSync(path.join(this.options.tempRoot ?? os.tmpdir(), "pi-copy-code-"));
      tmpFile = path.join(tmpDir, "code.txt");
      fs.writeFileSync(tmpFile, this.code, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (tmpDir) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}
      }
      const message = error instanceof Error ? error.message : String(error);
      this.finish({ error: `Unable to prepare editor file: ${message}` });
      return;
    }

    let result: EditorResult;
    const warnings: string[] = [];
    let tuiStopped = false;
    try {
      const invocation = buildEditorSpawn(editorCommand, tmpFile);
      this.handedOff = true;
      this.tui.stop();
      tuiStopped = true;

      const processResult = spawnSync(invocation.command, invocation.args, {
        stdio: "inherit",
        ...invocation.options,
      });
      if (processResult.error) {
        result = { error: `Unable to start editor: ${processResult.error.message}` };
      } else if (processResult.status !== 0) {
        result = { error: `Editor exited with status ${processResult.status ?? "unknown"}` };
      } else {
        result = { code: fs.readFileSync(tmpFile, "utf8").replace(/\r?\n$/, "") };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = { error: `Editor failed: ${message}` };
    } finally {
      try {
        const removeTemp = this.options.removeTemp ?? ((directory: string) => {
          fs.rmSync(directory, { recursive: true, force: true });
        });
        removeTemp(tmpDir);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Unable to remove editor files: ${message}`);
      }

      if (tuiStopped) {
        try {
          this.tui.start();
          this.tui.requestRender(true);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`Unable to restore terminal UI: ${message}`);
        }
      }
    }

    if (result && warnings.length > 0) {
      result.warnings = warnings;
    }
    this.finish(result);
  }
}

async function editCodeBeforeCopy(code: string, ctx: AnyContext): Promise<EditorResult> {
  return await ctx.ui.custom<EditorResult>(
    (tui, _theme, _keybindings, done) => new ExternalEditorComponent(code, tui, done),
    { overlay: true },
  );
}

type ExtensionRuntime = {
  copyNative: (text: string) => string | undefined;
  stdout: Stdout;
  requestFullRender?: (ctx: AnyContext) => void | Promise<void>;
};

function requestFullRender(ctx: AnyContext): void {
  try {
    const pending = ctx.ui.custom<void>(
      (tui, _theme, _keybindings, done) => {
        tui.requestRender(true);
        done();
        return {
          render: () => [],
          handleInput: () => {},
          invalidate: () => {},
        };
      },
      { overlay: true },
    );
    void Promise.resolve(pending).catch(() => {});
  } catch {}
}

export default function copyCodeExtension(
  pi: ExtensionAPI,
  runtimeOverrides: Partial<ExtensionRuntime> = {},
) {
  const runtime: ExtensionRuntime = {
    copyNative,
    stdout: process.stdout,
    requestFullRender,
    ...runtimeOverrides,
  };
  let unsubscribeTerminalInput: (() => void) | undefined;
  let sessionEpoch = 0;
  let activeRunEpoch: number | undefined;

  function clearTerminalInputListener(): void {
    unsubscribeTerminalInput?.();
    unsubscribeTerminalInput = undefined;
  }

  function notifyUnexpectedError(error: unknown, ctx: AnyContext): void {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Copy failed: ${message}`, "error");
  }

  async function run(args: string, ctx: AnyContext): Promise<void> {
    if ("waitForIdle" in ctx) {
      await ctx.waitForIdle();
    }

    const messages = collectAssistantCodeBlocks(ctx, DEFAULT_MESSAGE_CAP);
    if (messages.length === 0) {
      ctx.ui.notify("No code blocks found in recent assistant messages", "warning");
      return;
    }

    const arg = args.trim().toLowerCase();
    let text: string | undefined;

    if (!arg || arg === "edit") {
      const result = await chooseCopyAction(messages, ctx, arg === "edit" ? "edit" : "copy");
      if (result === undefined) {
        ctx.ui.notify("Copy cancelled", "info");
        return;
      }

      if (result.action === "edit") {
        const edited = await editCodeBeforeCopy(result.code, ctx);
        if (edited === undefined) {
          ctx.ui.notify("Copy cancelled", "info");
          return;
        }
        for (const warning of edited.warnings ?? []) {
          ctx.ui.notify(`Copy warning: ${warning}`, "warning");
        }
        if ("error" in edited) {
          ctx.ui.notify(`Copy failed: ${edited.error}`, "error");
          return;
        }
        text = edited.code;
      } else {
        text = result.code;
      }
    } else {
      ctx.ui.notify("Usage: /copy-code [edit]", "warning");
      return;
    }

    try {
      const outcome = copyToClipboard(text, runtime.copyNative, runtime.stdout);
      const lines = lineCount(text);
      const lineLabel = `${lines} line${lines === 1 ? "" : "s"}`;
      if (outcome.kind === "native") {
        ctx.ui.notify(`Copied ${lineLabel} via ${outcome.command}`, "info");
      } else {
        try {
          const pendingRender = runtime.requestFullRender?.(ctx);
          void Promise.resolve(pendingRender).catch(() => {});
        } catch {}
        ctx.ui.notify(`Sent ${lineLabel} to terminal clipboard via OSC 52 (best effort)`, "info");
      }
    } catch (error) {
      notifyUnexpectedError(error, ctx);
    }
  }

  async function runGuarded(args: string, ctx: AnyContext): Promise<void> {
    if (activeRunEpoch !== undefined) {
      return;
    }

    const runEpoch = sessionEpoch;
    activeRunEpoch = runEpoch;
    try {
      await run(args, ctx);
    } catch (error) {
      notifyUnexpectedError(error, ctx);
    } finally {
      if (activeRunEpoch === runEpoch && sessionEpoch === runEpoch) {
        activeRunEpoch = undefined;
      }
    }
  }

  pi.registerCommand("copy-code", {
    description:
      "Copy code from recent assistant messages; opens a picker to choose blocks and page across responses",
    handler: runGuarded,
  });

  for (const shortcut of COPY_CODE_SHORTCUTS) {
    pi.registerShortcut(shortcut, {
      description: "Copy code from recent assistant messages",
      handler: (ctx) => runGuarded("", ctx),
    });
  }

  pi.on("session_start", (_event, ctx) => {
    clearTerminalInputListener();
    sessionEpoch += 1;
    activeRunEpoch = undefined;

    if (!ctx.hasUI) {
      return;
    }

    unsubscribeTerminalInput = ctx.ui.onTerminalInput((data) =>
      handleCopyCodeTerminalInput(data, () => {
        void runGuarded("", ctx);
      }),
    );
  });

  pi.on("session_shutdown", () => {
    clearTerminalInputListener();
    sessionEpoch += 1;
    activeRunEpoch = undefined;
  });
}
