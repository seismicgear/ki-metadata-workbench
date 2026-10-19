"""Rebuild Linux x64 media tools from the exact source shipped with the product."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / 'vendor/licenses/source'
ARCHIVES = {
    'ffmpeg-9.0.2.tar.xz': '8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e',
    'Image-ExifTool-13.59.tar.gz': '668ea3acececb7235fbd0f4900e72d5f12c9b07e5c778fd36cb1e9b5828fd65a',
}


def sha256(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def extract(archive, destination):
    assert sha256(archive) == ARCHIVES[archive.name], f'Unexpected upstream source bytes: {archive.name}'
    with tarfile.open(archive) as source:
        for member in source.getmembers():
            assert member.isfile() or member.isdir(), f'Unexpected archive entry: {member.name}'
            assert not Path(member.name).is_absolute() and '..' not in Path(member.name).parts
        source.extractall(destination, filter='data')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jobs', type=int, default=min(4, os.cpu_count() or 1))
    args = parser.parse_args()
    if args.jobs < 1:
        parser.error('--jobs must be positive')
    assert sys.platform == 'linux' and platform.machine() == 'x86_64', 'Build on Linux x64'
    for command in ['gcc', 'make', 'perl', 'readelf']:
        assert shutil.which(command), f'Install the build prerequisite: {command}'
    work = ROOT / '.tmp/linux-tools'
    destination = ROOT / 'vendor/linux-x64'
    evidence = ROOT / 'release/ci-evidence'
    # Both directories contain only this script's reproducible generated outputs.
    for directory in [work, destination]:
        if directory.exists():
            shutil.rmtree(directory)
        directory.mkdir(parents=True)
    evidence.mkdir(parents=True, exist_ok=True)
    for filename in ARCHIVES:
        extract(SOURCES / filename, work)
    source = work / 'ffmpeg-9.0.2'
    build = work / 'ffmpeg-build'
    build.mkdir()
    recorded = json.loads((SOURCES / 'ffmpeg-configure.json').read_text(encoding='utf-8'))
    # These are the Windows build's exact enabled/disabled media features. Linux
    # links FFmpeg libraries statically, and its normal system libc/libm dynamically.
    features = [flag for flag in recorded[recorded.index('--disable-everything'):]
                if not flag.startswith('--extra-ldflags=')]
    assert {'--disable-network', '--disable-gpl', '--disable-nonfree',
            '--disable-autodetect', '--disable-shared', '--enable-static'} <= set(features)
    command = [str(source / 'configure'), '--prefix=' + str(build / 'install'),
               '--target-os=linux', '--arch=x86_64', '--cc=gcc', *features]
    print('Building FFmpeg and ffprobe from the supplied source; log: release/ci-evidence/linux-tools-build.log', flush=True)
    log_file = evidence / 'linux-tools-build.log'
    with log_file.open('w', encoding='utf-8') as log:
        try:
            subprocess.run(command, cwd=build, stdout=log, stderr=subprocess.STDOUT, check=True)
            subprocess.run(['make', '-j' + str(args.jobs)], cwd=build, stdout=log, stderr=subprocess.STDOUT, check=True)
            subprocess.run(['make', 'install'], cwd=build, stdout=log, stderr=subprocess.STDOUT, check=True)
        except subprocess.CalledProcessError:
            log.flush()
            print('\n'.join(log_file.read_text(encoding='utf-8', errors='replace').splitlines()[-60:]), file=sys.stderr)
            raise
    engines = []
    for name in ['ffmpeg', 'ffprobe']:
        file = destination / name
        shutil.copy2(build / 'install/bin' / name, file)
        file.chmod(0o755)
        version = subprocess.check_output([str(file), '-version'], text=True)
        assert version.startswith(name + ' version 9.0.2 '), version
        assert '--disable-network' in version and '--disable-gpl' in version
        dynamic = subprocess.check_output(['readelf', '-d', str(file)], text=True)
        libraries = re.findall(r'\(NEEDED\).*\[(.+?)\]', dynamic)
        assert not any(re.match(r'libav|libsw', library) for library in libraries), libraries
        engines.append({'file': name, 'bytes': file.stat().st_size, 'sha256': sha256(file),
                        'version': version.splitlines()[0], 'dynamic_libraries': libraries})
    exif_source = work / 'Image-ExifTool-13.59'
    exif_destination = destination / 'exiftool'
    exif_destination.mkdir()
    shutil.copytree(exif_source / 'lib', exif_destination / 'lib')
    for name in ['exiftool', 'README', 'Changes']:
        shutil.copy2(exif_source / name, exif_destination / name)
    exiftool = exif_destination / 'exiftool'
    exiftool.chmod(0o755)
    version = subprocess.check_output([str(exiftool), '-config', '', '-ver'], text=True).strip()
    assert version == '13.59', version
    engines.append({'file': 'exiftool/exiftool', 'bytes': exiftool.stat().st_size,
                    'sha256': sha256(exiftool), 'version': version, 'system_interpreter': 'perl'})
    manifest = {
        'schema': 'industries.kuykendall.metadata.linux-tools-build', 'schema_version': 1,
        'version': json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version'],
        'platform': 'linux', 'arch': 'x64',
        'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'source_archives': [{'file': filename, 'sha256': digest} for filename, digest in ARCHIVES.items()],
        'ffmpeg_feature_flags': features,
        'ffmpeg_configure_command': command,
        'ffmpeg_static_libraries': True, 'system_libc_dynamic': True,
        'compiler': subprocess.check_output(['gcc', '--version'], text=True).splitlines()[0],
        'engines': engines,
        'system_runtime_dependencies': ['perl', 'libio-compress-brotli-perl'],
    }
    encoded = json.dumps(manifest, indent=2) + '\n'
    (destination / 'linux-tools-build.json').write_text(encoded, encoding='utf-8')
    (evidence / 'linux-tools-build.json').write_text(encoded, encoding='utf-8')
    print('Built and verified Linux x64 FFmpeg 9.0.2, ffprobe 9.0.2 and ExifTool 13.59.', flush=True)


if __name__ == '__main__':
    main()
