# Findings

Spike deliverable, complete. Evidence chunks under each row come from the
per-session logs archived in `logs/` (originally collected as `SPIKE-LOG.md`
in the test vault).

## Test conditions

| | |
| --- | --- |
| iPadOS version | 26.5.2 |
| Obsidian version | 1.13.4 (353) |
| Vault location | local ("On My iPad") |
| Test PDF | `Kal-Arath Sheet.pdf` |
| Manual baseline re-confirmed? | Yes — 2026-08-05. See note below. |
| Plan B pre-check (Jot) | Done — poor. See note below. |

**Manual baseline (re-confirmed 2026-08-05).** Flow: test PDF in the local
vault, embedded in a note. Files app → On My iPad → Obsidian → vault → opened
the PDF → wrote on it with the Pencil → switched straight back to Obsidian.
The ink was already visible in Obsidian, including inside the note embed, with
no reload step. This confirms, on this device: the vault is exposed to Files
(`UIFileSharingEnabled`), the system PDF editor writes the original vault file
in place, and Obsidian picks up the external change immediately. Exposure and
in-place plumbing work; only the in-app trigger is missing. (Ink appearing in
Obsidian is positive proof of an in-place write — a copy would have left the
vault file untouched, and caching can only hide a change, not fabricate one.)
Secondary finding for the goal UX: on return from the external editor, the ink
is visible with no refresh step. Editing app confirmed to be Preview (the
iPadOS 26 default handler for PDFs opened from Files) — so the baseline
exercises the exact PencilKit editor the spike targets.

**Plan B pre-check (Jot).** Before any handoff experiments, the Jot community
plugin was installed on the test iPad and used to write on a PDF. Result: a poor
experience — the writing feel is nowhere near PencilKit, and the flow has
multiple bugs in day-to-day use. That is on top of Plan B's structural limits
(ink lives in a sidecar; the PDF itself is never modified, so the markup does
not travel with the file). The canvas-overlay fallback is weaker in practice
than assumed, which raises the value of every tier this spike can reach.
**Spike is a go.**

## Results

