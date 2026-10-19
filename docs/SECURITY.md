# Security and data handling

KI Metadata Workbench 0.4.0 is a local desktop implementation with a compiled and tested Rust core. The automated qualification and its limits are recorded in [TEST_REPORT.md](TEST_REPORT.md). It has not undergone an independent security audit. Native Windows runtime and installer acceptance remain separate work, described in [WINDOWS_ACCEPTANCE.md](WINDOWS_ACCEPTANCE.md).

## Boundaries implemented

The renderer cannot directly call Node APIs. It receives named preload operations. Main-process handlers validate the calling frame and restrict media paths to selected/dropped files. It does not expose arbitrary subprocess commands or IPC channel names. Filesystem mutations of media go through Rust. FFmpeg and ExifTool arguments are passed directly to a trusted executable without a command shell. ExifTool receives an empty configuration path before other arguments, preventing automatic loading of user configuration. Editable ExifTool tag names come from a fixed whitelist. The native service uses bounded JSON-line input; the Electron bridge rejects oversized responses.

The desktop denies new windows, renderer navigation and browser permissions, and blocks HTTP(S)/WebSocket requests. It has no account, telemetry, auto-update or upload implementation. Initial package installation does use the network. An externally selected FFmpeg, ffprobe or ExifTool executable is trusted code running as the user; selecting a malicious executable defeats that trust model. These boundaries follow [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

Untrusted metadata is inserted into the UI with `textContent`/`value`, not `innerHTML`. JPEG/PNG cover data URLs are MIME-restricted by the core. The app does not execute scripts in metadata or accept SVG as cover artwork. XMP parsing rejects DTDs, packets above 2 MiB, and nesting above 64 levels before allocating the recursive XML tree. PNG compressed text is bounded to 2 MiB when inflated. Image processing has a 256 MiB input limit. These are mitigations, not a guarantee against vulnerabilities in native parsing libraries.

## Strict image metadata removal

The `strip_metadata` policy, displayed as **Strip image metadata**, supports JPEG, PNG including animated PNG, and WebP including animation. It removes whole embedded EXIF blocks, including GPS and orientation, XMP, IPTC, C2PA/JUMBF, comments, text, ICC profiles, and unknown metadata blocks. This includes Stable Diffusion parameters, prompts, model/seed/settings text, ComfyUI workflow data and AI generation tags when stored in those containers. Removal does not depend on recognizing a generator name or an individual field.

The strict parser walks every JPEG scan through EOI, every PNG chunk through IEND, and the declared WebP RIFF container including nested ANMF frame chunks. It removes data following the image terminator or declared RIFF boundary. JPEG structural segments and coding tables are validated; JFIF thumbnails and excess application-header data are removed. PNG retains an explicit list of rendering/animation chunks and validates their bounds, required lengths and CRCs. WebP strips unknown chunks at both container and frame level, validates ALPH structures, and rebuilds lengths, feature flags and padding. Unsupported or malformed retained structures fail before a destination is committed. Malformed descriptive metadata can be reported as an inspection warning and still be discarded.

C2PA manifests use JPEG APP11, PNG `caBX` and RIFF `C2PA` storage; the strict policy removes those containers, including duplicate or fragmented entries, and removes XMP provenance links with the XMP packet. It does not parse trust chains, authenticate a signer, validate a manifest or establish the provenance of an image. See the [C2PA 2.4 specification, embedding and external-reference sections](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html).

The operation retains encoded image and animation payloads without decoding, rotating or recompressing pixels. It retains necessary technical structures such as dimensions, coding tables, palettes, transparency, animation controls and the allowed PNG color/rendering fields. It deliberately removes **all EXIF and all embedded ICC profiles**. Removing orientation can change the apparent rotation or mirroring of a photograph; removing an ICC profile can change its color appearance. The UI reports these effects. ICC profiles can contain identifying descriptive text, which is why this mode removes the complete profile; see the [ICC profile specification](https://www.color.org/specification/ICC.1-2022-05.pdf).

Strict stripping cannot be combined with field, raw-tag or artwork edits. Before commit, the core scans the output again and requires zero removable metadata blocks and zero trailing bytes under these container rules. It also compares BLAKE3 hashes of the source and output with the same strict rules applied, protecting the encoded image/animation and retained structures. Unverified opt-in cannot bypass either strict check.

Existing `keep`, `clear_descriptive` and `privacy` policies retain their earlier semantics. In particular, ordinary JPEG/PNG cleanup preserves orientation/color profiles and can preserve private blocks. Audio and video do not offer `strip_metadata`. A successful field edit or ordinary cleanup is not evidence that the strict image-removal checks ran.

## Broader file handling

Office/OpenDocument parsing limits entry counts, declared expanded size, XML size and nesting, rejects duplicate/traversal members and DTDs, and refuses signed/encrypted packages. Non-metadata members are raw-copied and independently hashed on readback. PDF cleanup uses a full rewrite and removes obsolete metadata storage. Signed/encrypted PDFs are not writable. Document-property cleanup does not redact document content or attachments.

Extended images use a curated XMP writer. Scoped privacy cleanup retains rendering/calibration information; it is not the strict all-block image policy. A missing image-data fingerprint makes a file copy-only and produces a metadata-only verification state. Unsupported camera variants are inspection-only. All metadata values are arguments to fixed tag names; they cannot choose a config file, shell command or arbitrary writable ExifTool pseudo-tag.

FFmpeg input protocols are restricted to file/pipe and demuxer formats to the supported media families. This rejects playlist content disguised with a video extension. The bundled FFmpeg build disables network support. These restrictions do not turn third-party parsers into a security sandbox; the processes still run under the employee's OS account.

The renderer never supplies an arbitrary batch output path. An OS folder selection grants a bounded, opaque token; the main process generates collision-safe filenames, and Rust performs the final no-clobber commit. A batch cannot replace originals. Tokens are released after the job. The write lock includes the destination dialog and native operation.

Preset imports validate the complete pack before updating local settings, impose size/count limits and issue fresh IDs. Presets contain metadata values and policies, never executable instructions. Exporting a template is still an intentional disclosure of its selected values; the field-selection dialog avoids silently copying an employee's existing metadata into a team template.

## Write policy

Save Copy is the default and refuses any existing destination. Replacement is explicit, requires a matched verification result and creates a verified complete backup first. A fingerprint guards against a source that changed since inspection. There is no OS-wide exclusion lock against another application racing the final operation; do not concurrently edit the same file.

Staging files use same-directory temporary files and commit through filesystem rename/persist operations. Normal exceptions clean up staging paths. Abnormal process/OS termination can leave `.ki-staging-*` files. Never treat those as qualified outputs automatically. Filesystem semantics, power-loss behavior, antivirus locks and network shares require platform testing.

Restoration is limited to this app's known journal directory and checks recorded hashes. The journal is not cryptographically authenticated against software running under the same OS account. The application does not defend against a malicious same-user process that can alter its configuration/history and the target files.

## Sensitive retention

Save Copy intentionally preserves the source. Replacements keep a complete verified original in `.ki-backups` beside the source. Removed values remain in those originals and backups, and can remain in external filesystem backups. Restoration restores the complete original, including its metadata.

For a completed cleanup policy, the **persisted history journal** clears `before.fields`, `before.raw`, `before.properties`, `before.artwork` and `before.warnings`. This avoids copying removed GPS coordinates, names, prompts and descriptive packets into those journal fields. Recovery paths, filenames, full-file fingerprints, backup references and output inspection values remain. Embedded artwork preview data URLs are excluded from all persistent journals. The cleanup journal is therefore reduced in sensitive content, but still identifies local files and operations.

That journal filtering applies to the persisted clone, not to the result returned by the native operation. The **in-memory save audit** can still contain the original inspection values. An exported source snapshot can also include original GPS, prompts or other private metadata. Keep-policy journals retain descriptive metadata, and a restoration journal can record the restored original's values. Review exports according to the object they contain; a source snapshot or audit is not the cleaned media file.

No encryption, secure erasure or automatic backup expiry is implemented. Use the operating system's disk encryption and access controls as appropriate. Share the intended cleaned image file, and assess any accompanying audits, snapshots and backups separately.

## Scope limits

Strict stripping concerns embedded container metadata in the supported image formats. It does not sanitize visible image content, digital watermarks, steganography, content fingerprints or identifying information encoded in pixels. It does not sanitize filesystem timestamps, permissions, extended attributes, Windows alternate data streams, sidecar files or externally hosted manifests. Neutral filenames are an optional batch-copy feature, separate from embedded metadata removal. It does not establish anonymity, ownership or authenticity.

The raw inspector is not an exhaustive forensic analyzer. The strict output scan has a defined container allowlist; the normal audio/video and descriptive-image workflows have narrower cleanup scopes and can retain unknown/private structures. Video remuxing can invalidate signatures and alter structural/timing details; A/V packet hashes do not prove playback equivalence.

## Before distributing

Dependency lockfiles have been resolved and the native engine has been compiled and tested. Review the lockfiles, dependency security and third-party license notices for the exact distributed build. Rerun the automated gate after changes, complete native Windows acceptance against the exact package, and configure code signing before public distribution. An unsigned Windows GNU x64 crossbuild or portable package does not by itself establish Windows runtime qualification.

## Inspection sessions, fingerprints and reports in 0.4.0

The main process enforces Inspect only before starting a save or restoration, including the destination/confirmation dialog. A mode change cannot race an active write. A locked second-instance launch waits for an in-flight operation to finish and then locks future edits. `--inspect-only` cannot be relaxed through renderer IPC. `KI_READ_ONLY=1` separately blocks native `save` and `restore` dispatch. These controls do not prevent report/artwork exports, local settings writes, operating-system access-time updates or writes by another process. They are not an OS-level forensic write blocker or an administrator-enforced policy against the same user.

Full-file SHA-256 and BLAKE3 fingerprints identify exact file bytes. A short signature/header detector classifies known containers; it does not validate all structures, establish a file's safety or prove authenticity. A recognized signature/extension mismatch disables all write capabilities. An unknown signature does not enable a writer. Tolerant `inventory` can retain a read-only fingerprint and warning after a parser failure, while strict `inspect` and the native save validation retain their earlier error behavior.

Categorized findings use namespace/key heuristics and container indicators. They can be incomplete or classify benign metadata for review. Exact-duplicate groups use the full-file BLAKE3 fingerprint. Metadata comparison aligns namespace/key pairs and retains repeated-value counts; it is not a binary, visual or document-content diff. C2PA findings do not verify trust chains or signatures.

Reports omit names, paths, tag values and warning text by default. Explicit metadata-value disclosure may still expose paths or names embedded in arbitrary text; suppression of the known filename/directory columns is not content redaction. Case names are supplied by the employee. Hashes and file sizes can identify known files. Saved verification is associated with the actual output path and fingerprint, not an untouched source or a merely staged operation. Reports are bounded to 1,000 files, detailed metadata has an 8 MiB character budget, and the main process imposes a 24 MiB UTF-8 export limit. JSON/CSV exports use a user-selected, unused destination. CSV quoting and formula-prefix neutralization reduce spreadsheet formula-injection risks.

Recursive CLI scans are read-only with a 1,000-file / 10,000-entry queue/visit limit. They skip symlinks, special files and hidden directories, and deduplicate canonical input paths. Default stdout omits paths and source values; stderr diagnostics may identify paths. `--include-paths` and `--full` are explicit disclosures, and a nonzero exit means the caller must review errors even when earlier JSONL rows are valid. Scanning is an inventory operation, not a malware sandbox.
