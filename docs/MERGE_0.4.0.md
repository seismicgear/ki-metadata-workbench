# Version merge · 0.4.0

The supplied 0.2.0 source archive was compared with the 0.3.0 workbench before this revision. It is the same baseline archive previously used: SHA-256 `7302735bcbe3dfeef8b3386287668522150214e3dd4ac8fb6d958448ac16b772`.

All 73 baseline files were represented in 0.3.0: 33 were identical, 40 were updated and none was missing. This is a baseline-coverage check; modified files were reviewed in context, not assumed equivalent just because they existed. The full comparison is in [version-merge-0.4.0.json](evidence/version-merge-0.4.0.json).

## Preserved from 0.2.0

The strict JPEG/PNG/APNG/WebP metadata policy, EXIF/GPS/C2PA/AI-container stripping, encoded-content checks, whole-block output rescan, no-clobber copy/backup safeguards, original audio/video tag workflows, raw editing boundaries and strict image regression fixtures remain. The privacy engine and its integration suite are byte-identical:

| File | SHA-256 |
|---|---|
| `native/src/image_privacy.rs` | `768644ecf1da18b950ac15b6c5d5a178dbdacb736ea1b2c3fcb2be09e10c07b9` |
| `tests/image-privacy.integration.mjs` | `9c0be5b9ce8cf7a13d47a57511ae9dbef00fcb15ab597578a063420f85b41987` |

All 35 strict image integration checks passed unchanged in 0.4.0.

## Preserved from 0.3.0

The expanded image/camera, PDF, Office and OpenDocument adapters remain, together with the 84-extension routing registry, bundled ExifTool/FFmpeg tools and their licenses. One-folder batch copies, neutral names, team preset selection/import/export, command search, cleanup-journal filtering and precise verification states remain in the app. The 49 expanded-format checks passed with the full upstream fixture set.

## Added in 0.4.0

The supplied Array hybrid reference now drives the typography, ribbon artwork, palette and chamfered geometry. A new METADATA icon and correct Windows version resources identify the standalone product. The stable application ID is retained.

The new enterprise workflows add SHA-256/BLAKE3 inspection, signature/extension review, categorized findings, exact duplicates, namespace-aware comparison, controlled JSON/CSV reports, previewable batch set/remove/find-and-replace with draft-preserving undo, a locked inspection launch profile and bounded JSONL scanning. Strict `inspect` behavior remains compatible; the new tolerant `inventory` operation provides read-only evidence when a metadata parser fails.

Windows portable and NSIS packages are supplied. Array receives a concrete adapter/registration patch and unsigned release inventory in `integration/array`, with the canonical Store/free-utility and signing requirements documented. No Array repository or live Store was modified or published as part of this package.
