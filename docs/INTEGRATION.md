# Using the metadata engine across KI products

Version 0.4.0 separates the desktop employee utility from its local Rust core. Annex, Array, Sybil or Constellation can call that core through a child process using the same inspection, save and verification behavior. This release supplies the interface; no integration has been published into those products.

## Process contract

Run `ki-meta serve`. Send one UTF-8 JSON request per line on stdin. Read one response per line from stdout, correlating by `id`. Operations are sequential within a process. The service accepts up to 16 MiB per request; unsupported methods and validation failures return `error` instead of a successful result.

```json
{"id":1,"method":"doctor","params":{}}
```

A successful response has `{"id":1,"result":...}`; a failure has `{"id":1,"error":"..."}`. Do not interpret process survival as success. A parser failure is reported without claiming a completed commit.

The CLI also supports `ki-meta doctor`, `ki-meta inspect <file>` and `ki-meta request <request.json>`. The `request` command prints the result directly and exits nonzero on failure, unlike the service's response envelope.

The Electron main process is a working integration reference in `electron/main.cjs` and `electron/core-bridge.cjs`. The renderer-facing bridge has additional path grants and validation; native CLI callers must establish their own trusted file-selection boundary.

## Engine configuration

Set explicit trusted executable paths with `KI_EXIFTOOL`, `KI_FFMPEG` and `KI_FFPROBE`. Set `KI_DATA_DIR` to the integration's private, per-user history directory. The desktop resolves these to the included resources automatically. The core also resolves trusted bundled FFmpeg/ffprobe siblings and the ExifTool subdirectory next to its own executable. Explicit environment paths take precedence; PATH is the development fallback. Moving `ki-meta.exe` alone does not move its media tools.

The packaged layout is:

```text
resources/bin/ki-meta.exe
resources/bin/ffmpeg.exe
resources/bin/ffprobe.exe
resources/bin/exiftool/exiftool.exe
resources/bin/exiftool/exiftool_files/...
resources/licenses/...
```

Keep the entire ExifTool distribution together. The license directory includes complete ExifTool and FFmpeg source archives, build configuration and dependency notices. For a stable separately installed integration, use this layout from the source/vendor files rather than depending on a portable launcher's temporary extraction directory.

## Inspect before offering actions

```json
{"id":2,"method":"inspect","params":{"path":"C:/Work/image.png"}}
```

An inspection includes the canonical path, file name/size, BLAKE3 `etag`, media kind/format, semantic `fields`, raw metadata inventory, artwork, structural properties, warnings and `capabilities`.

Use `capabilities.fields`, `capabilities.policies`, `capabilities.raw_edit` and `capabilities.artwork` to build the UI. Respect each raw field's `writable` value. An empty policy list indicates no writable workflow. `properties.copy_only` blocks replacement. The broader extension registry in `doctor` is routing information, not authorization to write every file with that extension.

## Apply a sparse patch

```json
{
  "id": 3,
  "method": "save",
  "params": {
    "path": "C:/Work/image.png",
    "expected_etag": "COPY_THE_ETAG_FROM_INSPECTION",
    "output": "C:/Shared/image-clean.png",
    "replace_original": false,
    "allow_unverified": false,
    "accept_remux": false,
    "patch": {
      "policy": "strip_metadata",
      "fields": {},
      "raw": [],
      "artwork": {"action": "keep"}
    }
  }
}
```

The etag in this example is a placeholder: substitute the actual returned fingerprint. Explicit output paths belong to trusted native callers; Electron's renderer cannot supply them.

For ordinary edits use `policy: "keep"`, with fields such as `{"title":"Public title","artist":null}`. A string sets a supported value; `null` removes it. Omitted fields remain unedited. Clear/privacy policies first clear their adapter's defined scope and then apply explicit new values. A strict image strip requires empty fields/raw edits and unchanged artwork.

Raw edits have `namespace`, `key` and nullable `value`; they are not a general ExifTool or shell interface. Artwork supports keep, remove, or replacement from a selected JPEG/PNG. Video writes require `accept_remux: true` after the user understands the remux scope.

## Commit and verification semantics

The core stages a copy, applies edits, re-inspects the output, verifies its defined content scope and requested metadata, rechecks the source fingerprint, and commits without overwriting an existing copy destination. Failed checks do not produce an approved output. Replacement is explicit, requires matched verification and keeps an exact original backup. Replacing a copy-only format is refused.

The result includes `output`, `backup`, `journal`, `saved_at_ms`, `before`, `after`, warnings and a `verification` object:

| Status | Meaning |
|---|---|
| `matched` | The adapter's specified content fingerprints match. Read `method` and `detail` for the scope; this is not a universal rendering equivalence claim. |
| `metadata_only` | Metadata readback succeeded, but no image-data fingerprint is available for that format. Copies only. |
| `unverified` | An acknowledged audio/video copy was allowed when packet verification was unavailable. A real mismatch cannot be bypassed. |

