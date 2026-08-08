# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] - Unreleased

### Added

- Added cross-response code block browsing with a scrolling response tab strip and wraparound search.
- Added `Ctrl+Super+C` support alongside remapped `Ctrl+Meta+C` shortcut handling.
- Added type checking, package verification, a supported-Node CI matrix, dependency updates, and release-triggered npm
  publishing with provenance.

### Changed

- Raised the supported Node.js version to 22.19.0 and narrowed the published package to its five public files.

### Fixed

- Prevented shortcut re-entry and isolated copy-code guards by session across command and terminal entry points.

## [0.2.0]

### Added

- Added edit-before-copy support using an external editor.
- Added npm package metadata and trusted publishing for the `@penumbral-labs/pi-copy-code` package.

### Changed

- Removed the experimental render monkey patch and tightened editor command handling for the public package.

## [0.1.0]

### Added

- Initial `/copy-code` command and `Ctrl+Alt+C` shortcut.
- Added fenced-code extraction, direct copying for a single block, a picker for multiple blocks, and native clipboard
  commands with OSC 52 fallback.
