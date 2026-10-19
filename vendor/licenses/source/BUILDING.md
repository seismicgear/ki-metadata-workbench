# Rebuilding the bundled media engines

## FFmpeg

The adjacent `ffmpeg-9.0.2.tar.xz` is the complete unmodified source used for the supplied FFmpeg/ffprobe executables. Extract it into a source directory. Install a GNU make environment and an x86_64 MinGW-w64 GCC toolchain. The release used GCC 13 with the POSIX runtime variant.

Run the relocatable `rebuild-ffmpeg.py` with `--source`, a fresh `--output` directory, and the toolchain's `--cross-prefix`. Optionally pass `--cc` to select a specific GCC driver and `--jobs` to set build parallelism. The script creates local windres/preprocessor wrappers and writes the configure command and build log into the output directory. It runs configure, make and make install. No source patch is applied.

Example from a Linux development host:

```sh
python3 rebuild-ffmpeg.py --source /work/ffmpeg-9.0.2 --output /work/ffmpeg-windows --cross-prefix /usr/bin/x86_64-w64-mingw32- --cc /usr/bin/x86_64-w64-mingw32-gcc-posix
```

The exact original command is recorded in `ffmpeg-configure.json`. Paths in that historical record, `build-ffmpeg-windows.py`, `cpp-ki` and `windres-ki` refer to the build environment; they are evidence, not installation paths. The relocatable script applies equivalent feature flags with your source/compiler/build locations. Different compiler versions or timestamps can produce different binary hashes.

Copy `install/bin/ffmpeg.exe` and `install/bin/ffprobe.exe` into `vendor/win32-x64` before packaging, or choose your compatible builds through the application settings. These programs are standalone subprocesses. The Workbench's own verification and input format/protocol limits still apply.

## ExifTool

`Image-ExifTool-13.59.tar.gz` includes the source, documentation and upstream test corpus. ExifTool can run from that source with Perl; see its included README and installation instructions. The Windows portable uses the official complete Windows distribution with its companion Perl runtime. Keep the full `exiftool_files` tree beside `exiftool.exe`.

For compressed JXL metadata, the Perl environment needs the Brotli module. It is included in the supplied Windows distribution. Development environments without it correctly expose those files as inspection-only.

## Application

The project README describes the Node/Rust source build. `package.json` includes the vendor and license trees in Windows packaging. The portable is an unsigned x64 build; source rebuilding alone is not native Windows runtime acceptance. See the test report for executed checks and remaining platform-specific qualification.
