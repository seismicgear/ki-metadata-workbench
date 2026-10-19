# Qualification report · 0.4.0

**255 application checks passed**, plus **8 Array adapter contract checks**. The attached 0.2.0 and delivered 0.3.0 features were combined, with the strict privacy engine and its test file unchanged. The Windows x64 portable and NSIS packages built and passed complete payload verification. Actual Windows runtime/install acceptance has not been performed in this Linux environment.

## Completed suites

| Suite | Passed | Evidence |
|---|---:|---|
| Model, shell and enterprise unit behavior | 75 | `evidence/node-tests-0.4.0.txt` |
| Rust unit tests | 29 | `evidence/rust-tests-0.4.0.txt` |
| Real media integration | 12 | `evidence/media-tests-0.4.0.txt` |
| Strict image privacy integration | 35 | `evidence/privacy-tests-0.4.0.txt` |
| Expanded format integration, full upstream fixture set | 49 | `evidence/expanded-tests-0.4.0.txt` |
| Native enterprise inventory/scan integration | 11 | `evidence/enterprise-tests-0.4.0.txt` |
| Synthetic browser workflows | 23 | `evidence/browser-tests-0.4.0.txt` |
| Original actual Electron/native workflows | 10 | `evidence/desktop-tests-0.4.0.txt` |
| New actual Electron/native enterprise workflows | 11 | `evidence/enterprise-desktop-tests-0.4.0.txt` |
| Array adapter contract, mocked OS boundary | 8 additional | `evidence/array-adapter-tests-0.4.0.txt` |

TypeScript compilation and the Linux release build passed. The Windows core was compiled successfully from a fresh target directory using the locked/offline dependency set. Manual UI checks at 1540 and 980 pixels found no horizontal page overflow; these visual checks are not added to the automated count.

## Behavior covered

The unchanged strict image suite covers JPEG/PNG/APNG/WebP embedded EXIF/GPS, C2PA/JUMBF, AI/Stable Diffusion text and other removable containers, encoded image/animation retention, malformed structures, trailers and strict output rescanning. The expanded suite covers PDF full-rewrite cleanup, all listed Office/OpenDocument routes, signed/unsafe package refusal, unsupported-file read-only behavior and representative extended/RAW images from ExifTool's upstream corpus. Successful tests qualify those fixtures and operations, not every proprietary variant or codec.

New unit/native checks cover independent SHA-256 comparison, byte fingerprints, recognized extension mismatches, strict-inspect compatibility, tolerant inventory, bounded scan behavior, separate path/value disclosure, nonzero partial failures, native inspection locks, comparison with repeated tags, exact duplicates, CSV formula handling, report limits and preservation of earlier batch drafts.

The real Electron suites exercise the production main/preload/native path. They open actual generated files, perform actual saves and report exports, and check resulting bytes/metadata. OS picker responses are automated. New coverage includes launch-file import, paused automatic preview in inspection mode, IPC write/restore refusal, metadata comparison, default report disclosure, explicit detailed CSV export, mode changes retaining drafts, batch undo, verified batch copies and immutable `--inspect-only` sessions. These are real Linux Electron runs; they do not establish Windows dialog, filesystem or installer behavior.

The Array patch applies to the inspected commit, and its helper works with Array's actual adapter factory. Mocked OS tests confirm the identity and signature checks remain effective, including refusal of unsigned candidates. No repository was published or native installer executed by those tests.

## Observed environment and reruns

Node 24.19.0; npm 11.9.0; TypeScript 5.9.3; Rust/Cargo 1.99.1; Electron 44.9.0; electron-builder 26.15.3; Playwright 1.62.1. Linux media integration used FFmpeg/ffprobe 6.1.1 and ExifTool 13.59. The Windows package includes crossbuilt FFmpeg/ffprobe 9.0.2 and the full ExifTool 13.59 Windows distribution, including Brotli support. Those Windows media binaries were not executed here.

`npm test` runs model/shell/enterprise units, Rust units, release compilation and native media/privacy/expanded/enterprise suites. Use Python 3 and a full FFmpeg fixture generator; set `PYTHON` if it is named differently. Point `KI_EXIFTOOL` at a trusted tool and `KI_EXIFTOOL_FIXTURES` at the extracted upstream source's `t/images` for the full 49 expanded checks. Without that corpus, additional image cases are explicitly not run. Compressed JXL editing requires Brotli support.

`npm run test:browser` uses Playwright/Chromium; `PW_CHROMIUM_PATH` selects an existing runtime. `npm run test:desktop` runs both production desktop suites; `KI_ELECTRON_PATH` can select the executable. Test runtime dependencies are for development, not employee installation. The Array handoff describes its separate contract verification command.

## Windows package verification

| Package | Bytes | SHA-256 |
|---|---:|---|
| KI-Metadata-Workbench-0.4.0-Windows-x64-Portable.exe | 138,303,966 | `f8d6ad9e5f5ed297f9683bd7e333f9533757e1c636bc3ca23b7b75bffd8c2583` |
| KI-Metadata-Workbench-0.4.0-Windows-x64-Setup.exe | 138,523,386 | `ed42972e11698a43f4b98730d55c7f919734c88e1f919c039893bb3c56e370d4` |

Both outer NSIS containers and their nested application 7z archives passed integrity checks. Each package's **799 application payload files** matched the frozen runtime byte for byte, totaling **610,669,153 bytes** before compression. The payloads share the same nested archive. All **53 ASAR files** matched their staged application inputs, with no preview bridge. Native tools and the full license tree matched the packaged files.

**71 retained Electron files** match the official archive exactly. The main executable has intentionally updated product/version/icon resources; all **14 non-resource PE sections**, their addresses/characteristics and the overlay were verified unchanged. The in-place resource edit also verifies every byte outside its allowed resource/checksum range. Version-resource readback identifies Kuykendall Industries / KI Metadata Workbench / 0.4.0.0. See `evidence/windows-brand-resources-0.4.0.json`.

The Linux packaging route used electron-builder's native NSIS uninstaller reader to extract the generated uninstaller rather than executing a Windows process. The native engine and FFmpeg/ffprobe import system DLLs without separate MinGW runtime DLLs. The package evidence records unsigned PE certificate tables and explicitly records that neither Windows package was run.

The final evidence is `evidence/windows-package-evidence-0.4.0.json`, with the complete payload inventory; `windows-package-integrity-0.4.0.txt`, `windows-package-0.4.0.txt`, `windows-core-build-0.4.0.txt` and `windows-imports-0.4.0.json` record the build/archive/import checks. Signing, clean-account Windows launch, actual Windows pickers/locks, install/uninstall and an end-to-end Array release remain [Windows acceptance](WINDOWS_ACCEPTANCE.md) and publication gates.

## Data and limits

Tests used generated fixtures and upstream test images, not employee files. Reports/findings are not certified evidence or anonymity guarantees. C2PA removal does not validate provenance, and a signature hint is not malware scanning. Orientation/profile removal can change appearance even when retained compressed image data matches. Other formats retain the precise cleanup and verification scopes in [FORMATS.md](FORMATS.md).

`docs/SOURCE_SHA256.json` hashes every source-archive file except itself. Internal browser screenshots, employee data, dependency caches and local fixture runtimes are excluded from the source deliverable.
