# Etch

Mark up vault PDFs with Apple Pencil in Apple Preview. The ink lands in the
same vault file, so it shows up everywhere the PDF appears and travels with
the file when it syncs or moves.

## Limitations

- iPad only. On iPhone and desktop the plugin loads inert and its commands
  stay hidden.
- Requires iPadOS 26 or later and Obsidian 1.13.4 or later. Tested on
  iPadOS 26.5.2 with Obsidian 1.13.4.
- Local vaults only ("On My iPad"). Files anywhere else, including iCloud
  Drive vaults, are declined with a notice.
- Apple Preview must be installed. iPadOS allows deleting it.
- PDFs only in this release. Image support is planned.
- On the Files viewer route, markup saves when you tap its check mark.
  Leaving Files without that tap leaves the file unchanged until you return
  and tap it.

## How it works

Etch draws nothing and stores nothing. A tap resolves the file's absolute
on-disk path from Obsidian's public API, validates it, percent-encodes it
into a URL, and navigates exactly once; iPadOS then opens the document in
Preview (`file://`, the default route) or the Files viewer
(`shareddocuments://`), and a third route raises the system share sheet
through an internal Obsidian function. Two disclosures apply: how iPadOS
handles these URLs from an app webview is undocumented behavior with no API
contract, and the share-sheet function is an undocumented Obsidian internal.
If the OS or Obsidian ever changes any of this, Etch shows an error notice
and stays put; it never navigates on a path it could not validate. In-place
writes were established with hash-verified device evidence; see
`docs/spike/FINDINGS.md`.

## Usage

Three ways to start, all equivalent:

- tap the pencil icon on an open PDF view,
- choose "Mark up with Pencil" from a PDF's long-press menu,
- run the "Mark up with Pencil" command from the palette, which can also be
  placed on the mobile toolbar.

Draw with the Pencil, switch back to Obsidian, and the PDF view and any
embeds of it refresh on their own.

## Settings

- Handoff route. "Preview (default)" opens the file directly in Preview.
  "Files viewer" opens it in Files, where Markup and Open in Preview are one
  tap each. "Share sheet" raises the system share sheet; choose Preview
  there. If the default route ever stops working after an OS update,
  switching to Files viewer is the fallback.
- Debug logging. Writes a verbose log to the plugin folder and enables the
  "Verify last handoff" command, which re-hashes the last handed-off file
  and reports whether its content changed. When off, errors go to the
  console only.

## Data safety

Etch hands Preview the real vault file, and Preview rewrites it in place.
Obsidian's File Recovery does not snapshot binary attachments, so keep your
own backup of any PDF you cannot afford to lose. Etch itself only reads
your files: verification hashes bytes, and its settings and debug log live
in the plugin's own folder. Etch makes no network requests, which is
verifiable in the source.

## Install

Etch is not yet in the community plugin directory. Until it is listed:

- BRAT: install the BRAT community plugin and add `nickarrow/etch` as a
  beta plugin. BRAT installs the latest published release or pre-release.
- Manual: copy `main.js`, `manifest.json`, and `styles.css` from a release
  into `<vault>/.obsidian/plugins/etch/`, then enable Etch under community
  plugins.

## License

0BSD. See `LICENSE`.
