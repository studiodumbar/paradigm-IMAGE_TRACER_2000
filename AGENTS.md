# Project instructions

## Release versioning

All coding agents must maintain app release numbers and release notes when making user-facing changes.
Use the project convention `0.big update.small fix.bug fix`.
The leading `0` stays fixed.

- **Big update:** increment the second number for a substantial feature or workflow change, and reset the last two numbers to `0`.
- **Small fix:** increment the third number for a minor improvement, and reset the last number to `0`.
- **Bug fix:** increment only the fourth number when correcting broken behavior.

Use a version explicitly supplied by the user when one is provided.
Before editing, read `src/lib/releases.js` for the latest version and `README.md` for the documented convention.
For each release, add brief user-facing notes to `src/lib/releases.js`, newest first, and keep the release entry in `README.md` consistent.
Keep related work under its assigned release; do not bump again for tests, documentation, or follow-up corrections within the same release.
The app's four-part version is separate from the npm package's three-part version.

## Verification and generated output

Reproduce bugs in the browser before changing code, then add meaningful regression coverage.
Run `npm test` and `npm run build` after changes.
The build regenerates the self-contained `docs/index.html`; never edit it manually.
Never manually edit `CHANGELOG.md` files or other generated files.
