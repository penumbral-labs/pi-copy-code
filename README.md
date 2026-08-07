# pi-copy-code

A [pi](https://pi.dev/) package for copying fenced code blocks from assistant messages without terminal selection
padding.

`pi-copy-code` adds one command and two shortcuts:

- `/copy-code`
- `ctrl+alt+c`
- `ctrl+super+c` (`Ctrl+Meta+C` / `Ctrl+Command+C`)

It reads recent assistant messages, extracts fenced code blocks, and copies the raw code text to your clipboard. If
there is more than one block (or more than one recent message with code), it opens a small two-pane picker with a live
preview. From the picker you can page back through prior responses without leaving the overlay.

## Features

- Copy raw fenced code instead of rendered terminal cells.
- Preserve whitespace-sensitive YAML, shell, Python, and heredoc indentation.
- Copy one block immediately when there is only one block in one message.
- Choose between multiple blocks with a preview picker.
- Page back through the last 10 assistant responses that contain code, right from the picker.
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

or press either shortcut:

```text
ctrl+alt+c
ctrl+super+c
```

Pi calls the Meta/Command modifier `super`. Super-modified shortcuts require a terminal that reports the modifier
separately, such as one using the Kitty keyboard protocol.

Edit before copying:

```text
/copy-code edit
```

When multiple blocks or messages are available, the picker opens:

- `↑` / `↓` or `j` / `k` — move block selection within the current response
- `→` or `tab` — walk back through older responses; `←` or `shift+tab` — walk toward the current response (only when
  more than one response has code; wraps around at the ends)
- `enter` — run the default action
  - `/copy-code`: copy
  - `/copy-code edit`: edit, then copy
- `e` — edit selected block, then copy
- `/` — fuzzy search blocks in the current response
- `esc` or `q` — cancel

When more than one recent response has code, a horizontal tab strip runs across the top of the picker:

```text
Current │ Prev 1 │ Prev 2 │ Prev 3 ›
```

The newest response is `Current` on the left; older responses count back as `Prev 1`, `Prev 2`, … to the right. The
picker starts on `Current`. Press `→` (or `tab`) to walk back through older responses and `←` (or `shift+tab`) to come
back toward `Current`; arrowing past either end wraps around. The strip scrolls horizontally so the box keeps a fixed
size even with the full 10 responses; `‹` / `›` mark responses scrolled off screen.

The first picker item is `All code blocks`, which copies all blocks in the current response separated by blank lines.

Only the last 10 assistant responses that contain code blocks are surfaced. This bound keeps the picker responsive and
never sends anything to the model — it only reads session data already in memory.

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

`pi-copy-code` extracts fenced markdown blocks from recent assistant messages:

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
