# Third-party notices · KI Metadata Workbench 0.4.0

Kuykendall Industries application code and brand assets remain subject to their existing ownership. This file describes bundled components; it does not change their individual licenses.

## Electron 44.9.0

The desktop runtime uses the official Windows or Linux x64 Electron distribution. Its `LICENSE.electron.txt` and `LICENSES.chromium.html` remain next to the application executable in the extracted runtime. The package preserves those upstream files. Electron source and component references: https://github.com/electron/electron and https://www.electronjs.org/.

## FFmpeg 9.0.2

`ffmpeg.exe` and `ffprobe.exe` were compiled from the unmodified FFmpeg 9.0.2 release source. GPL, nonfree, network support and external codec autodetection are disabled. The build enables local-file/pipe probing and stream-copy support; it is not the full fixture-generation toolchain.

The complete corresponding FFmpeg source is included at `source/ffmpeg-9.0.2.tar.xz`. `FFmpeg-COPYING.LGPLv2.1` and `FFmpeg-LICENSE.md` contain upstream license terms. `source/ffmpeg-configure.json` and the original build script record the exact options used. `source/rebuild-ffmpeg.py` provides a relocatable equivalent, explained in `source/BUILDING.md`.

The standalone engines are invoked as separate processes and can be replaced with compatible user-built executables through application settings. No proprietary library is linked into FFmpeg. The complete source is supplied with this release, not merely offered on request.

Linux packages rebuild FFmpeg and ffprobe from the same source archive and equivalent feature flags using `scripts/prepare-linux-tools.py`. The build command, source checksum and tool versions are recorded in the Linux build evidence.

Upstream: https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz. Original source SHA-256: `8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e`.

## ExifTool 13.59

The complete official Windows x64 distribution is included under `bin/exiftool` in the runtime and `vendor/win32-x64/exiftool` in the source package. The upstream launcher `exiftool(-k).exe` is renamed `exiftool.exe` to avoid a keep-open pause; its bytes are unchanged. The companion distribution, Perl runtime/modules and its notices are retained.

Linux packages include the upstream ExifTool script and modules under `bin/exiftool` and use the distribution's Perl interpreter. The Debian package declares Perl as a dependency; AppImage users need Perl installed. Additional optional Perl modules can affect less common formats such as compressed JPEG XL metadata.

ExifTool is distributed under the same terms as Perl (the Artistic License or GNU GPL). The complete upstream source is included as `source/Image-ExifTool-13.59.tar.gz`; the license texts in that archive and the Windows distribution remain authoritative. `ExifTool-README.txt` and `ExifTool-official-checksums.txt` are included. The application invokes ExifTool without automatically loading user configuration.

Official project: https://exiftool.org/. The source/archive and Windows distribution were checked against https://exiftool.org/checksums-13.59.txt. Source SHA-256: `668ea3acececb7235fbd0f4900e72d5f12c9b07e5c778fd36cb1e9b5828fd65a`. Windows ZIP SHA-256: `44b512b25af500724ba579d0a53c8fc5851628b692dd5e5d94ae4a15c2cba9ec`.

## Rust dependencies and compiler support

`Rust-dependencies.json` records the complete resolved Cargo package inventory, declared SPDX licenses, upstream repositories and included license files under `rust/`. This lockfile inventory includes build/target-specific packages that are not necessarily linked into the Windows binary. Where a crate archive omitted its license files, notices were obtained from its exact recorded upstream source revision. The Rust standard library is provided under MIT/Apache-2.0 terms; see https://github.com/rust-lang/rust.

The Windows crossbuild used MinGW GCC 13 and the GNU Rust target. Included MinGW/GCC copyright notices retain the runtime exceptions and component terms. The shipped engines' PE import inventories are recorded in the build evidence. No separate MinGW compiler installation is required to run them.

## Fonts and KI assets

Manrope is provided under the SIL Open Font License 1.1; the complete notice is included in `assets/fonts/OFL-Manrope.txt` inside the application and source. Sybil Display and the KI wordmark/icons are first-party ecosystem assets reused from the company's sources. The design references are documented in `docs/ECOSYSTEM_DESIGN.md` in the source package.

## Development tools

The npm lockfile records the development toolchain. TypeScript, electron-builder and test/browser tools are not runtime npm dependencies. The production application archive excludes the synthetic preview bridge and has no production npm dependencies.
