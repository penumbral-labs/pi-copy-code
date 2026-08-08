# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities through this repository's private
[GitHub Security Advisory form](https://github.com/penumbral-labs/pi-copy-code/security/advisories/new). Do not include
sensitive details in a public issue.

Include the affected package and Pi versions, operating system, terminal, clipboard path, editor configuration, steps to
reproduce, impact, and any proposed mitigation. Maintainers will use the advisory thread for follow-up and coordination.

## Security boundary

`pi-copy-code` reads assistant messages already present in the local Pi session. Selected code is sent either to a local
native clipboard command or, when that is unavailable and standard output is a TTY, to the terminal using OSC 52. Edit
mode writes the selection to private temporary storage and launches the locally configured `$VISUAL` or `$EDITOR`.

The extension does not send code to the model or a separate network service, but it does rely on the local Pi process,
the configured editor, clipboard utilities, terminal, and terminal host to handle that text. OSC 52 is best effort:
terminal support and clipboard acceptance cannot be verified by the extension.
