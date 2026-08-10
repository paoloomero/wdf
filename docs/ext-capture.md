# WDF extension: `capture` (version 0.1)

Status: extension specification (outside WDF Core, per core spec §10).
Producers MAY use it; conforming consumers MAY ignore it entirely (§10.3).
Sections are numbered so validators can cite them (`ext-capture §4`), the
same way core violations cite core sections.

## §1. Purpose

A WDF package produced by capturing a **live, rendered page** (e.g. the
browser extension's "Save as WDF") does not start from server-delivered
bytes: it starts from the DOM as it existed in one browser, at one moment,
in one viewport, possibly within one logged-in session. Such a capture is
**not reproducible** — a second visit may render different content (A/B
tests, personalization, time-dependent data).

The `capture` extension records the provenance of that moment: where, when
and how the capture was made. It exists so that the verification story
stays honest: on a captured package, "verified" attests **internal
coherence** (the AI layer is the canonical extraction of the content,
§7.1) and **integrity** (every file matches its hash, §8) — it does _not_
attest "this is what the server published". Consumers MUST keep that
distinction visible (core §8.3, §11.4).

The capture metadata is covered by the package integrity hashes like any
other file (§10.2): it cannot be altered without the package showing as
tampered. It is, however, producer-asserted — a cryptographic signature
binding the capture to its producer is deliberately **not** part of
version 0.1 (future work, see core §10.4).

## §2. Manifest declaration

```json
"extensions": [{ "name": "capture", "version": "0.1" }]
```

## §3. Files

- `ext/capture/capture.json` — REQUIRED. Capture provenance metadata
  (§4). A package that declares the `capture` extension without this file
  is invalid.

A capture producer SHOULD also embed the serialized DOM snapshot via the
`source` extension (docs/ext-source.md, version 0.3) with
`"kind": "dom-snapshot"`, so the delta between the live page and the
canonical document stays inspectable.

## §4. `capture.json`

Machine-validated: the reference schema is
`spec/schemas/capture.schema.json`. When the manifest declares `capture`,
validators MUST check `capture.json` against it and report each violation
citing this section.

```json
{
  "capture": "0.1",
  "url": "https://example.com/2026/some-article",
  "capturedAt": "2026-08-10T15:04:05Z",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) …",
  "viewport": { "width": 1440, "height": 900, "devicePixelRatio": 2 },
  "mode": "article"
}
```

- `capture` — extension version (`"0.1"`).
- `url` — the page address at capture time (`http(s)` only, as shown in
  the address bar; producers SHOULD strip credentials embedded in the
  URL).
- `capturedAt` — capture instant, RFC 3339 date-time. Provenance is
  inherently non-deterministic; the determinism rule (§7.1) applies to
  extraction, not to provenance metadata.
- `userAgent` — the capturing browser's user agent string.
- `viewport` — layout viewport at capture time: `width` and `height`
  (CSS pixels, positive integers), optional `devicePixelRatio`
  (positive number). Rendered geometry — and therefore what a geometric
  pre-filter excludes — depends on it.
- `mode` — `"article"` (the extracted article, the default UX) or
  `"full-page"` (the whole page content).

Serialization follows the package convention: canonical JSON, two-space
indent, trailing newline.

## §5. External embedded content

A live page may embed content the WDF-HTML profile forbids by design
(`iframe`, `video`, `audio` — core §6.2): typically a cross-origin player
whose inner document is inaccessible to the capturing context anyway. A
capture producer MUST represent each such embed as a **placeholder that
preserves the embed URL** — no data is lost, nothing forbidden enters the
canonical document:

- **With a capturable poster image** (e.g. the player's poster frame): a
  `figure` per §6.2.6 — the poster stored under `content/assets/` as the
  `img`, and a `figcaption` carrying a link to the embed:

  ```html
  <figure>
    <img src="content/assets/3fa4b2c19e0d8a71.jpg" alt="Video preview" width="1280" height="720" />
    <figcaption>
      Video — <a href="https://www.youtube.com/watch?v=abc123">Open on youtube.com</a>
    </figcaption>
  </figure>
  ```

- **Without a poster**: a paragraph carrying the same link
  (`figure` requires an `img`, §6.2.6):

  ```html
  <p>Embedded content — <a href="https://player.vimeo.com/video/98765">Open on vimeo.com</a></p>
  ```

The link text SHOULD name the embed's host ("Open on _host_"). The link
navigates outside the document only on explicit user activation, like any
external link (core §11.3). Producers MUST NOT attempt in-place loading
of external content and consumers MUST NOT offer it: the no-network rule
is foundational, and weakening it is a core spec decision, never an
extension behavior.

## §6. Consumer guidance (viewers)

A viewer that understands this extension SHOULD state the nature of the
document near its verification badge — e.g. "captured from live page on
2026-08-10" — and expose the full metadata (`url`, `capturedAt`,
`userAgent`, `viewport`, `mode`) in its verification details, alongside
the integrity results. It MUST NOT present a captured package as the
server-published page: integrity is not authenticity (core §11.4). A
viewer that ignores the extension entirely remains conforming (§10.3).
