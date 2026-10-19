# Employee guide · METADATA 0.4.0

METADATA is a local Kuykendall Industries utility. Use the portable Windows download, or install the Setup download under your own Windows account. No account, activation or separate media tools are needed. The current downloads are unsigned candidates; the release qualification is documented in [TEST_REPORT.md](TEST_REPORT.md).

## Choose the task

| You want to… | Start here |
|---|---|
| Remove embedded private metadata before sharing | Add files → Prepare for sharing → Stage recommended cleanup → Save copies. |
| Correct titles, credits, keywords or document properties | Files → Metadata → edit supported fields → Save copy. |
| Inspect unfamiliar files without enabling edits | Inspect only → add files → Inspect / Raw tags. |
| Find differences between two versions | Compare → choose the left and right file → show changes only. |
| Change one field across many files | Select files → Batch edit → preview → stage → save staged copies. |
| Inventory a review or handoff | Reports → choose scope and disclosure → export JSON or CSV. |
| Reuse team metadata | Team presets → apply a preset, or import a team pack. |

## Share a cleaned copy

Add files with the picker, a folder, or drag/drop. Check files in the sidebar to select a batch. Open **Prepare for sharing** and read the policy scope. **Stage recommended cleanup** replaces existing drafts on eligible files; this prevents earlier private edits from being reintroduced into the cleaned copy. Unsupported files are reported and skipped.

Save a copy to a new path. A batch chooses one folder and can use neutral filenames. Existing destination files are never silently overwritten. Progress and the result appear after actual native processing. **Stop after current file** finishes the current operation before stopping the batch.

For JPEG, PNG/APNG and WebP, strict stripping includes EXIF/GPS, C2PA/JUMBF, AI text and Stable Diffusion parameters in embedded removable metadata. It can alter displayed orientation or color when EXIF orientation/ICC data is removed. For RAW/extended images, audio/video and documents, cleanup has a narrower scope. Review the [format guide](FORMATS.md) when sharing a new file family.

Share the cleaned output. The source, backup, an exported source snapshot and a detailed audit may still contain the original metadata. Document property cleanup does not remove comments, tracked changes, notes or personal information in the document itself.

## Inspect and compare

Switch the top-bar mode to **Inspect only** before opening a review set. You can inspect and export reports, while source edits and backup restoration are blocked. Automatic media preview loading pauses; **Load preview** is an explicit choice. A shortcut launched with `--inspect-only` locks this mode until that app session ends. This protects the app workflow; it does not prevent another application or the operating system from writing to the file.

**Overview** summarizes metadata findings, staged work, read-only files and exact duplicates. Click a filter to narrow the workspace. Duplicates share the same full-file BLAKE3 fingerprint; visually similar images with different metadata are not counted as exact duplicates.

**Inspect** shows SHA-256/BLAKE3, the initial header bytes, type/MIME hints and whether the extension matches the recognized container. Use the copy controls for hashes. Findings group location, identities, generation metadata, provenance, dates and comments. A finding prompts review; its presence or absence is not a privacy certificate.

**Raw tags** supports search, categories, namespaces and paged inventories. **Compare** aligns tags by namespace and key and highlights values that were added, removed or changed. Repeated tags are compared with their counts intact. Refresh inspection after another application modifies a source.

## Batch editing without losing drafts

Select the files, open **Batch edit**, and choose a supported field. Set a value, remove it, or use literal find-and-replace with an optional case-sensitive match. Inspect the preview before staging. Files that cannot store the field, and files with strict stripping already staged, are skipped with a reason.

Staging updates drafts; it does not write files. **Undo batch** restores the drafts that existed before that batch. **Save staged copies** creates new files through the same native verification used by individual saves. A copy cannot overwrite its source through the batch workflow.

## Reports for a team or case

Choose the selected files or workspace in **Reports**. Give the case a non-sensitive label if the report will be shared. JSON preserves structured information; CSV is convenient for a spreadsheet.

By default, reports include sequential file IDs, file sizes, hashes, signature hints, finding counts, capabilities and applicable saved-output verification. Original names, full paths, tag values and warning text are omitted. Separate choices include names, paths or source metadata values. Detailed metadata can itself contain names or paths inside arbitrary text even if path columns are omitted. Review these choices before exporting.

CSV values are quoted and common spreadsheet formula prefixes are neutralized. Reports are inventory snapshots, not signed evidence records. Hashes can identify a file that someone already possesses. A status of **Staged** means unsaved work, and verification is included only when it belongs to the actual saved output being reported.

## Presets, history and recovery

Create a preset by checking the fields to include. Only explicitly staged values are selected by default. Use company-level metadata for shared presets; person-specific credits should remain separate. Export a custom preset pack and import it on another computer. Imports validate the full pack and add fresh identities without replacing existing presets.

Save Copy leaves originals untouched. Explicit replacement creates an exact original backup and requires matched verification. History can restore a known backup only after checking the recorded files. Restoration also restores the original private metadata. There is no secure erasure or automatic backup expiry.

Each OS account has its own settings and history. Portable means no installation is required; it does not mean no local settings or temporary extraction files are created. The app has no central synchronization service.

## Useful controls

Use `Ctrl+O` to open files and `Ctrl+K` to search commands. Comfortable density gives controls more space; compact density fits larger inventories. File checkboxes choose a batch independently of the current file. Read the result/audit when an operation is refused: a metadata-only copy, a source-change refusal or an unsupported format is not reported as a fully verified replacement.
