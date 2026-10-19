<div align="center">
<img src="assets/metadata-mark.svg" width="100" alt="METADATA">

# METADATA · 0.4.0
### Know what you share.

A free, standalone file utility by **Kuykendall Industries**. Prepared for the Array launcher.

</div>

## Download and open

[GitHub Releases](https://github.com/seismicgear/ki-metadata-workbench/releases/tag/v0.4.0) · [Build and qualification](https://github.com/seismicgear/ki-metadata-workbench/actions/workflows/windows-release.yml)

GitHub release candidates are built and tested on Windows and Ubuntu 24.04 x64. Both platform jobs must pass before the release is published. The attached checksums and build provenance identify the exact downloads and source commit. See [GitHub packaging](docs/GITHUB_RELEASES.md).

| Download | Use it for |
|---|---|
| [KI-Metadata-Workbench-0.4.0-Windows-x64-Portable.exe](https://github.com/seismicgear/ki-metadata-workbench/releases/download/v0.4.0/KI-Metadata-Workbench-0.4.0-Windows-x64-Portable.exe) | Open the utility without an installer. |
| [KI-Metadata-Workbench-0.4.0-Windows-x64-Setup.exe](https://github.com/seismicgear/ki-metadata-workbench/releases/download/v0.4.0/KI-Metadata-Workbench-0.4.0-Windows-x64-Setup.exe) | Install for the current Windows user, choose an installation folder, and create shortcuts. This is the package intended for Array distribution. |
| [KI-Metadata-Workbench-0.4.0-Linux-x64.deb](https://github.com/seismicgear/ki-metadata-workbench/releases/download/v0.4.0/KI-Metadata-Workbench-0.4.0-Linux-x64.deb) | Install on Ubuntu 24.04 or a compatible x64 Debian-based system; runtime dependencies are installed by the package manager. |
| [KI-Metadata-Workbench-0.4.0-Linux-x64.AppImage](https://github.com/seismicgear/ki-metadata-workbench/releases/download/v0.4.0/KI-Metadata-Workbench-0.4.0-Linux-x64.AppImage) | Run on a compatible x64 Linux desktop with glibc 2.39 or later, Perl and the Brotli Perl module. |
| [KI-Metadata-Workbench-0.4.0-Source.zip](https://github.com/seismicgear/ki-metadata-workbench/releases/download/v0.4.0/KI-Metadata-Workbench-0.4.0-Source.zip) | Complete source, tests, Windows native engine, vendor tools, licenses and Array handoff. |

All desktop downloads include Electron, the platform's Rust metadata engine, ExifTool, FFmpeg and ffprobe. Windows packages include their Perl runtime; Linux uses the system Perl interpreter and Brotli module. Employees need no development tools, separate FFmpeg/ExifTool installation, account or license activation. Processing stays on their computer. The app also runs independently of Array.

GitHub downloads are **unsigned release candidates**. Publication requires both native platform builds, desktop workflows, packaged-payload verification and installer acceptance. The release includes a common checksum list, combined provenance and separate Windows/Linux evidence. [TEST_REPORT.md](docs/TEST_REPORT.md) preserves the original local qualification; [WINDOWS_ACCEPTANCE.md](docs/WINDOWS_ACCEPTANCE.md) remains the checklist for an employee-device pilot.

### Linux installation

On Ubuntu 24.04, install the downloaded Debian package with:

```sh
sudo apt install ./KI-Metadata-Workbench-0.4.0-Linux-x64.deb
```

For the AppImage, install its Perl prerequisites, make it executable, then launch it. Extraction mode also works on systems without FUSE:

```sh
sudo apt install perl libio-compress-brotli-perl
chmod +x KI-Metadata-Workbench-0.4.0-Linux-x64.AppImage
./KI-Metadata-Workbench-0.4.0-Linux-x64.AppImage --appimage-extract-and-run
```

The Linux candidate is qualified on Ubuntu 24.04 x64. Older glibc systems and ARM64 are not targets of this release. The Debian package is the recommended installation for Ubuntu desktops.

## The combined upgrade

Version 0.4.0 combines the attached 0.2.0 privacy workbench with the 0.3.0 format and team-workflow upgrades. The attachment was compared file by file: all 73 baseline files were already represented, with no missing file. The strict image privacy engine and its 35-check integration suite remain byte-identical. The merge record is in [MERGE_0.4.0.md](docs/MERGE_0.4.0.md).

The interface now follows the supplied Array hybrid reference more closely: actual Array Display/Text fonts, its steel-and-red ribbon background, near-black surfaces, fine borders and chamfered controls. METADATA has its own mark and Windows icon, while retaining the existing application identity for local settings and history.

### New workspaces

| Workspace | What it does |
|---|---|
| **Files** | Select files, inspect common fields, stage edits and save copies. |
| **Overview** | Review findings, staged work, files with no qualified writer and exact file duplicates. Filter the file scope from the overview. |
| **Inspect** | See SHA-256 and BLAKE3 fingerprints, signature/type hints, the header bytes and categorized metadata findings. A recognized extension mismatch disables writes. |
| **Compare** | Compare two metadata inventories by namespace and key; show added, removed, changed and unchanged values. Repeated tags retain their duplicate counts. |
| **Batch edit** | Preview a set, removal or literal find-and-replace across compatible fields, stage changes, undo the batch, then save copies. Earlier drafts survive undo. |
| **Reports** | Export a JSON or CSV inventory with case labels, hashes, findings and actual output verification. Names, paths and source values are omitted by default. |
| **Team presets** | Select reusable company values and exchange validated preset packs between employees. |

**Inspect only** blocks source edits and backup restoration in the main process. Launch with `--inspect-only` for a session that cannot be unlocked through the UI. Automatic media playback/preview loading pauses in this mode; an employee can explicitly load a preview. This is an application write policy, not an operating-system forensic write blocker.

## Prepare files for sharing

1. Add files, add a folder, or drop files into the workspace. Use checkboxes for a batch.
2. Open **Prepare for sharing** and review the cleanup scope for each file family.
3. Choose **Stage recommended cleanup**. Existing drafts on eligible files are replaced so old private values are not added back.
4. Choose **Save copy** or **Save N copies**. A batch uses one destination-folder selection. Optional neutral names produce outputs such as `KI-share-001.png`; collisions receive a suffix.
5. Review the actual save result and **Audit**. The original files remain intact when saving copies.

The [employee guide](docs/EMPLOYEE_GUIDE.md) covers everyday edits, inspection, comparison, reports, batch work and recovery. `Ctrl+K` opens commands and `Ctrl+O` opens files. Comfortable/compact density and reduced-motion settings remain available.

## Formats and privacy scope

There are **84 extension routes**, plus read-only inventory for other regular files. Capabilities come from the actual file and writer; the extension count does not promise that every proprietary variant is editable. Full details are in [FORMATS.md](docs/FORMATS.md).

| Family | Examples | Available work |
|---|---|---|
| Native images | JPEG, PNG/APNG, WebP | Strict embedded-metadata stripping; JPEG/PNG descriptive XMP editing. |
| Extended images and RAW | TIFF, HEIC/HEIF, AVIF, JPEG XL/2000, GIF, PSD/PSB, DNG, NEF, ARW, CR2/CR3, RAF and others | Inspection, curated XMP edits and scoped cleanup where qualified; some variants are copy-only or read-only. |
| Audio | MP3, FLAC, WAV/WAVE, AIFF/AIFC, M4A/M4B, OGG/OGA, Opus | Supported text tags, artwork, lyrics and scoped cleanup. |
| Video | MP4, MOV, M4V, MKV, WebM, AVI, WMV/ASF | Container tags and scoped cleanup through an acknowledged all-stream remux. |
| Documents | PDF, Office Open XML, OpenDocument | Document-property editing and cleanup with content checks. Signed/encrypted files are read-only. |
| Other regular files | Archives, executables, unfamiliar formats or files without extensions | Fingerprints, signature hints and available metadata inventory. No generic writer. |

### Strict image stripping

For JPEG, PNG/APNG and WebP, **Strip image metadata** removes complete EXIF/GPS, XMP, IPTC, C2PA/JUMBF, text/comment, ICC and private metadata blocks, embedded thumbnails and trailers. This includes AI generation tags, Stable Diffusion parameters, prompts, negative prompts, seeds, model/settings text and ComfyUI workflows stored in those removable containers. It preserves encoded image/frame data and required structures, rescans the output, and compares the retained encoded content before committing. Strict stripping cannot be combined with new tags or artwork.

Removing orientation metadata can change displayed rotation or mirroring; removing ICC profiles can change color appearance. The UI reports those conditions. Other image formats use narrower scoped cleanup that retains rendering/calibration data. Audio/video cleanup also has a defined tag scope. Document cleanup removes properties, not document content, comments, tracked changes, speaker notes or attachments.

The app does not remove visible content, pixel watermarks, sidecars, filesystem metadata or external provenance records. Finding categories are review prompts; signature hints are not malware detection or C2PA signature validation. Reports containing hashes can identify a known file even when its name is omitted. See [SECURITY.md](docs/SECURITY.md).

## Employees, IT and Array

Distribute the appropriate Windows or Linux download through the normal internal software channel. Each employee uses their own OS account, files and local settings. A custom team preset pack is optional. There is no central account, enrollment service, runtime upload, telemetry or embedded update server.

A locked inspection shortcut can target the installed application:

```powershell
& 'C:\KI Tools\KI Metadata Workbench.exe' --inspect-only 'C:\Review\sample.png'
```

Use the actual installation path. Absolute file arguments are imported, and later launches hand files to the existing app. `KI_READ_ONLY=1` also enforces the native save/restore block. It is a local workflow safeguard, not central policy against an employee who controls their environment.

[integration/array/README.md](integration/array/README.md) contains the source-defined Windows adapter, registration patch, product intent, verified artifact inventory and publication requirements. It is prepared against the inspected Array commit and has not been published to Array or the Store. Array's canonical Store contract needs a free-utility category before publication; no purchase, activation or invented community license is added to this app.

## Local CLI and reusable engine

The installed core is `resources/bin/ki-meta.exe`. Keep it alongside the bundled media tools.

```powershell
.\resources\bin\ki-meta.exe inventory 'C:\Review\sample.png'
.\resources\bin\ki-meta.exe scan --recursive 'C:\Review' > inventory.jsonl
.\resources\bin\ki-meta.exe scan --recursive --include-paths 'C:\Review' > inventory-with-paths.jsonl
```

Default scan rows omit names, paths and metadata values; diagnostics on stderr can contain paths. `--full` deliberately includes the complete inspection, including private values and paths. Scans are bounded to 1,000 files and 10,000 directory entries, skip links/special files/hidden directories, and return nonzero for failures or exceeded limits while keeping completed JSONL rows valid.

`inventory` can return a read-only fingerprint/diagnostic when metadata parsing fails. Existing `inspect` preserves strict parser errors. `ki-meta serve` exposes the local JSON-lines process protocol for other KI applications. The complete contract and report schema are in [INTEGRATION.md](docs/INTEGRATION.md).

## Source builds and qualification

Employees use the packaged downloads. Developers use Node.js 22+, stable Rust and a platform linker. On Windows, rebuilding the core requires Rust MSVC, Visual Studio C++ Build Tools and a Windows SDK.

```powershell
npm ci
npm run doctor
npm run build
npm start
npm run dist:portable
npm run dist:win
```

For Linux packages, install a C compiler, GNU make, Perl and the Brotli Perl module, then run `npm run dist:linux`. It rebuilds the bundled FFmpeg tools from the included source and produces the AppImage and Debian package. Match the Ubuntu 24.04 build environment for the published compatibility baseline. The release workflow records the full platform qualification.

`Launch.cmd` can reuse the included Windows native engine and builds the UI before launch; Rust is needed only if the engine is absent or deliberately rebuilt. Initial dependency installation requires internet access. The pinned npm/Cargo lockfiles and complete Windows vendor/license tree are included. On other development platforms supply trusted ExifTool/FFmpeg/ffprobe with `KI_EXIFTOOL`, `KI_FFMPEG` and `KI_FFPROBE` or the app's tool settings.

**The original local qualification passed 255 application checks**, plus **8 Array adapter contract checks**: 75 model/shell/enterprise unit, 29 Rust, 12 media, 35 strict privacy, 49 expanded formats, 11 native enterprise, 23 synthetic browser, and 21 actual Electron/native workflow checks. TypeScript compilation and a fresh Windows core crossbuild also succeeded. These counts qualify the tested fixtures and operations, not every possible file variant. The GitHub Windows workflow adds platform qualification, Unicode path/value regression coverage and actual installed-application checks; its run and the attached build evidence identify the release results.

`npm test` runs the unit and native integration gates. Python 3 and a full FFmpeg fixture generator are required for tests, not employee runtime. `KI_EXIFTOOL_FIXTURES` selects the upstream ExifTool test images; without it additional image cases are explicitly skipped. Browser and desktop suites use the pinned Playwright dependency and suitable Chromium/Electron runtimes. [TEST_REPORT.md](docs/TEST_REPORT.md) documents exact commands, evidence and platform limits.

`KI-Metadata-Workbench-Preview.html` is a self-contained demonstration with synthetic files and real-file writes disabled. It and its preview bridge are excluded from the production runtime. [ECOSYSTEM_DESIGN.md](docs/ECOSYSTEM_DESIGN.md) records the first-party design sources. [SOURCE_SHA256.json](docs/SOURCE_SHA256.json) covers every supplied source-archive file except itself.
