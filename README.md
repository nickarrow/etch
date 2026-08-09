# Etch

Native Apple Pencil markup for Obsidian PDFs.

One tap opens a vault PDF in Apple Preview. Draw with the Pencil, switch
back, and the ink is in the same vault file: visible everywhere the PDF
appears, and it travels with the file when it syncs or moves.

## Limitations

- iPad only. On iPhone and desktop the plugin loads inert and its commands
  stay hidden.
- Requires iPadOS 26 and Obsidian 1.13.4 or later. Tested on iPadOS 26.5.2
  with Obsidian 1.13.4. Etch rests on undocumented iPadOS behavior, so each
  new iPadOS major is unverified until it has been re-checked.
- Local vaults only ("On My iPad"). Files anywhere else, including iCloud
  Drive vaults, are declined with a notice.
- Apple Preview must be installed; iPadOS allows deleting it, per Apple's
  documentation. What happens if Preview is absent is unverified.
- PDFs only in this release. Image support is planned.
- The command works on an open PDF, so the mobile toolbar is not a usable
  place for it: Obsidian 1.13.4 does not show that toolbar over a PDF view.
  Use the pencil icon, the file menu, or the command palette.
- Buttons on embedded PDFs inside a note are not in this release.
- On the Files viewer route, markup saves when you tap its check mark.
  Leaving Files without that tap leaves the file unchanged until you return
  and tap it (observed on iPadOS 26.5.2 with Obsidian 1.13.4).

## Why a handoff

Drawing tools inside Obsidian work on a canvas in the webview, and the
webview is the boundary: PencilKit, the ink framework behind Apple's own
apps, is native UIKit, and no plugin can ship it. Etch gets PencilKit by
handing the file to the app that has it. Obsidian keeps the vault, Preview
brings the Pencil, and the markup lands in the PDF as ordinary annotations
that later sessions can re-edit or erase.

## How it works

Etch is only the bridge. A tap resolves the file's absolute on-disk path
from Obsidian's public API, validates it, percent-encodes it into a URL, and
navigates exactly once; iPadOS then opens the document in Preview (`file://`,
the default route) or in the Files viewer (`shareddocuments://`). Etch makes
no internal Obsidian API calls: both routes are ordinary web navigation, and
the path is parsed from what a public API returns. One disclosure applies:
how iPadOS handles these URLs from an app webview is undocumented behavior
with no API contract. If the OS or Obsidian ever changes any of this, Etch
shows an error notice and stays put; it never navigates on a path it could
not validate. In-place writes were established with hash-verified device
evidence; see `docs/spike/FINDINGS.md`.

## Usage

Three ways to start, all equivalent:

- tap the pencil icon on an open PDF view,
- choose "Mark up with Pencil" from a PDF's long-press menu,
- run the "Mark up with Pencil" command from the command palette.

Draw with the Pencil, switch back to Obsidian, and the PDF view and any
embeds of it refresh on their own (observed on iPadOS 26.5.2 with Obsidian
1.13.4; see `docs/spike/FINDINGS.md`). If Obsidian restarts while you are
away, Etch re-checks the file on the next launch and shows a notice if the
markup landed.

## Settings

- Handoff route. "Preview (default)" opens the file directly in Preview.
  "Files viewer" opens it in Files, where Markup and Open in Preview are one
  tap each; tap the check mark there to save before returning. If the default
  route ever stops working after an OS update, switching to Files viewer is
  the fallback.
- Debug logging. Writes a verbose log to the plugin folder and enables the
  "Verify last handoff" command, which re-hashes the last handed-off file
  and reports whether its content changed. When off, errors go to the
  console only. Verification reads the whole file to hash it, so on a very
  large PDF it can be unavailable; the handoff still happens, and a notice
  says the check was skipped.

## Data safety

Etch hands Preview the real vault file, and Preview rewrites it in place.
Obsidian's File Recovery does not snapshot binary attachments, so keep your
own backup of any PDF you cannot afford to lose. Your markup never lives in
Etch: it is written into the file as ordinary PDF annotations, readable in
any PDF app, so uninstalling Etch loses nothing. Etch itself only reads
your files: verification hashes bytes, and its settings and debug log live
in the plugin's own folder. Etch makes no network requests, which is
verifiable in the source.

## Install

Etch is not yet in the community plugin directory. Until it is listed:

- BRAT: install the BRAT community plugin and add `nickarrow/etch` as a
  beta plugin. BRAT installs the highest version published, release or
  pre-release.
- Manual: copy `main.js`, `manifest.json`, and `styles.css` from a release
  into `<vault>/.obsidian/plugins/etch/`, then enable Etch under community
  plugins.

## License

0BSD. See `LICENSE`.