| Experiment | Tier reached | What actually happened |
| --- | --- | --- |
| `probe` | — | Ran clean on-device 2026-08-06 (`logs/2026-08-06T0044Z-probe-run1.md`). Caught a path bug that would have false-negatived the whole e3/e5 family; see evidence below. |
| `e1a` Capacitor Share | Dead — settled without an attempt | Probe: `hasSharePlugin: false`. Obsidian's iOS bundle does not register Capacitor's Share plugin, so there is nothing to call. Only Obsidian shipping it natively could revive this. |
| `e1b` file-menu Share | Sheet opens; superseded by e1d/e4 | Harvested "Share" item invoked → share sheet appeared; no verdict captured in session 2 (in-app sheet never blurs the webview, and the next arm read an identical hash — nothing written in its window). Session 3 proved the underlying plumbing in place via e1d and e4, so no separate retest is needed. |
| `e1c` command scan | — | Full registry dumped (159 commands). The gem: core command `open-with-default-app:open` is titled **"Share"** on iOS — Obsidian mobile's Share and `openWithDefaultApp` are the same plumbing. Spawned e1d. |
| `e1d` Share via command | **Tier 3 — CONFIRMED** | `executeCommandById('open-with-default-app:open')` → `true` → share sheet (Preview listed behind the "more apps" step, not in the front row) → Preview opened the vault file **in place**: sha `748a19b6aae4` → `3e7673425fb2`, +11,375 bytes, write landing as the user returned. Obsidian's own mobile Share is an in-place handoff. |
| `e2` Web Share | Available; Tier 2 ceiling by construction | `canShare({files})` → true, sheet opens, share completes (run 1 cancelled → clean `AbortError`; run 2 completed via Copy in ~2 s, no Preview involved). Not pursued further — bytes mean copy, and e3 reached Tier 3 the same evening. |
| `e3a` shareddocuments raw | Skipped deliberately | Filename contains a space → the unencoded URL is malformed by construction. Nothing to learn. |
| `e3b` shareddocuments encoded | **Tier 3 — CONFIRMED**, three witnessed writes | `window.location.href = shareddocuments:///<abs, encoded>`. Session 2: `fbb45bb75a84` → `f55c1343487e` (+67,722). Session 3: `2e79e49af023` → `a854a3883559` (+129,847). UX (attentive re-run): lands **directly inside the document** in Files' viewer — PencilKit Markup button immediately available, plus an "Open in Preview" button. One tap from Obsidian to ink. |
| `e3c` shareddocuments anchor | **Tier 3 — CONFIRMED** | Synthetic anchor click, same URL → independent second confirmation: **sha `f55c1343487e` → `1c3ef55a2703`, size 608774 → 698263.** |
| `e3d` file:// URL | **Tier 3 — CONFIRMED, sterile** | Expected negative, turned out to be the best UX in the spike: `window.open(file://<abs>)` launches **the Preview app directly, from cold**. Sterile run (device reboot → fresh Obsidian → e3d only): straight into Preview, drawing available immediately, Markup gave full PencilKit, and the vault file changed in place (`c58db0507f9c` → `2e7b341bfce0`, +80,764 bytes). Earlier anomalies (sessions 2–3) were Preview consolidation saves caught by neighbouring measurement windows; all are excluded from evidence and explained. |
| `e3e` App.openUrl native bridge | Dead | `"App.openUrl()" is not implemented on ios`, twice. Capacitor 3+ moved `openUrl` to the AppLauncher plugin, which Obsidian does not bundle. |
| `e4` openWithDefaultApp | **Tier 3 — CONFIRMED** | Single call `openWithDefaultApp("Kal-Arath Sheet.pdf")` → `{}` → share sheet → Preview (behind "more apps") → **in-place write**: sha `3e7673425fb2` → `c58db0507f9c`, +10,133 bytes. Session 2's "Preview does nothing" is attributed to the double-queued-sheet harness bug, since fixed. This is the closest thing to an intended API for the job — undocumented, but an Obsidian core function. |
| `e5` Shortcuts | Not run — deprioritised | e3b/e3c reach Tier 3 with zero setup cost and no app bounce, so the Shortcuts route's costs buy nothing. Revisit only if the scheme route regresses. |
| Embed-context handoff (session 5) | **Works** | Target resolved from the active note's embed list (public `metadataCache` API, logged as evidence) → e3d from the note opened the right PDF → in-place write (`2e7b341bfce0` → `4630cc670ea6`) → **both** embeds of that PDF refreshed; a second embedded PDF stayed byte-identical (control verified by Mac-side hash). The real-world "note with embedded sheet" flow, proven. |
| Image handoff (session 5) | **Works — with a refresh caveat** | Same e3d route on a PNG, three witnessed in-place writes (`1552f1393c5f` → `6196c236ea96` → `f57964a350c4` → `00ba7c92449f`). Preview opened it exactly like the PDF, markup worked, earlier strokes erasable. But Obsidian served the **stale image until full app restart** — file close/reopen did not help. See the refresh-leg section. |
| `e6c` image cache-bust (session 6) | **Fix proven** | Bumping rendered image `src` URLs with a throwaway query param refreshed stale pixels instantly, no restart — twice: first the open image view, then a freshly rendered note embed that had come back stale off the same cached URL. Conclusion: the fix must apply at **render time**; one-shot refreshes don't survive re-renders. |

### Probe run 1 — evidence highlights (2026-08-06)

Archived at `logs/2026-08-06T0044Z-probe-run1.md`.

- **`getFullPath()` is Documents-relative on iOS** (`Longhand-test-vault/Kal-Arath Sheet.pdf`), not absolute. URLs built from it point at a nonexistent root path — a guaranteed false Tier 0 for every scheme experiment, caught before any of them ran. The harness now resolves an absolute path (undocumented adapter methods first, then a parse of the public `getResourcePath()` URL) and `probe` logs every candidate so the device shows which are real.
- **The absolute container path exists and leaks through public API**: `/var/mobile/Containers/Data/Application/<UUID>/Documents/<vault>/<file>`, visible inside `getResourcePath()`. The UUID changes on app reinstall — never persist it.
- **Capacitor `Share` plugin is absent** → e1a dead (see Results).
- **Capacitor `App` plugin is registered** → new experiment `e3e`: `App.openUrl` opens a URL from native code (`UIApplication.open`), bypassing WKWebView navigation policy entirely — a different mechanism from every window-level e3 variant.
- **`openWithDefaultApp` exists at runtime on iOS** despite being absent from the public types → e4 upgraded from "confirm absence" to a live question.
- **`navigator.share` + `canShare` present** → e2 runnable. **`app.commands` reachable (155 commands)** → e1c runnable.

### Session 2 — evidence highlights (2026-08-06)

Archived at `logs/2026-08-06T0103Z-session2-e1c-to-e4.md`. The witnessed hash
chain, all at the same vault path `Kal-Arath Sheet.pdf`:

