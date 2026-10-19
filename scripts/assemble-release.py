"""Publish only a complete Linux/Windows candidate from the same source commit."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def sha256(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def assemble(root, commit):
    version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
    prefix = f'KI-Metadata-Workbench-{version}'
    required = {
        'windows': {f'{prefix}-Windows-x64-Portable.exe', f'{prefix}-Windows-x64-Setup.exe', f'{prefix}-Source.zip'},
        'linux': {f'{prefix}-Linux-x64.AppImage', f'{prefix}-Linux-x64.deb'},
    }
    verified = []
    platforms = {}
    for platform, expected in required.items():
        directory = root / 'release/qualified' / platform
        provenance_name = f'BUILD_PROVENANCE-{platform}-x64.json'
        provenance_file = directory / provenance_name
        provenance = json.loads(provenance_file.read_text(encoding='utf-8'))
        assert provenance['version'] == version, f'{platform}: mismatched version'
        assert provenance['commit'] == commit, f'{platform}: mismatched source commit'
        artifacts = provenance['artifacts']
        names = [item['filename'] for item in artifacts]
        assert len(names) == len(set(names)), f'{platform}: duplicate artifact names'
        assert set(names) == expected, f'{platform}: incomplete or unexpected candidate artifacts: {names}'
        for artifact in artifacts:
            name = artifact['filename']
            assert Path(name).name == name
            file = directory / name
            assert not file.is_symlink() and file.is_file(), f'Missing package: {name}'
            assert file.stat().st_size == artifact['bytes'], f'Size mismatch: {name}'
            assert sha256(file) == artifact['sha256'], f'Checksum mismatch: {name}'
            verified.append((file, artifact))
        platforms[platform] = {
            'provenance': provenance_name, 'sha256': sha256(provenance_file),
            'run_url': provenance['run_url'],
        }
        verified.append((provenance_file, {'filename': provenance_name, 'bytes': provenance_file.stat().st_size,
                                            'sha256': sha256(provenance_file), 'kind': 'platform-evidence'}))

    destination = root / 'release/publish'
    destination.mkdir(parents=True, exist_ok=True)
    assert not list(destination.iterdir()), 'Refusing to mix release candidates'
    for file, _ in verified:
        shutil.copy2(file, destination / file.name)
    manifest = {
        'schema': 'industries.kuykendall.metadata.github-release', 'schema_version': 1,
        'version': version, 'commit': commit, 'repository': os.environ.get('GITHUB_REPOSITORY'),
        'prerelease': True, 'unsigned': True, 'platforms': platforms,
        'artifacts': [artifact for _, artifact in verified],
    }
    (destination / 'BUILD_PROVENANCE.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    sums = ''.join(f'{sha256(file)}  {file.name}\n' for file in sorted(destination.iterdir()))
    (destination / 'SHA256SUMS.txt').write_text(sums, encoding='utf-8', newline='\n')
    print(f'Verified and assembled Linux and Windows {version} from {commit}.')
    print(sums, end='')


if __name__ == '__main__':
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    assert commit == os.environ['GITHUB_SHA'], 'Publishing checkout differs from the qualified workflow commit'
    assemble(ROOT, commit)
