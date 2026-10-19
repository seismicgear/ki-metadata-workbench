# Windows acceptance · 0.4.0

The portable and per-user NSIS Setup downloads are unsigned Windows x64 build candidates. Both contain the full app, native engine, ExifTool, FFmpeg and ffprobe. Complete payload checks and 255 application checks plus eight Array contract checks passed as documented in [TEST_REPORT.md](TEST_REPORT.md). Actual Electron/native workflows ran on Linux. **Neither exact Windows package has been executed on Windows in this delivery environment.**

Record acceptance against the artifact hashes in `evidence/windows-package-evidence-0.4.0.json`. Use disposable fixtures/copies for replacement, restoration and interruption tests. These checks describe remaining platform work, not results already obtained.

## Launch, identity and installation

On a clean Windows 11 x64 employee account without development/media tools on PATH, run the portable and separately install the Setup package. Verify the METADATA icon, Kuykendall Industries ProductName/version details, initial UI and engine availability. Ordinary file processing should work offline. Test an extraction/installation folder with spaces and Unicode.

For Setup, test the per-user assisted installation, chosen destination, shortcuts and standard uninstall record with InstallLocation. Confirm the application runs with Array closed and requires no account or activation. Uninstall should remove the installed program and retain user settings/history according to package policy. Upgrade an existing disposable profile and check custom presets/history. Record unsigned prompts; a signed production release requires its own post-signing hashes and acceptance.

## File and review workflows

Use real Windows file/folder pickers and drag/drop with Unicode and long filenames. Launch with absolute file arguments; launch again while the app is open and confirm the new files are imported. Test `--inspect-only` from a shortcut and `KI_READ_ONLY=1` for the native core. The UI cannot unlock a locked session; source save/restore calls must be refused. Confirm a mode change or later locked launch cannot interrupt an already committing write.

Exercise Overview filters, exact duplicates, fingerprints, copy-hash controls and a mismatched extension. Compare files with repeated metadata keys. Export default JSON/CSV reports and confirm names, paths and source values are absent; explicitly enabled detailed reports should contain the intended values. Check spreadsheet handling with Unicode, quotes and formula-like text.

Preview a batch set/remove/find-and-replace, stage it, undo it and confirm earlier drafts remain. Save a mixed batch to one folder with neutral filenames and a pre-existing collision. Confirm collision-safe copies, explicit skipped files, successful verification and unchanged sources. Canceling a picker should not write a file.

## Format verification with packaged tools

Repeat strict JPEG/PNG/APNG/WebP cleanup with EXIF/GPS, C2PA/JUMBF, AI text, ICC, animation and malformed-metadata fixtures. Require the strict output scan and retained encoded-content match. Check apparent orientation/color separately.

Use representative employee extended/RAW images with the bundled ExifTool, including supported HEIC/AVIF/JXL variants. Metadata-only copies and read-only variants must retain their distinct states. Edit and clean representative PDF, Office and OpenDocument properties, then open outputs in the intended document application. Signed/encrypted documents must remain read-only; comments/content/attachments are outside property cleanup.

For audio/video, use the actual employee codecs and stream combinations with the packaged FFmpeg. Confirm remux acknowledgment, all-stream retention checks and refusal of incompatible destinations. Listen/view/seek to check presentation and synchronization; packet hashes alone do not prove these properties.

## Filesystem and recovery

Test no-clobber output, source-change refusal, read-only destinations, a file locked by another program, the intended antivirus settings and any network-share environment. Failed operations must not appear as successful exports.

Replace a disposable original explicitly, compare the complete backup with its original bytes, and restore it. A later output change or damaged backup should prevent automatic overwrite. Restoring includes the old metadata. Verify cleanup journals omit old field/raw/property/artwork/warning inventories while retaining recovery paths and fingerprints. Crash/interruption leftovers are not automatically qualified outputs.

## Array release acceptance

Use the handoff in `integration/array` against the current canonical contract. After KI publisher signing and real release-envelope generation, verify Array detects the installed product, rejects mismatched/unsigned candidates, downloads the right NSIS package, checks its hash/signature, installs, launches and updates it. Exercise the app/native/media process guards during update. A free-utility catalog entry must avoid purchase or activation requirements. The current unsigned candidate is expected to fail publisher trust; do not bypass that check.

There are no employee macOS/Linux packages in this release. Linux test results and archive integrity do not substitute for these Windows/Array acceptance outcomes.
