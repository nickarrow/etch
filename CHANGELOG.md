# Changelog

User-visible changes to Etch, one line per change, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and semantic
versioning. Entries accumulate under Unreleased and move under a version
heading at release; the same lines become the GitHub release notes.

## 0.1.0 - 2026-08-08

### Added

- Mark up with Pencil: one tap opens a vault PDF in Apple Preview for
  Apple Pencil markup, and the ink saves into the same vault file.
- Tap points: a pencil icon on the PDF view, a file menu entry, and a
  command palette command.
- Handoff route setting: Preview (default), or the Files viewer where
  Markup and Open in Preview are one tap each.
- Debug logging toggle: a verbose on-device log, plus a Verify last
  handoff command that confirms by hash that the markup landed.
- Runs on iPad only; on other devices the plugin loads inert and the
  settings tab says why.