| Event | sha256 (first 12) | size | mtime (ms) |
| --- | --- | --- | --- |
| State at arming of e1b, e2, e3b | `fbb45bb75a84` | 541052 | 1785975532000 |
| After e3b → Preview → Pencil | `f55c1343487e` | 608774 | 1785978612021 |
| After e3c → Preview → Pencil | `1c3ef55a2703` | 698263 | 1785978653924 |
| Preview deferred save, during e3d's window | `2e79e49af023` | 594185 | 1785978673345 |

- **The spike question is answered yes**: two independent one-tap mechanisms
  (`window.location.href` and a synthetic anchor click on a
  `shareddocuments://` URL) produced witnessed in-place writes to the vault
  file, with PencilKit ink via Preview.
- The trigger itself is **standard web navigation** — no private API. The only
  private surface in the production path is absolute-path resolution.
- The final write shrank the file by 104 KB while changing content, and landed
  13 ms after a check read the pre-write state — consistent with Preview
  consolidating incremental saves on close, and the reason e3d's verdict is
  attributed to Preview, not to `file://` navigation.
- Growth pattern of the two annotation saves (+67 KB, +89 KB) is consistent
  with PDF incremental saves — further evidence the writes were Preview's.

### Session 3 — evidence highlights (2026-08-06)

Archived at `logs/2026-08-06T0146Z-session3-retests.md`. Attentive re-runs of
every open question, all verdicts witnessed. The hash chain:

| Event | sha256 (first 12) | size |
| --- | --- | --- |
| Session start (after two vault swaps) | `2e79e49af023` | 594185 |
| After e3b → Files viewer → Markup | `a854a3883559` | 724032 |
| e3d run 1 — anomalous, excluded (see below) | `390586acc0ee` | 724032 |
| Preview consolidation shrink between runs | `390586acc0ee` | 631218 |
| After e3d run 2 → Preview direct → Markup | `748a19b6aae4` | 647911 |
| After e1d → share sheet → Preview | `3e7673425fb2` | 659286 |
| After e4 → share sheet → Preview | `c58db0507f9c` | 669419 |
| **Mac-side re-hash of the returned vault copy** | `c58db0507f9c` | 669419 |

The final row is chain of custody: the bytes on the Mac hash to exactly what
the last on-device verdict recorded.

- **UX resolved.** `shareddocuments://` (e3b) lands directly **inside the
  document** in Files' viewer — PencilKit Markup one tap away, plus an "Open in
  Preview" button. `file://` via `window.open` (e3d) opens **the Preview app
  itself**, observed deliberately twice. The share-sheet routes (e1d, e4) work
  but hide Preview behind the "more apps" step.
- **Preview's save timing, measured**: in every session-3 return, the first
  focus check ran before the write landed (correct NO CHANGE) and the second
  check ~400 ms later caught it — write mtimes equal the check timestamps to
  the millisecond. Preview flushes on close/background, within ~½ s of
  returning. The double-fire focus check turned out to be a feature.
- **e3d run 1 excluded**: sha changed while size *and* mtime stayed frozen —
  consistent with a torn read at arm time during a Preview consolidation save,
  not with an annotation. Run 2 is clean (+16,693 bytes inside its own window),
  but Preview was warm from earlier runs; one sterile run seals the e3d claim.
- **Vault-swap artifact, explained**: the startup TOUCHED BUT NOT WRITTEN
  notice was the Finder round trip truncating mtime milliseconds
  (`…673345` → `…673000`) with sha identical. Return-leg metadata is not
  meaningful across vault swaps; the hash is why the witness hashes.

### Session 4 — sterile e3d (2026-08-06)

Archived at `logs/2026-08-06T0309Z-session4-sterile-e3d.md`.

- Conditions: all apps closed, device rebooted, Obsidian opened fresh, PDF
  active, e3d run alone.
- Armed at exactly session 3's final state (`c58db0507f9c` / 669419): the
  reboot left no pending saves and nothing touched the file between sessions.
- Observed: **Preview launched cold, straight into the document.** Drawing
  worked immediately; the Markup button gave full PencilKit; the change was
  visible in Obsidian immediately on return.
- Witnessed: `c58db0507f9c` → `2e7b341bfce0`, +80,764 bytes, write landing
  ~300 ms before the catching check — the standard save-on-close signature.
- Mac-side re-hash of the returned vault matches the final verdict exactly.
  **Route 1 is sealed.**

### Session 5 — embeds and images (2026-08-06)

Archived at `logs/2026-08-06T0330Z-session5-embeds-image.md`. Vault gained a
control PDF (byte-copy under a new name), a PNG rendered from the sheet, and a
Cornell-style note embedding the sheet twice + control + image. Harness gained
note-context target resolution (public `metadataCache` API; resolution path
logged per run).

