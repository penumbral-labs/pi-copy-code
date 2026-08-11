# Contributing

## Set up a checkout

This project requires Node.js 22.19.0 or newer and npm 11.10.0 or newer.

```bash
git clone https://github.com/penumbral-labs/pi-copy-code.git
cd pi-copy-code
npm ci
npm run check
```

Pi loads `extensions/copy-code/index.ts` directly; there is no build output. Keep runtime dependencies at zero and keep
Pi core packages as wildcard peer dependencies. Development versions are pinned so local and required CI checks use Pi
0.84.1.

## Make and verify changes

Add focused coverage in `test/copy-code.test.mjs` for behavior changes. Shortcut changes must test both registration and
raw terminal-input handling, including press versus repeat/release behavior and any modifier remapping involved.

Run the contributor gate:

```bash
npm ci
npm run check
npm audit --omit=dev
npm pack --dry-run
npm run smoke-package
git diff --check
```

`npm run check` runs strict TypeScript checking, the complete test suite, and exact package-content validation.
`npm pack --dry-run` must list only `package.json`, `extensions/copy-code/index.ts`, `README.md`, `CHANGELOG.md`, and
`LICENSE`. The clean package smoke test packs a real tarball into a temporary directory, installs it without development
dependencies, supplies `jiti` from the harness, loads the packed TypeScript source, and checks command and shortcut
registration.

Before submitting UI or shortcut changes, exercise them in an interactive terminal:

```bash
pi -e "$(pwd)"
```

Ask Pi for at least two fenced code blocks, run `/copy-code`, verify picker navigation and copied text, and try every
shortcut affected by the change. Record the terminal, OS, Pi version, package version, relevant keyboard protocol, and
any Ctrl/Command/Meta remapping in the pull request. If interactive Pi is unavailable, state that and record the closest
isolated loader or TUI substitute used.

Pull requests should stay focused, update user documentation and the changelog when behavior changes, and complete the
pull request template. CI runs required checks on Node.js 22.19.0 and 24; the floating latest-Pi lane is advisory.

## Release process

Publishing is an explicit GitHub Release operation. A merge to `main` never publishes.

Before the first real release, repository maintainers must:

1. Configure the GitHub environment named `release` so it carries the intended `v*` deployment-tag restrictions and
   required reviewers. If the environment does not yet exist, GitHub can create it when the job starts; absence alone
   does not block publishing, so configure its protections before relying on it.
2. Configure npm trusted publishing for this repository, exactly `.github/workflows/publish.yml`, and the `release`
   environment. Remove any legacy npm publish token after trusted publishing is confirmed. The real publish fails until
   this OIDC trust is configured.
3. Enable GitHub private vulnerability reporting before relying on the private advisory channel or making the first
   public release. `SECURITY.md` and the issue contact link intentionally direct reporters to that channel, but this
   repository setting must be enabled separately.
4. Require the `CI / check` job on `main` and require SHA-pinned Actions in repository settings.

To rehearse a release, run the `Publish to npm` workflow manually. Choose the branch or tag in GitHub's **Run workflow**
ref selector and enter the expected `vX.Y.Z` tag. The workflow checks out the selected immutable `github.sha`; the `tag`
input is only an assertion that must equal `v` plus the checked-out `package.json` version. It does not select or
resolve another ref. Validation runs the contributor gate, production dependency audit, and clean package smoke test
against the pinned Pi development baseline. Manual dispatch also runs `npm publish --dry-run`; it never writes to the
npm registry or runs the publish job.

To publish:

1. Merge a pull request that updates `package.json`, `package-lock.json`, and `CHANGELOG.md` for the release.
2. Confirm required CI is green and the release commit contains only the intended five-file package.
3. Create and publish a GitHub Release whose tag is exactly `vX.Y.Z` for package version `X.Y.Z` and whose target is the
   intended commit. A prerelease GitHub Release runs validation but never publishes to npm.
4. The non-prerelease event validates the tag and package from immutable `github.sha`, then the isolated `publish` job
   enters the `release` environment and runs `npm publish --provenance` with OIDC.
5. Verify the npm version, provenance, tarball contents, and release notes.

If validation fails before npm publishes, delete or correct the GitHub Release and tag before trying again. If an
incorrect package has already been published, deprecate that version and issue a corrected patch release; do not
unpublish it.
