# pi-copy-code

A [pi](https://pi.dev/) package that makes assistant code blocks easier to copy from the TUI.

## What it does

- Adds `/copy-code`.
- Adds `ctrl+alt+c` as the same action.
- Copies code from the latest assistant message without TUI/container padding.
- If the latest assistant message has one fenced code block, it copies immediately.
- If it has multiple fenced code blocks, it opens a two-pane overlay picker:
  - left pane: `All code blocks` plus each block with language, line count, and preview text
  - right pane: live syntax-highlighted preview of the selected block
  - keys: `↑`/`↓` or `j`/`k` to move, `enter` to copy, `esc`/`q` to cancel

## Install locally

From this repository:

```bash
pi install /home/aaron/src/github.com/aasmall/pi-copy-code
```

Then reload pi:

```text
/reload
```

For a one-off run without installing:

```bash
pi -e /home/aaron/src/github.com/aasmall/pi-copy-code
```

## Avoid duplicate commands during development

If you still have the prototype global extension at `~/.pi/agent/extensions/copy-code`, pi may register two `/copy-code`
commands. Disable or move the prototype before installing this package:

```bash
mv ~/.pi/agent/extensions/copy-code ~/.pi/agent/extensions/copy-code.bak
```

## Usage

```text
/copy-code
```

or press:

```text
ctrl+alt+c
```

Hidden backwards-compatible forms are still accepted but not advertised:

```text
/copy-code all
/copy-code 2
```

## Experimental: zero-padding mouse selection

Terminal mouse selection copies rendered screen cells, so pi cannot post-process mouse-selected text. This package includes
an **experimental opt-in render patch** that removes the outer one-cell Markdown padding for fenced code-block lines before
they reach the terminal.

It is disabled by default because it monkey-patches pi's Markdown renderer. Enable only if you want normal mouse drag-copy
to copy code blocks without the extra leading cell:

```bash
PI_COPY_CODE_ZERO_PADDING=1 pi
```

The semantic `/copy-code` command does not need this patch.

## Package shape

The package uses pi's package manifest in `package.json`:

```json
{
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions/copy-code/index.ts"]
  }
}
```

Core pi packages are peer dependencies, per pi package guidance.

## Test fixture

Ask pi to emit multiple fenced blocks, then run `/copy-code`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: test
data:
  script.sh: |
    if [ -n "$FOO" ]; then
      echo "$FOO"
    fi
```

```python
from dataclasses import dataclass

@dataclass
class Config:
    host: str
    port: int = 8080

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}"
```
