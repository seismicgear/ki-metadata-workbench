"""Assemble Linux downloads only after installed desktop and payload acceptance."""
from pathlib import Path
import hashlib
import json
import os
import platform
import re
import shutil
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def sha256(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8')


def main():
    os.chdir(ROOT)
    assert sys.platform == 'linux' and platform.machine() == 'x86_64', 'Qualify on actual Linux x64'
    pkg = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    version = pkg['version']
    assert re.fullmatch(r'\d+\.\d+\.\d+', version), 'Expected a plain release version'
    evidence = ROOT / 'release/ci-evidence'
    read = lambda name: json.loads((evidence / name).read_text(encoding='utf-8'))
    install = read('linux-install-acceptance.json')
    desktop = read('linux-packaged-desktop.json')
    appimage_desktop = read('linux-appimage-desktop.json')
    installed = read('linux-installed-runtime.json')
    appimage = read('linux-appimage-runtime.json')
    tool_build = read('linux-tools-build.json')
    assert tool_build == json.loads((ROOT / 'vendor/linux-x64/linux-tools-build.json').read_text(encoding='utf-8'))
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    assert commit == os.environ['GITHUB_SHA']
    for record in [install, desktop, appimage_desktop, tool_build]:
        assert record['version'] == version and record['commit'] == commit
        assert record['platform'] == 'linux' and record['arch'] == 'x64'
    assert install['installed_desktop_checks'] == 'passed' and install['application_removed']
    assert install['appimage_payload_verified'] and install['system_perl_and_brotli_verified']
    assert install['appimage_desktop_checks'] == 'passed'
    assert install['desktop_sandbox_disabled'] is False and desktop['chromium_sandbox_disabled'] is False
    # The AppImage wrapper selects its sandbox mode based on host support.
    assert isinstance(install['appimage_sandbox_disabled'], bool)
    assert install['appimage_sandbox_disabled'] is appimage_desktop['chromium_sandbox_disabled']
    assert install['appimage_default_launch_arguments'] == ['--no-sandbox']
    for record in [desktop, appimage_desktop]:
        assert record['actual_packaged_electron'] and record['passed'] >= 7
        assert len(record['checks']) == record['passed']
    assert sha256(ROOT / 'release' / f'KI-Metadata-Workbench-{version}-Linux-x64.AppImage') == appimage_desktop['installed_executable_sha256'] == install['appimage_executable_sha256']
    env = {**os.environ, 'KI_PACKAGED_RUNTIME': str(ROOT / 'release/linux-unpacked')}
    runtime = json.loads(subprocess.check_output(['node', 'scripts/verify-runtime.cjs'], env=env, text=True))
    for record in [runtime, installed, appimage]:
        assert record['version'] == version and record['platform'] == 'linux'
        assert record['installed_executable']['sha256'] == desktop['installed_executable_sha256']
        assert record['native_core_sha256'] == runtime['native_core_sha256']
        assert record['preview_bridge_excluded']
    native = ROOT / 'release/linux-unpacked/resources/bin/ki-meta'
    header = native.read_bytes()[:64]
    assert header[:6] == b'\x7fELF\x02\x01' and struct.unpack_from('<H', header, 18)[0] == 62, 'Expected x64 ELF native engine'
    dynamic = subprocess.check_output(['readelf', '-d', str(native)], text=True)
    libraries = re.findall(r'\(NEEDED\).*\[(.+?)\]', dynamic)
    runtime['native_dynamic_libraries'] = libraries
    (evidence / 'linux-runtime-integrity.json').write_bytes(encoded(runtime))
    destination = ROOT / 'release/publish'
    destination.mkdir(parents=True, exist_ok=True)
    assert not list(destination.iterdir()), 'Refusing to mix new release files with an earlier output'
    artifacts = []
    for kind, extension in [('appimage', 'AppImage'), ('deb', 'deb')]:
        name = f'KI-Metadata-Workbench-{version}-Linux-x64.{extension}'
        source = ROOT / 'release' / name
        assert source.is_file() and source.stat().st_size > 1_000_000, f'Missing Linux package: {name}'
        shutil.copy2(source, destination / name)
        artifacts.append({'kind': kind, 'filename': name, 'bytes': source.stat().st_size,
                          'sha256': sha256(destination / name), 'unsigned': True})
    run_url = f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    tag = os.environ.get('KI_RELEASE_TAG', f'v{version}')
    provenance = {
        'schema': 'industries.kuykendall.metadata.github-build', 'schema_version': 1,
        'version': version, 'repository': os.environ['GITHUB_REPOSITORY'], 'commit': commit,
        'run_url': run_url,
        'release_url': f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}/releases/tag/{tag}",
        'runner_os': os.environ.get('RUNNER_OS', 'Linux'), 'platform': 'linux', 'arch': 'x64',
        'unsigned': True, 'native_core_sha256': runtime['native_core_sha256'],
        'native_dynamic_libraries': libraries, 'installed_executable': runtime['installed_executable'],
        'artifacts': artifacts, 'runtime_resource_files_verified': runtime['verified_resource_files'],
        'asar_source_files_verified': runtime['verified_app_files'], 'preview_bridge_excluded': True,
        'linux_install_acceptance': install, 'packaged_desktop_acceptance': desktop,
        'appimage_desktop_acceptance': appimage_desktop,
        'linux_tools_build': tool_build,
        'minimum_linux_build_baseline': 'Ubuntu 24.04 x64 / glibc 2.39',
        'appimage_prerequisites': ['Compatible Linux desktop libraries', 'Perl', 'IO::Compress::Brotli / IO::Uncompress::Brotli'],
        'array_note': 'This unsigned GitHub release candidate is not an authenticated Array release envelope.',
    }
    (destination / 'BUILD_PROVENANCE-linux-x64.json').write_bytes(encoded(provenance))
    sums = ''.join(f'{sha256(file)}  {file.name}\n' for file in sorted(destination.iterdir()))
    (destination / 'SHA256SUMS-linux-x64.txt').write_text(sums, encoding='utf-8', newline='\n')
    print('Packaged two qualified Linux x64 downloads with platform-specific provenance and checksums.')
    print(sums, end='')


if __name__ == '__main__':
    main()
