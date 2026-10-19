# GitHub packaging and releases

The canonical repository is `seismicgear/ki-metadata-workbench`. The repository contains the complete workbench, its Windows vendor tools, dependency sources/licenses and the original qualification evidence. Employee downloads are published under GitHub Releases.

`.github/workflows/windows-release.yml` runs on relevant main-branch changes, pull requests and manual dispatch. It rebuilds the Rust engine on Windows, compiles/tests the UI, uses the bundled upstream image corpus, exercises real native and Electron workflows, packages the portable/NSIS targets, then installs, launches and uninstalls the packaged app on the disposable runner. It assembles the complete source ZIP, SHA-256 sums and build provenance.

Build jobs have read-only repository access. A separate publish job has only the contents-write permission required to create the version tag and upload the verified release assets. Third-party actions are pinned to inspected commit SHAs. Pull requests cannot publish. Existing releases are kept unchanged; a new release requires a version bump and matching `docs/releases/vX.Y.Z.md` notes.

The first release is marked as an unsigned preview. The native executable in the imported repository is the earlier crossbuild; the GitHub release workflow replaces that build output with an MSVC Windows build from the current native source before testing and packaging. The Windows target statically links the C runtime so the native engine does not require a separate Visual C++ runtime installation. The release source ZIP contains the engine that was actually packaged, with an updated source-integrity manifest. Release checksums/provenance describe these GitHub-built assets; historical evidence files preserve the earlier local artifact hashes.

Windows qualification also caught a code-page issue in ExifTool's command-line arguments. The native adapter now pipes UTF-8 argument records, escaping multiline values as individual arguments and keeping user configuration disabled. Regression coverage checks Unicode names, metadata and option-like text. The strict image privacy module and its original regression suite remain byte-identical.

For Array, use the installed product identity and adapter in `integration/array`. The source ZIP contains updated candidate artifact hashes for its corresponding packages. The published SHA256SUMS and BUILD_PROVENANCE are authoritative for the GitHub downloads. Production Array distribution still requires KI publisher signing and a real authenticated release envelope; do not bypass Array's trust checks for this unsigned preview.

GitHub's automatic repository source archives contain tracked source. The explicit Source.zip release asset also includes the qualified Windows native engine, complete bundled vendor tree and the Windows installation evidence from that build.
