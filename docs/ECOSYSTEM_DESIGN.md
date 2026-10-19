# KI ecosystem design notes · 0.4.0

## Reference and product identity

The user supplied the Array **Obsidian × Signal hybrid** screenshot as the direction for this revision. The referenced design is present in the first-party Array repository at `f17062d24b1625d14707fd8046c134cdef00b33b`, under `design/explorations/2026-10-redesign/hybrid/proto/`. It is used as the requested reference, not represented as a universally deployed KI design system.

The 0.3.0 study of Annex, Array, Project Sybil and Constellation informed the earlier shell. Version 0.4.0 moves visibly closer to the supplied Array reference using its actual fonts and ribbon artwork. Company copy consistently uses **Kuykendall Industries**. METADATA is the short product name; the OS/application identity remains **KI Metadata Workbench**, `industries.kuykendall.metadata`, so the upgrade can reuse local data.

| Reference element | Implementation |
|---|---|
| Array Display Regular/Bold | Local display typography for the product and section headings. |
| Array Text Regular/Medium | Local working-interface text. |
| `bg/still-ribbon.webp` | Static steel/red ribbon background under dark working surfaces. |
| Near-black and graphite surfaces | High separation between the desktop shell, file rail and active working panel. |
| Signal red `#d00000` | Primary actions, active states and selected emphasis. |
| Fine neutral borders and chamfers | Cut-corner panels, tabs and buttons replace the previous rounded treatment. |
| Distinct METADATA mark | Bracket/data geometry, a seven-size ICO and a matching Windows product icon. The Array wordmark is not presented as this app's logo. |

All fonts and artwork are bundled locally. No font CDN or runtime artwork request is needed. The exact copied asset hashes are listed in `SOURCE_SHA256.json`; the PNG/ICO icon is reproducible from `assets/metadata-icon.svg` with `scripts/build-icon.mjs`.

Source: [Array hybrid design at the inspected commit](https://github.com/seismicgear/Array/tree/f17062d24b1625d14707fd8046c134cdef00b33b/design/explorations/2026-10-redesign/hybrid/proto).

## Workflow decisions

The free standalone utility has a single workspace, with a persistent file rail and explicit modes for editing and inspection. Files, Overview, Compare, Batch edit, Reports and Team presets give common work a clear destination. Individual files expose Metadata, Inspect, Sharing, Preview/Artwork, Raw tags, Audit and Streams as applicable.

The Overview turns a mixed folder into a manageable review set. Signature mismatches and unsupported writers are visible before edits. Hashes can be copied from Inspect. Raw inventories are paged; comparisons begin with changes only. Common editing fields stay approachable, while raw tags, stream inventories and verification details remain accessible for specialist work.

Inspection mode pauses automatic media previews and enforces the source-write block beyond the renderer. Reports default to omitting private source values and paths. Bulk edits preview exact changes before staging and can restore earlier drafts with Undo batch. Saving a batch remains a deliberate, verified copy operation with one folder choice.

The app retains command search, comfortable/compact density, reduced-motion settings, neutral output names, clear skipped-file reporting and team preset exchange from 0.3.0. The ribbon is static; the interface does not depend on animation.

## Implementation and validation

The renderer remains framework-free TypeScript. Rust owns file mutations and verification; named IPC operations supply the desktop boundary. Array integration is a distribution handoff, with no Store backend, billing or account service embedded in this utility.

The final interface was visually checked at 1540-pixel and 980-pixel window widths, without horizontal page overflow. It passed 23 synthetic browser checks and 21 actual Electron/native workflow checks. The synthetic preview and its bridge are excluded from the production runtime. Internal QA screenshots and the user reference screenshot are not included in the deliverable.
