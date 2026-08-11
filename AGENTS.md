# Repository instructions

## Purpose

`pi-copy-code` is a focused Pi package for copying fenced code blocks from recent assistant messages. Preserve its small
product shape: one command, a compact picker, and no runtime dependencies.

## Architecture

- Pi loads `extensions/copy-code/index.ts` directly from the package manifest; do not add compiled output.
- Keep the extension in the existing single module unless a concrete change requires another production module.
- Keep pure helpers and the exported picker, editor, and editor-spawn seams available for focused tests.
- Pi core packages stay wildcard peer dependencies. Development dependencies pin the supported Pi baseline.
- The public npm package is limited by the explicit `files` allowlist.

## Development

- Requires Node.js 22.19.0 or newer and npm 11.10.0 or newer.
- Install with `npm ci`.
- Run the full gate with `npm run check`.
- Add focused Node test-runner coverage in `test/copy-code.test.mjs` for behavior changes.
- Shortcut changes must cover registered shortcuts, raw terminal input, modifier remapping, and repeat/release handling.
- Verify package changes with `npm pack --dry-run` and `npm run smoke-package`.
- Never invoke editors with `shell: true` or generic shell interpolation. Use direct executable arguments except for the
  reviewed Windows path, which builds an explicitly escaped `cmd.exe /d /s /c` argument vector.
- Preserve fenced-code whitespace and keep clipboard success wording accurate to the native or best-effort OSC 52 path.

## Repository hygiene

- Keep temporary agent output under `.scratch/`; it is not committed.
- Do not commit `.pi/`, `.pi-subagents/`, `.impeccable/`, package archives, or local agent overrides.
- Keep normal Markdown formatted with Prettier at 120 columns.
- Keep workflow actions pinned to immutable commit SHAs with version comments and minimal permissions.
- `.github/copilot-instructions.md` is a relative symlink to this file. On Windows checkouts with `core.symlinks=false`,
  Git may materialize it as a one-line `../AGENTS.md` file; `AGENTS.md` remains canonical.
- Never publish, push tags, create releases, or change repository/npm settings without explicit maintainer approval.

## Contributor checks

Before declaring a change complete, run:

```bash
npm ci
npm run check
npm audit --omit=dev
npm pack --dry-run
npm run smoke-package
git diff --check
```

For user-visible command, picker, editor, or shortcut changes, also exercise the extension through `pi -e "$(pwd)"` when
an interactive terminal is available and record the result.
