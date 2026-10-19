# GitHub packaging and releases

The canonical repository is `seismicgear/ki-metadata-workbench`. GitHub Releases contains the Windows x64 portable executable and installer, Linux x64 AppImage and Debian package, source ZIP, SHA-256 sums and build provenance.

## Build and publication

`.github/workflows/windows-release.yml` retains its original workflow URL and now qualifies both Windows and Linux. It runs on relevant main-branch changes, pull requests and manual dispatch. Each platform rebuilds its Rust engine, compiles/tests the UI, exercises native and real Electron workflows, verifies all packaged application and resource bytes, and records installation evidence. Windows produces the source ZIP, including its freshly rebuilt Windows engine and source-integrity manifest.

The Windows integrity checker uses host-native paths when reading ASAR entries. Earlier runs had built and installed successfully, but a POSIX-style lookup on Windows prevented the final assembly step from completing. The fix preserves verification of every packaged source file.

Linux is built and qualified on Ubuntu 24.04 x64. Its FFmpeg and ffprobe are rebuilt from the checksum-pinned, included FFmpeg 9.0.2 source with the same restricted media features as Windows. FFmpeg libraries are statically linked; system libc/libm remain dynamic. The included ExifTool 13.59 source runs through the system Perl interpreter. The Debian package declares its desktop, Perl and Brotli dependencies. The AppImage requires compatible desktop libraries, glibc 2.39 or later, Perl and the Brotli Perl module; extraction mode works without FUSE.

The Linux job uses a full system FFmpeg to generate and independently decode test fixtures. Native audio/video operations retain the bundled tool paths so the shipped media tools perform the actual edit and verification operations. Strict image privacy, expanded formats, inventory and desktop operations are qualified separately.

Build jobs have read-only repository access. A separate publish job receives only the contents-write permission needed to create the version tag and upload release assets. Third-party actions are pinned to commit SHAs. Pull requests run qualification without publishing.

Both platform jobs must pass. `scripts/assemble-release.py` requires the exact expected artifact set, matching version and source commit, and correct size and SHA-256 for every package. It then creates a combined `BUILD_PROVENANCE.json` and `SHA256SUMS.txt`. The release also includes `BUILD_PROVENANCE-windows-x64.json` and `BUILD_PROVENANCE-linux-x64.json` with the detailed platform evidence. Existing releases remain unchanged; use a new version and matching `docs/releases/vX.Y.Z.md` notes for another candidate.

## Installing the candidate

On Windows, use `Windows-x64-Setup.exe` for a per-user installation or `Windows-x64-Portable.exe` to run without installation. Both include their media tools and Perl runtime. The native MSVC engine statically links its C runtime.

On Ubuntu 24.04, install the downloaded `.deb` with `sudo apt install ./KI-Metadata-Workbench-0.4.0-Linux-x64.deb`. This is the preferred Linux desktop installation. For the AppImage, install `perl` and `libio-compress-brotli-perl`, mark the file executable, and run it with `--appimage-extract-and-run` when FUSE is unavailable. The Debian package installs the desktop sandbox profile supplied by electron-builder; its standard AppImage AppRun launcher disables the Chromium sandbox, so prefer the Debian package for the sandboxed desktop installation.

## Release status and Array

This version is an **unsigned GitHub prerelease / release candidate**. The explicit `/releases/tag/v0.4.0` and versioned download links identify it; GitHub excludes prereleases from the stable `/releases/latest` endpoint.

For Array, the existing Windows adapter and product identity remain in `integration/array`. Its source ZIP contains the Windows candidate artifact hashes. The common SHA256SUMS and platform provenance identify the GitHub downloads. Signing and the authenticated Array/Store release envelope remain separate distribution steps.
