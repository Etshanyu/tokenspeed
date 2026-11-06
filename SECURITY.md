# Security Policy

## Supported versions

Security fixes are applied to the latest `0.1.x` release. Older development versions should upgrade before reporting compatibility issues.

## Reporting a vulnerability

Do not open a public issue containing credentials, private logs or an exploitable proof of concept. Use the repository host's private vulnerability-reporting feature when available, or contact the maintainers privately through the repository profile.

Include:

- affected version and operating system;
- the smallest synthetic reproduction possible;
- impact and any suggested mitigation;
- whether upstream logs, cache files or terminal output are involved.

Please allow maintainers reasonable time to reproduce and release a fix before public disclosure.

## Security boundaries

Token Speed reads local Claude Code, Codex and DSH logs and writes derived metadata to a user-writable cache. It is not a sandbox for hostile local files and should not be run with elevated privileges.

Important review areas include terminal escape injection, symlink and path handling, very large or compressed logs, malformed cache data, file-watcher resource use and accidental disclosure in screenshots or fixtures.

Token Speed does not intentionally transmit session data over the network. Dependency installation and npm publication are separate networked operations.
