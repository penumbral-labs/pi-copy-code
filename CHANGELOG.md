# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] - 2026-08-10

### Added

- Added wraparound fuzzy search and browsing across the last ten assistant responses with a scrolling response tab
  strip.
- Added `Ctrl+Super+C` support and handling for terminals that remap a physical Ctrl+Meta+C chord to Alt+C.
- Added strict type checking, package-content verification, Node 22.19.0 and 24 CI, advisory latest-Pi testing,
  Dependabot, and release-triggered npm publishing with provenance.
- Added Ctrl+C cancellation for the picker and editor overlay before process handoff.

### Changed

- Raised the supported Node.js version to 22.19.0 and the development Pi baseline to 0.84.1.
- Limited the npm tarball to its five public files with no runtime dependencies or install scripts.
- De-indented structurally indented fenced blocks while preserving code indentation.
- Made OSC 52 clipboard reporting explicitly best effort, limited it to TTY output, and restored the full TUI render
  after sending it.

### Fixed

- Prevented shortcut re-entry and isolated copy-code guards by session across command and terminal entry points.
- Stored editor content in a private unique temporary directory and removed it after editing.
- Contained editor setup, file, process, and cleanup errors so the overlay completes exactly once without restarting a
  TUI that was never stopped.
- Passed editor arguments without `shell: true`; on Windows, spawned only `.exe` and `.com` targets directly and routed
  extension-less names and `.cmd`/`.bat` shims through the explicit escaped `cmd.exe /d /s /c` path.

## [0.2.0] - 2026-05-15

### Added

- Added the npm publish workflow with trusted publishing and configured the package for public npm publishing.

## [0.1.0] - 2026-05-13

### Added

- Added the initial `/copy-code` command and `Ctrl+Alt+C` shortcut.
- Added fenced-code extraction, immediate copying for a single block, a picker for multiple blocks, native clipboard
  commands, and OSC 52 fallback.
- Added edit-before-copy support using `$VISUAL` or `$EDITOR`.
- Added the initial public npm package metadata for `@penumbral-labs/pi-copy-code`.

### Changed

- Removed the experimental render monkey patch before the initial release.

[0.3.0]: https://github.com/penumbral-labs/pi-copy-code/compare/45c67ce...v0.3.0
[0.2.0]: https://github.com/penumbral-labs/pi-copy-code/compare/5c6b4e8...45c67ce
[0.1.0]: https://github.com/penumbral-labs/pi-copy-code/tree/5c6b4e8
