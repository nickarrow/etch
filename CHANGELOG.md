# Changelog

User-visible changes to Etch, one line per change, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and semantic
versioning. Entries accumulate under Unreleased and move under a version
heading at release; the same lines become the GitHub release notes.

## Unreleased

### Added

- Images can be marked up the same way as PDFs: PNG, JPG, and JPEG files.
- The pencil icon now appears on an open image, and the file menu offers
  markup for supported images.
- A marked-up image now shows its new ink without restarting Obsidian, in
  notes and in the image view.

### Changed

- A handoff now goes ahead when verification cannot be armed, with a notice,
  instead of being refused. Hashing a very large file was the likeliest way
  to lose the handoff to a debug-only feature.

### Fixed

- A debug log line that fails to write now raises a notice instead of
  failing silently, so an incomplete log cannot read as a complete one.
- A debug logging value that is not a true or false setting now reads as
  off, instead of switching logging on.
- The pencil button on a file view now carries an explicit accessible name.
- A settings file carrying an unexpected value no longer leaves the plugin
  reporting the same verification error on every launch.
- Disabling Etch moments after it starts no longer leaves a verification
  check waiting forever.

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
