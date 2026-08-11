# Etch

Native Apple Pencil markup for Obsidian PDFs and images.

One tap opens a vault PDF or image for Apple Pencil markup. Draw with the
Pencil, tap the check mark, and the ink is in the same vault file: visible
everywhere the file appears, and it travels with the file when it syncs or
moves.

## Limitations

- iPad only. On iPhone and desktop the plugin loads inert and its commands
  stay hidden.
- Requires iPadOS 26 and Obsidian 1.13.4 or later. Tested on iPadOS 26.5.2
  with Obsidian 1.13.4. Etch rests on undocumented iPadOS behavior, so each
  new iPadOS major is unverified until it has been re-checked.
- Local vaults only ("On My iPad"). Files anywhere else, including iCloud
  Drive vaults, are declined with a notice.
- Apple's Preview app loses Pencil markup on long PDFs, so Etch does not use
  it for them. On an iPad Pro running iPadOS 26.5.2, an 18 MB and a 243 MB
  document, both several hundred pages, kept their markup through the Files
  viewer every time and lost it through Preview every time. Etch defaults to
  the Files viewer, and sends any file of 4 MB or more there even when Preview
  is the chosen route. A short document that happens to have many pages is the
  gap in that rule: it stays on Preview, so use the Files viewer route if you
  work in one.
- Apple Preview must be installed for the Preview route; iPadOS allows
  deleting it, per Apple's documentation. What happens if Preview is absent is
  unverified.
- PDF, PNG, JPG, and JPEG files. Other formats are left alone. HEIC and TIFF
  are not formats Obsidian displays, so they are out of reach. SVG is excluded
  for good, since it is text and what a markup tool writes back into one is
  unverified.
- The command works on an open file, so the mobile toolbar is not a usable
  place for it: Obsidian 1.13.4 does not show that toolbar over a PDF view.
  Use the pencil icon, the file menu, or the command palette.
- Buttons on files embedded inside a note are not in this release.
- In the Files viewer, markup saves when you tap the check mark. Leaving
  without that tap leaves the file unchanged until you return and tap it
  (observed on iPadOS 26.5.2 with Obsidian 1.13.4).

## Why a handoff

Drawing tools inside Obsidian work on a canvas in the webview, and the
webview is the boundary: PencilKit, the ink framework behind Apple's own
apps, is native UIKit, and no plugin can ship it. Etch gets PencilKit by
handing the file to a viewer that has it. Obsidian keeps the vault, iPadOS
brings the Pencil, and the markup lands in the PDF as ordinary annotations
that later sessions can re-edit or erase. Strokes on an image were also
re-editable in a later session on iPadOS 26.5.2, which is an observation
rather than a promise: how Preview stores them is unverified, and Etch does
not depend on it.

## How it works

Etch is only the bridge. A tap resolves the file's absolute on-disk path
from Obsidian's public API, validates it, percent-encodes it into a URL, and
navigates exactly once; iPadOS then opens the document in the Files viewer
(`shareddocuments://`, the default route) or in Preview (`file://`). Etch makes
no internal Obsidian API calls: both routes are ordinary web navigation, and
the path is parsed from what a public API returns. One disclosure applies:
how iPadOS handles these URLs from an app webview is undocumented behavior
with no API contract. If the OS or Obsidian ever changes any of this, Etch
shows an error notice and stays put; it never navigates on a path it could
not validate. In-place writes were established with hash-verified device
evidence; see `docs/spike/FINDINGS.md`.

## Usage

Three ways to start, all equivalent:

- tap the pencil icon on an open PDF or image,
- choose "Mark up with Pencil" from the file's long-press menu,
- run the "Mark up with Pencil" command from the command palette.

The file opens in the Files viewer. Tap Markup, draw with the Pencil, then tap
the check mark, which is what saves. Switch back to Obsidian and the ink is in
the file. That viewer also offers "Open in Preview"; it is worth avoiding,
since Preview is where long documents lose their markup.

On the Preview route instead, draw with the Pencil and switch back to
Obsidian; there is nothing to tap, and Preview saves a moment after you leave.
Large PDFs still open in the Files viewer, with a notice saying why.

After a markup, the PDF view and any
embeds of it refresh on their own (observed on iPadOS 26.5.2 with Obsidian
1.13.4; see `docs/spike/FINDINGS.md`). Images need help with that: Obsidian
keeps serving the picture it already cached, so Etch gives a changed image a
fresh address wherever it is drawn, which brings the new ink into view
without restarting the app (mechanism established on iPadOS 26.5.2; see
session 6 in `docs/spike/FINDINGS.md`). If Obsidian restarts while you are
away, Etch re-checks the file on the next launch and shows a notice if the
markup landed.

## Settings

- Handoff route. "Files viewer (default)" opens the file in the Files viewer,
  where Markup is one tap and the check mark saves. "Preview" opens it
  directly in Preview, which is smoother on small files since it saves without
  a tap, and any file of 4 MB or more still goes to the Files viewer. If one
  route ever stops working after an OS update, the other is the fallback.
- Debug logging. Writes a verbose log to the plugin folder and enables the
  "Verify last handoff" command, which re-hashes the last handed-off file
  and reports whether its content changed. When off, errors go to the
  console only. Verification reads the whole file to hash it, so on a very
  large file it can be unavailable; the handoff still happens, and a notice
  says the check was skipped.

## Data safety

Etch hands the viewer the real vault file, and the viewer rewrites it in
place. Obsidian's File Recovery does not snapshot binary attachments, so keep
your own backup of any file you cannot afford to lose. This matters more for an
image than for a PDF: PDF ink arrives as annotation objects a later session
can erase, while an image comes back as a new picture. Your markup never
lives in Etch: it is written into the file itself, readable in any app that
opens that format, so uninstalling Etch loses nothing. Etch itself only reads
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
