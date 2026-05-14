# pi-copy-code

A [pi](https://pi.dev/) package for copying fenced code blocks from assistant messages without terminal selection
padding.

`pi-copy-code` adds one command and one shortcut:

- `/copy-code`
- `ctrl+alt+c`

It reads the latest assistant message, extracts fenced code blocks, and copies the raw code text to your clipboard. If
there is more than one block, it opens a small two-pane picker with a live preview.

## Features

- Copy raw fenced code instead of rendered terminal cells.
- Preserve whitespace-sensitive YAML, shell, Python, and heredoc indentation.
- Copy one block immediately when there is only one block.
- Choose between multiple blocks with a preview picker.
- Copy all blocks at once from the picker.
- Edit a selected block in your external editor before copying.
- Clipboard fallback order:
  - native clipboard command when available (`pbcopy`, `wl-copy`, `xclip`, `xsel`, `clip.exe`)
  - OSC 52 terminal clipboard sequence when native clipboard commands are unavailable

## Install

From npm:

```bash
pi install npm:@penumbral-labs/pi-copy-code
```

From GitHub:

```bash
pi install git:github.com/penumbral-labs/pi-copy-code
```

Or from a local checkout:

```bash
cd /path/to/pi-copy-code
pi install "$(pwd)"
```

Then reload pi:

```text
/reload
```

For a one-off run without installing:

```bash
pi -e npm:@penumbral-labs/pi-copy-code
```

or, from GitHub:

```bash
pi -e git:github.com/penumbral-labs/pi-copy-code
```

or, from a local checkout:

```bash
pi -e "$(pwd)"
```

## Usage

Copy code from the latest assistant message:

```text
/copy-code
```

or press:

```text
ctrl+alt+c
```

Edit before copying:

```text
/copy-code edit
```

When multiple blocks are available, the picker opens:

- `↑` / `↓` or `j` / `k` — move selection
- `enter` — run the default action
  - `/copy-code`: copy
  - `/copy-code edit`: edit, then copy
- `e` — edit selected block, then copy
- `esc` or `q` — cancel

The first picker item is `All code blocks`, which copies all blocks separated by blank lines.

## External editor setup

Edit mode opens your external editor directly using `$VISUAL`, then `$EDITOR`.

For NeoVim:

```bash
export VISUAL=nvim
# or
export EDITOR=nvim
```

If neither variable is set, `/copy-code edit` shows a warning and cancels.

## What counts as a code block?

`pi-copy-code` extracts fenced markdown blocks from the latest assistant message:

````markdown
```bash
echo hello
```

~~~python
print("hello")
~~~
````

Indented markdown code blocks are not currently extracted.

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

## Development

Run tests:

```bash
npm test
```

Check publish contents:

```bash
npm pack --dry-run
```

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
