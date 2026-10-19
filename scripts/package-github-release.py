"""Assemble qualified GitHub assets without including caches or employee files."""
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
pkg = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
version = pkg['version']
assert re.fullmatch(r'\d+\.\d+\.\d+', version), 'Expected a plain release version'
assert sys.platform == 'win32', 'Release packaging requires the qualified Windows build'
evidence_dir = ROOT / 'release/ci-evidence'
install = json.loads((evidence_dir / 'windows-install-acceptance.json').read_text(encoding='utf-8-sig'))
desktop = json.loads((evidence_dir / 'packaged-desktop.json').read_text(encoding='utf-8'))
assert install['version'] == desktop['version'] == version
assert install['installed_desktop_checks'] == 'passed' and install['application_removed']
assert desktop['actual_packaged_electron'] and desktop['platform'] == 'win32' and desktop['passed'] >= 7
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
assert install['commit'] == desktop['commit'] == os.environ['GITHUB_SHA'] == commit
runtime = json.loads(subprocess.check_output(['node', 'scripts/verify-runtime.cjs'], text=True))
assert runtime['installed_executable']['sha256'] == desktop['installed_executable_sha256']

def native_imports(file):
    """Read PE32+ import names to reject an accidental VC redistributable dependency."""
    data = file.read_bytes()
    assert data[:2] == b'MZ'
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    assert data[pe:pe + 4] == b'PE\0\0'
    optional = pe + 24
    assert struct.unpack_from('<H', data, optional)[0] == 0x20b, 'Expected an x64 native engine'
    count = struct.unpack_from('<H', data, pe + 6)[0]
    sections = optional + struct.unpack_from('<H', data, pe + 20)[0]
    def offset(rva):
        for index in range(count):
            size, address, raw_size, raw = struct.unpack_from('<IIII', data, sections + index * 40 + 8)
            if address <= rva < address + max(size, raw_size):
                return raw + rva - address
        raise AssertionError('Unmapped PE address')
    cursor = offset(struct.unpack_from('<I', data, optional + 112 + 8)[0])
    names = []
    for _ in range(256):
        descriptor = struct.unpack_from('<IIIII', data, cursor)
        if not any(descriptor):
            return names
        start = offset(descriptor[3])
        names.append(data[start:data.index(b'\0', start)].decode('ascii'))
        cursor += 20
    raise AssertionError('Unterminated PE imports')

imports = native_imports(ROOT / 'release/win-unpacked/resources/bin/ki-meta.exe')
assert imports and not any(re.match(r'(?i)^(vcruntime|msvcp|concrt|ucrtbased)', name) for name in imports), imports
runtime['native_imports'] = imports
runtime['native_vc_redistributable_required'] = False
(evidence_dir / 'runtime-integrity.json').write_text(json.dumps(runtime, indent=2) + '\n', encoding='utf-8')

def sha256(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def entry(file):
    return {'filename': file.name, 'bytes': file.stat().st_size, 'sha256': sha256(file)}

def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8')

destination = ROOT / 'release/publish'
destination.mkdir(parents=True, exist_ok=True)
assert not list(destination.iterdir()), 'Refusing to mix new release files with an earlier output'
artifacts = []
for kind, suffix in [('portable', 'Portable'), ('nsis', 'Setup')]:
    filename = f'KI-Metadata-Workbench-{version}-Windows-x64-{suffix}.exe'
    source = ROOT / 'release' / filename
    assert source.is_file() and source.stat().st_size > 1_000_000, f'Missing package: {filename}'
    shutil.copy2(source, destination / filename)
    artifacts.append({'kind': kind, **entry(destination / filename), 'unsigned': True})

run_url = f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
release_url = f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}/releases/tag/v{version}"
candidate = json.loads((ROOT / 'integration/array/release-artifacts.json').read_text(encoding='utf-8'))
candidate['status'] = 'unsigned-github-preview-not-an-authenticated-array-release'
candidate['artifacts'] = artifacts
candidate['installed_executable'] = {**runtime['installed_executable'], 'product_name': pkg['productName'], 'native_id': pkg['build']['appId']}
candidate['build'] = {'commit': commit, 'run_url': run_url, 'release_url': release_url, 'windows_runner_acceptance': 'passed'}
candidate['array_production_publication_requires'] = candidate.pop('release_publication_requires', [])
candidate['note'] = 'These hashes identify this GitHub preview. This is not an authenticated Array release envelope. KI publisher signing and the canonical Array/Store integration remain separate.'

tracked = subprocess.check_output(['git', 'ls-files', '-z']).decode('utf-8').split('\0')
tracked = sorted(name for name in tracked if name and name != 'docs/SOURCE_SHA256.json')
assert 'native/target/release/ki-meta.exe' in tracked, 'The explicit source asset must include its qualified native engine'
assert not any(name.startswith(('node_modules/', 'release/', '.tmp/', '.git/')) for name in tracked)
payload = {name: (ROOT / name).read_bytes() for name in tracked}
payload['integration/array/release-artifacts.json'] = encoded(candidate)
payload[f'docs/evidence/github-windows-{version}.json'] = encoded({
    'commit': commit, 'run_url': run_url, 'install': install, 'desktop': desktop,
    'runtime_integrity': {key: value for key, value in runtime.items() if key != 'resources'},
})
manifest = {name: hashlib.sha256(data).hexdigest() for name, data in sorted(payload.items())}
payload['docs/SOURCE_SHA256.json'] = encoded(manifest)
source_zip = destination / f'KI-Metadata-Workbench-{version}-Source.zip'
with zipfile.ZipFile(source_zip, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for name, data in sorted(payload.items()):
        info = zipfile.ZipInfo('KI-Metadata-Workbench/' + name, (2026, 10, 19, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, data)
with zipfile.ZipFile(source_zip) as archive:
    assert archive.testzip() is None, 'Source archive integrity failure'
    assert len(archive.namelist()) == len(payload)
    for name, expected in manifest.items():
        assert hashlib.sha256(archive.read('KI-Metadata-Workbench/' + name)).hexdigest() == expected, name
provenance = {
    'schema': 'industries.kuykendall.metadata.github-build', 'schema_version': 1,
    'version': version, 'repository': os.environ['GITHUB_REPOSITORY'], 'commit': commit,
    'run_url': run_url, 'release_url': release_url, 'runner_os': os.environ['RUNNER_OS'],
    'unsigned': True, 'native_core_sha256': runtime['native_core_sha256'],
    'native_imports': imports, 'native_vc_redistributable_required': False,
    'installed_executable': runtime['installed_executable'],
    'artifacts': [*artifacts, {'kind': 'source', **entry(source_zip)}],
    'source_files': len(payload), 'source_manifest_entries': len(manifest),
    'runtime_resource_files_verified': runtime['verified_resource_files'],
    'asar_source_files_verified': runtime['verified_app_files'], 'preview_bridge_excluded': True,
    'windows_install_acceptance': install, 'packaged_desktop_acceptance': desktop,
    'array_note': candidate['note'],
}
(destination / 'BUILD_PROVENANCE-windows-x64.json').write_bytes(encoded(provenance))
sums = ''.join(f'{sha256(file)}  {file.name}\n' for file in sorted(destination.iterdir()))
(destination / 'SHA256SUMS-windows-x64.txt').write_text(sums, encoding='utf-8', newline='\n')
print(f'Packaged {len(payload)} source files and {len(artifacts)} Windows downloads; all source and runtime integrity checks passed.')
print(sums, end='')
