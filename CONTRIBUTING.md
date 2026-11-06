# Contributing

Thanks for improving Token Speed. By contributing, you agree that your contribution is licensed under the project's MIT License.

## Setup

Use Node.js 20 or newer:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Before submitting a change, also run `npm pack --dry-run` when packaging or build files changed.

## Data fixtures

- Use synthetic or fully anonymized logs.
- Never submit real prompts, completions, source code, tokens, credentials, private project paths or session caches.
- Keep fixtures minimal and document the upstream shape they represent.
- Add tests for malformed, missing and partially written fields when changing a parser.

## Metric changes

Accuracy is more important than a visually complete dashboard.

- Do not invent per-request records from session totals.
- Do not mix cumulative DSH output into bounded activity buckets.
- Document every duration inference and keep estimated metrics labeled as estimates.
- Update tests and `docs/DATA.md` when semantics change.

## UI changes

- Preserve keyboard operation, panel alignment and the solid-number style.
- Check English and Chinese at 80, 100, 120 and 160 columns where relevant.
- Sanitize terminal text originating in log files.
- Avoid animation that makes values hard to read or causes flicker.

## Pull requests

Describe the problem, the chosen behavior and the verification performed. Include before/after output for visual changes. Small, focused pull requests are easier to review.

## Releases

Maintainers should follow [docs/RELEASING.md](docs/RELEASING.md). Do not publish packages or push version tags from an unverified working tree.