Strict image exports additionally require a clean container scan. Document cleanup checks the remaining properties against any explicitly requested new values. Do not label an operation completed when a policy is merely staged or an exported snapshot contains only source metadata.

`history` returns known save journals. `restore` accepts a known journal path and verifies the output/backup fingerprints before recovery. Recovery restores the entire original, including the metadata originally removed. `export_artwork` requires a source path, artwork index and unused output path.

## Team preset exchange

The desktop exports this schema, with one to 100 validated templates per imported pack:

```json
{
  "application": "KI Metadata Workbench",
  "schema_version": 1,
  "presets": [
    {
      "id": "example-company-template",
      "name": "KI company details",
      "policy": "keep",
      "fields": {"company": "Kuykendall Industries"}
    }
  ]
}
```

Imports create fresh IDs. A preset cannot invent unsupported file fields; the app reports compatibility through its normal staging behavior. Keep person-specific credit templates separate from employee-wide company metadata. Packs are local files; automatic synchronization, centrally enforced policy and employee provisioning are not implemented.

## Data handling for integrations

Use per-user storage, serialize writes to a file, retain no-clobber saving, and preserve the reported capability/verification distinctions. Core methods accept local paths and are intended for a trusted local caller. Do not expose this process as an unrestricted HTTP endpoint.

Cleanup journals omit the original metadata/property inventories; in-memory results and explicit source/audit exports can still contain private source values. Share the cleaned output file when that is the intended deliverable. The app does not erase originals/backups, redact visible content, or process external sidecars and service records. Full policy details are in [FORMATS.md](FORMATS.md) and [SECURITY.md](SECURITY.md).

## Tolerant inventory and evidence

The new `inventory` method accepts the same `path` parameter as `inspect`. It returns the same Inspection schema, but a metadata-parser failure can produce a read-only document with an evidence fingerprint and diagnostic. Existing `inspect` preserves strict parser errors. The desktop uses `inventory` for its review workflow; native saving still revalidates with the strict adapter.

`properties.evidence` includes `sha256`, `blake3`, `detected_type`, `mime_type`, `bytes_hashed`, `header_hex` and `extension_status` (`compatible`, `mismatch` or `unknown`). Use the actual returned fields; missing signature knowledge is not proof of compatibility. A recognized mismatch blocks writes. The `etag` remains the full-file BLAKE3 used for source-change guards.

## Bounded scan CLI

```powershell
ki-meta scan --recursive 'C:\Review' > inventory.jsonl
ki-meta scan --recursive --include-paths 'C:\Review' > named-inventory.jsonl
ki-meta scan --full 'C:\Review\sample.png' > detailed-inventory.jsonl
```

The scan schema is `industries.kuykendall.metadata.scan`, version 1. Each default row has a sequential `file_id`, kind/format/byte count, SHA-256/BLAKE3, signature/extension status, metadata/warning counts, writer and policy capabilities. Default rows omit paths, names and source values. `--include-paths` adds the path and name; `--full` embeds the entire Inspection, including paths and values. Error rows identify failure without copying the detailed exception into default stdout. Diagnostics go to stderr and may contain paths.

Directories require `--recursive`. Scans skip links, special files and hidden directories, deduplicate canonical files, and cap 1,000 files / 10,000 entries. A partial failure or exceeded limit is nonzero even though completed rows remain valid. Use `--` before literal paths beginning with a dash. These operations do not edit source files.

## Desktop launch and inspection profile

The app accepts absolute file paths on launch and forwards later launches to its existing instance. `--inspect-only` locks the session's source-edit/restore policy; `KI_READ_ONLY=1` applies the same native dispatch restriction for direct CLI/service callers. The renderer can request an ordinary mode change, but cannot unlock a locked launch profile or change modes during a write. Explicit report/artwork exports and settings writes remain available. This is an app policy, not OS write protection.

The named preload API adds `sessionState`, `setReadOnly`, `launchFiles` and `exportReport`, with `onOpenFiles`/`onSession` events. Startup imports drain through the main process after the renderer is ready; imports received while busy are queued. Integrations should prefer launch arguments or the existing native protocol over exposing arbitrary IPC.

## Report schema

Desktop JSON exports use `industries.kuykendall.metadata.report`, schema version 1. The report contains the application/version, generation timestamp, case name, disclosure switches, totals and file entries. Entries include identities/hashes, findings, capability scope, staged field names and actual saved-output verification when applicable. Default reports omit original names, paths and metadata values. Explicit detailed reports add semantic fields and raw tags. CSV flattens the same file inventory with UTF-8 BOM, quoted values and formula-prefix neutralization.

The report's `verification` is null unless the inspected path and fingerprint match the saved output. A source that happens to have the same bytes as a copied output is not labeled as the saved file. The source in-memory audit and detailed exports can still contain private values. No report is signed or represented as a certified chain-of-custody record.

## Array distribution

See [the Array handoff](../integration/array/README.md) for the Windows adapter, registration patch, product intent and candidate hashes. The standalone app contains no Store backend or account/license implementation. Array and the canonical KI website/Store remain the owners of catalog, distribution and release trust.
