# pi-copy-code

A [Pi](https://pi.dev/) package for copying fenced code blocks from assistant messages without terminal-selection
padding.

`pi-copy-code` adds `/copy-code` and shortcuts for copying the raw text of recent assistant code blocks. A single block
copies immediately. Multiple blocks or responses open a two-pane picker with a live preview and access to the last ten
assistant responses containing code.

## Prerequisites

- Node.js 22.19.0 or newer
- Pi (tested against Pi 0.84.1; older releases are untested)
- A native clipboard command (`pbcopy`, `wl-copy`, `xclip`, `xsel`, or `clip.exe`) or a terminal that supports OSC 52

Core Pi packages remain wildcard peer dependencies so the package uses the Pi installation that loads it. The
`latest-pi` CI lane checks current Pi releases on an advisory basis.

## Install

From npm:

```bash
pi install npm:@penumbral-labs/pi-copy-code
```

Then reload Pi:

```text
/reload
```

For a one-off run without installing:

```bash
pi -e npm:@penumbral-labs/pi-copy-code
```

You can also load a checkout directly:

```bash
git clone https://github.com/penumbral-labs/pi-copy-code.git
cd pi-copy-code
npm ci
pi -e "$(pwd)"
```

## Usage

Copy code from recent assistant messages:

```text
/copy-code
```

The extension captures these shortcut names:

```text
ctrl+alt+c
ctrl+super+c
alt+c
```

Pi calls the Meta/Command modifier `super`. Super-modified shortcuts require a terminal that reports modifiers
separately, such as one using the Kitty keyboard protocol. The `alt+c` registration handles terminals where a physical
Ctrl+Meta+C chord is remapped and arrives as Alt+C. The tradeoff is that a real Alt+C chord can also invoke the
extension; use `/copy-code` or another captured chord if that conflicts with your terminal workflow.

Edit before copying:

```text
/copy-code edit
```

Edit mode opens `$VISUAL`, then `$EDITOR`, with the selected text in private temporary storage; set one of these
variables to your preferred editor command before using edit mode. On Windows, only `.exe` and `.com` targets spawn
directly. All other values, including extension-less names and `.cmd`/`.bat` shims, use the explicitly constructed,
escaped `cmd.exe /d /s /c` path.

When the picker opens:

- `↑` / `↓` or `j` / `k` — move within the current response
- `→` or `tab` — move to an older response
- `←` or `shift+tab` — move toward the current response
- `enter` — copy, or edit then copy when invoked with `/copy-code edit`
- `e` — edit the selected block, then copy
- `/` — fuzzy-search blocks in the current response
- `ctrl+c`, `esc`, or `q` — cancel

Response navigation wraps at both ends. The first picker item, `All code blocks`, joins all blocks in the selected
response with blank lines.

## Clipboard behavior

Native clipboard success is confirmed by the clipboard command and reported as `Copied N lines via <command>`. When no
native command is available and standard output is a TTY, the extension sends OSC 52 and reports
`Sent N lines to terminal clipboard via OSC 52 (best effort)`. OSC 52 support and size limits vary by terminal, so this
fallback cannot confirm that the clipboard changed. Without either path, the extension reports that the terminal
clipboard is unavailable.

Fences nested under Markdown indentation are de-indented by the opening fence's structural whitespace while preserving
additional code indentation. Indented Markdown code blocks without fences are not extracted.

## Support and contributing

- Use the [bug report form](https://github.com/penumbral-labs/pi-copy-code/issues/new?template=bug_report.yml) for
  reproducible problems.
- Use the [feature request form](https://github.com/penumbral-labs/pi-copy-code/issues/new?template=feature_request.yml)
  for focused proposals.
- Read [CONTRIBUTING.md](CONTRIBUTING.md) before sending a pull request.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
- See [CHANGELOG.md](CHANGELOG.md) for release history.

## Package shape

Pi loads the TypeScript source extension directly. The npm tarball contains only `package.json`, the source extension,
`README.md`, `CHANGELOG.md`, and `LICENSE`; it has no runtime dependencies or install scripts.
