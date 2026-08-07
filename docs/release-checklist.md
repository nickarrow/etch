# Release checklist

Steps for every release, in order.

1. `npm run lint` and `npm run build` are clean locally.
2. Bump the version: `npm version patch|minor|major`. This runs
   `version-bump.mjs`, which syncs `manifest.json`, `package.json`, and
   `versions.json`. The committed `.npmrc` keeps the git tag bare, so the
   tag matches the manifest version exactly, with no `v` prefix.
3. Push the commit and the tag. The release workflow builds `main.js`,
   generates build-provenance attestation over `main.js` and `styles.css`,
   and creates a draft release with `main.js`, `manifest.json`, and
   `styles.css` attached.
4. Edit the draft: release notes are one plain line per user-visible
   change. For a beta, tick "Set as a pre-release". Publish. Drafts are
   invisible to BRAT and to the directory; only publishing makes a release
   installable.
5. Verify: BRAT installs the new version on the iPad, and the release
   passes the smoke test for whatever changed.
6. Before directory submission (and for any release while unlisted): run
   the community dashboard preview scan and fix what it flags.

Each run is recorded below: date, version, deviations if any.

## Runs

None yet.