- **Run A (from the note):** target resolved via `first supported embed of
  Session Notes.md`; Preview opened the right file; in-place write witnessed;
  both embeds of the annotated PDF refreshed immediately; the control PDF's
  embed stayed visually untouched and its bytes still hash to exactly the value
  it was created with (`2e7b341bfce0…`, Mac-verified). Bonus observation:
  markup could **erase strokes from earlier sessions** — PDF annotations are
  objects, so the round trip is non-destructively editable.
- **Run B (the PNG):** identical handoff behavior — Preview opened the image,
  markup worked, three witnessed in-place writes across the re-runs. Two
  surprises:
  - **Stale image in Obsidian.** The PDF views refresh on return; the image
    embed and image view did not — not on return, not on file close/reopen,
    only on full app restart. Reproduced twice. Likely cause: image embeds
    render by URL through the webview, and on mobile `getResourcePath()`
    carries no cache-busting query (probe evidence: the resource URL had no
    `?mtime` suffix), so the webview serves its cached bitmap until the webview
    itself is torn down. PDFs render by reading bytes, no URL cache involved.
    Plugin-fixable in principle (bump the embed `src` with a query param on the
    return leg); untested.
  - **Earlier image strokes were erasable in a later session.** Image markup
    is nominally pixel-flattening; erasability across sessions suggests
    iPadOS 26 Preview persists stroke data with the image (mechanism
    unverified — recorded as an observation, not a claim).
- **Instrument note:** run A's write changed content while size and mtime both
  stayed frozen (750183 → 750183, mtime identical to the millisecond). A
  size-and-mtime-based witness would have called this NO CHANGE; only the hash
  caught it. Preview appears to sometimes rewrite in place with preserved
  metadata — vindicates hashing as the only trustworthy signal.

### Session 6 — the image-refresh fix (2026-08-06)

Archived at `logs/2026-08-06T-session6-e6c-cache-bust.md`. Both predictions
held.

- Setup write: e3d on the PNG, in-place witnessed (`00ba7c92449f` →
  `c67d97c614c7`, +42,337 bytes), with the open image view showing stale
  pixels — the bug reproduced on demand.
- e6c run 1 (image view open): 1 vault-backed img bumped with `?spike=<ts>` →
  the new mark appeared instantly. Mechanism proven.
- Opening the note re-rendered its embed **stale** — a fresh render reuses the
  unqueried URL and hits the same cache entry. e6c run 2 (6 imgs in the DOM, 1
  vault-backed) refreshed it instantly.
- Production conclusion: the webview cache is keyed by URL and survives
  re-renders, so image freshness needs a **render-time** cache-buster (e.g.,
  an mtime-derived query on image srcs), not a one-shot refresh. PDFs need
  nothing.
- Mac-side re-hash of the returned PNG matches the final verdict exactly
  (`c67d97c614c7…`, 357,796 bytes).

## Secondary finding: the refresh leg

**PDFs: no stale bytes, ever.** Across the manual baseline, all session-3
returns, and both session-5 embed observations, ink was visible in Obsidian's
PDF views and note embeds immediately on return, with no reload step. `e6b`
was never needed. Combined with the measured save timing: by the time a user
has switched back and looked, the write has landed and the view reflects it.

**Images: stale until refreshed — and the fix is proven.** The write lands
(hash-witnessed) but Obsidian serves a cached bitmap: reproduced on demand,
file close/reopen insufficient, restart otherwise required. Session 6
confirmed root cause and remedy: the webview cache is keyed by the unqueried
resource URL, and bumping a rendered img `src` with a throwaway query param
refreshes it instantly (e6c, twice). Fresh renders reuse the cached URL, so a
production plugin must inject the cache-buster at render time. PDFs need
nothing.

## Native control probe

Only needed if the promising experiments fail. Did a plain Xcode app succeed on the same path where the plugin failed?

- If **yes**: the capability exists, the webview can't reach it → the conclusion is "needs an Obsidian core API," and it's worth filing with evidence.
- If **no**: iOS itself won't allow it from a non-document-browser app → no core API would help either.

## Private API ledger

Every internal surface this spike leans on, and its fragility cost. Access is
quarantined in `src/native.ts`, except `rebuildView`, which lives next to its
only caller in `main.ts`.

