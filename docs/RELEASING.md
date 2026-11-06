# Release checklist

1. Confirm the working tree contains only intended changes and no real logs, caches or private screenshots.
2. Review `CHANGELOG.md`, package version and supported Node versions.
3. Run:

   ```bash
   npm ci
   npm run typecheck
   npm test
   npm run build
   npm pack --dry-run
   ```

4. Inspect the tarball with `npm pack`, install it in a clean temporary prefix, and run `tokenspeed --help`, `--version` and a synthetic-data smoke test on each supported OS.
5. Add the actual `repository`, `bugs` and `homepage` URLs to `package.json` once the public remote is known; do not use placeholders.
6. Commit and tag the release using the project's normal review process. Never tag an unverified working tree.
7. Publish to npm only with the package owner's credentials and `npm publish --access public`. Verify the package page and clean global installation afterward.
8. Create the release notes and attach only sanitized screenshots or demonstrations.

The canonical repository is `https://github.com/Etshanyu/tokenspeed`. Keep release tags signed off by the project owner and never publish automatically from an unverified working tree.