| Surface | Used by | Status |
| --- | --- | --- |
| `app.commands` / `executeCommandById` | e1c | Absent from public types |
| Synthesised `file-menu` event + reading `Menu.items` | e1b | Listening to the event is documented; firing it ourselves and introspecting `items` is not |
| `app.openWithDefaultApp` | e4 | Absent from types on both platforms; probe shows it exists at runtime on iOS |
| `adapter.getNativePath` / `getFullRealPath` / `getRealPath` | path resolution | Undocumented adapter methods, called defensively; raw values logged by `probe` |
| `_capacitor_file_` parsing of `getResourcePath()` output | path resolution fallback | Public API input, Capacitor-internal URL shape |
| Bundled Capacitor `App` plugin `openUrl` | e3e | Depends on Obsidian's bundled plugin set; proxies materialise methods on access, so existence is only proven by calling |
| `leaf.rebuildView()` | e6b | Internal view method |
| `shareddocuments://` scheme | e3a–c, e3e | Apple-private Files scheme, no contract |

## Recommendation

**Buildable today, with a choice of three working routes.** Highest tier
achieved: **Tier 3 — genuine in-place round trip**, six times witnessed across
two sessions, by four distinct mechanisms. Every route ends with real PencilKit
ink in the real vault file and the Obsidian view already fresh on return.

Ranked by UX:

1. **`file://` navigation (e3d) — the exact goal UX, sterile-confirmed.**
   `window.open("file:///<abs>")` launches the Preview app directly — verified
   from a cold device (reboot-first run, session 4) with a witnessed in-place
   write. Tap → Preview → Pencil → back, nothing in between. Caveat: what
   iPadOS does with a `file://` open from a webview is undocumented behavior;
   treat it as the least contracted of the three routes.
2. **`shareddocuments://` navigation (e3b/e3c) — the robust one.** Three
   witnessed writes, zero anomalies. Lands inside the document in Files'
   viewer: Markup (PencilKit) is one tap, "Open in Preview" is one tap. Plain
   `window.location.href`; the scheme is Apple-private but is how Files
   deep-links work, stable for years.
3. **`openWithDefaultApp` / the "Share" command (e4/e1d) — the most
   API-shaped.** An Obsidian core function (undocumented on iOS) that raises
   the native share sheet; Preview sits behind the "more apps" step (a one-time
   share-sheet reorder by the user mitigates). Witnessed in place via both the
   direct call and the command path.

The shipping shape: a button on the PDF view that resolves the absolute
container path fresh and fires route 1 or 2, with 3 as the fallback if either
scheme behavior rots. Session 5 extends this in two directions:

- **The note-embed flow works** — target resolution from the active note's
  embed list is public API and proven on-device, so the button belongs on
  embeds too, each bound to its own file. Multiple embedded PDFs are fine; an
  external write refreshes every embed of that file and leaves the others
  byte-identical (control-verified).
- **Images work through the identical route** (PNG proven, in-place,
  re-editable strokes), with one production cost — now measured and solved:
  Obsidian serves stale image bitmaps until the URL changes, so image support
  ships a render-time cache-buster (mtime query on image srcs; one-shot
  refreshes don't survive re-renders — proven by e6c). PDFs need nothing.

Costs and caveats:

- **Path resolution is the one fragile piece.** `getFullPath()` is public but
  Documents-relative on iOS; the absolute path comes from parsing
  `getResourcePath()`'s Capacitor URL (public API in, internal URL shape) or
  undocumented adapter methods. See the Private API ledger. The triggers
  themselves are plain web navigation (routes 1–2) or one internal function
  call (route 3).
- The container UUID changes on reinstall — resolve the path fresh on every
  tap, never persist it.
- `file://`-opens-Preview (route 1) is the newest and least-contracted
  behavior, sterile-confirmed on iPadOS 26.5.2 / Obsidian 1.13.4. Keep route 2
  a config flip away in case an OS update changes the handling.
- Local vault only ("On My iPad") is the tested configuration, by design.

Why this is worth building (the unoccupied space): every existing annotation
plugin — Jot, Ink Annotation, Mobile Ink Annotation Basic, `obsidian_ink`,
`obsidian-pencil`, `obsidian-blackboard` — draws on an HTML canvas from pointer
events and stores strokes in sidecar files. The PDF itself never changes, so
the ink is invisible outside that plugin and never travels with the file. None
of them can ever adopt PencilKit: it is a native UIKit framework, and Obsidian
plugins cannot ship native code. This handoff puts **real PencilKit markup in
the real file** with a one-tap trigger. The Jot pre-check (poor writing feel,
buggy flow) confirms the fallback is weak in practice as well as structurally
limited — the handoff route is the differentiated one, and it works.
