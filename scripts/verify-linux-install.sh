#!/usr/bin/env bash
# Qualify the actual .deb installation and AppImage launcher, plus both payloads.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
version=$(node -p "require('./package.json').version")
deb="$root/release/KI-Metadata-Workbench-$version-Linux-x64.deb"
appimage="$root/release/KI-Metadata-Workbench-$version-Linux-x64.AppImage"
evidence="$root/release/ci-evidence"
mkdir -p "$evidence"
[[ $(id -u) != 0 ]] || { echo 'Run acceptance as a normal desktop user with sudo for installation.' >&2; exit 1; }
[[ -f "$deb" && -f "$appimage" ]] || { echo 'Build both Linux packages first.' >&2; exit 1; }
package_name=$(dpkg-deb --field "$deb" Package)
[[ $(dpkg-deb --field "$deb" Version) == "$version" ]]
[[ $(dpkg-deb --field "$deb" Architecture) == amd64 ]]
if [[ $(dpkg-query --show --showformat='${Status}' "$package_name" 2>/dev/null || true) == 'install ok installed' ]]; then
  echo 'Refusing to replace an existing installation during acceptance.' >&2
  exit 1
fi
test_root=$(mktemp -d "${RUNNER_TEMP:-/tmp}/ki-linux-acceptance.XXXXXX")
installed=false
cleanup() {
  if [[ "$installed" == true ]]; then sudo apt-get remove --yes "$package_name"; fi
  rm -rf -- "$test_root"
}
trap cleanup EXIT
sudo apt-get install --yes "$deb"
installed=true
executable=$(python3 - "$package_name" <<'PY'
from pathlib import Path
import subprocess, sys
paths = subprocess.check_output(['dpkg-query', '--listfiles', sys.argv[1]], text=True).splitlines()
matches = [Path(path) for path in paths if path.endswith('/ki-metadata-workbench')
           and Path(path).is_file() and (Path(path).parent / 'resources/app.asar').is_file()]
assert len(matches) == 1, f'Expected exactly one installed desktop executable, got {matches}'
print(matches[0])
PY
)
export KI_PACKAGED_EXE="$executable"
export KI_PACKAGED_RUNTIME="$(dirname "$executable")"
export KI_PACKAGED_EVIDENCE="$evidence/linux-packaged-desktop.json"
export XDG_CONFIG_HOME="$test_root/config"
export XDG_CACHE_HOME="$test_root/cache"
[[ -f "$KI_PACKAGED_RUNTIME/resources/apparmor-profile" ]] || { echo 'The .deb AppArmor profile is missing.' >&2; exit 1; }
export KI_ACCEPTANCE_APPARMOR='not-enabled'
if command -v apparmor_status >/dev/null 2>&1 && sudo apparmor_status --enabled >/dev/null 2>&1; then
  sudo cmp "$KI_PACKAGED_RUNTIME/resources/apparmor-profile" '/etc/apparmor.d/ki-metadata-workbench'
  export KI_ACCEPTANCE_APPARMOR='installed'
fi
node scripts/verify-runtime.cjs > "$evidence/linux-installed-runtime.json"
perl -MIO::Compress::Brotli -MIO::Uncompress::Brotli -e 'print "System Perl Brotli modules are available\n"'
xvfb-run --auto-servernum node tests/packaged.desktop.mjs
# --appimage-extract needs no FUSE installation. Verify every shipped source and
# resource byte inside the second independently generated distribution format.
mkdir "$test_root/appimage"
chmod +x "$appimage"
(cd "$test_root/appimage" && "$appimage" --appimage-extract > "$evidence/linux-appimage-extract.log")
KI_PACKAGED_RUNTIME="$test_root/appimage/squashfs-root" node scripts/verify-runtime.cjs > "$evidence/linux-appimage-runtime.json"
# Launch the downloadable AppImage itself, with its normal AppRun wrapper. The
# wrapper's default --no-sandbox is recorded separately from .deb qualification.
APPIMAGE_EXTRACT_AND_RUN=1 \
KI_PACKAGED_EXE="$appimage" \
KI_PACKAGED_EVIDENCE="$evidence/linux-appimage-desktop.json" \
XDG_CONFIG_HOME="$test_root/appimage-config" \
XDG_CACHE_HOME="$test_root/appimage-cache" \
xvfb-run --auto-servernum node tests/packaged.desktop.mjs
sudo apt-get remove --yes "$package_name"
installed=false
[[ ! -e "$executable" ]] || { echo 'Uninstall left the application executable behind.' >&2; exit 1; }
python3 - "$package_name" "$executable" "$appimage" "$test_root/appimage/squashfs-root" <<'PY'
from pathlib import Path
import hashlib, json, os, subprocess, sys
root = Path.cwd()
version = json.loads((root / 'package.json').read_text())['version']
evidence = root / 'release/ci-evidence'
desktop = json.loads((evidence / 'linux-packaged-desktop.json').read_text())
appimage_desktop = json.loads((evidence / 'linux-appimage-desktop.json').read_text())
installed = json.loads((evidence / 'linux-installed-runtime.json').read_text())
appimage = json.loads((evidence / 'linux-appimage-runtime.json').read_text())
for record in [desktop, appimage_desktop]:
    assert record['actual_packaged_electron'] and record['platform'] == 'linux' and record['arch'] == 'x64'
    assert record['version'] == version and record['passed'] >= 7 and len(record['checks']) == record['passed']
assert installed['installed_executable']['sha256'] == appimage['installed_executable']['sha256'] == desktop['installed_executable_sha256']
assert installed['native_core_sha256'] == appimage['native_core_sha256']
with Path(sys.argv[3]).open('rb') as stream:
    appimage_sha256 = hashlib.file_digest(stream, 'sha256').hexdigest()
assert appimage_sha256 == appimage_desktop['installed_executable_sha256']
entries = list(Path(sys.argv[4]).glob('*.desktop'))
assert len(entries) == 1, 'Expected one AppImage desktop entry'
exec_lines = [line for line in entries[0].read_text().splitlines() if line.startswith('Exec=')]
assert exec_lines == ['Exec=AppRun --no-sandbox %U'], exec_lines
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
assert commit == os.environ['GITHUB_SHA'] == desktop['commit'] == appimage_desktop['commit']
result = {
    'version': version, 'platform': 'linux', 'arch': 'x64', 'commit': commit,
    'runner_os': os.environ.get('RUNNER_OS', 'Linux'), 'package_name': sys.argv[1],
    'installed_executable': sys.argv[2], 'installed_desktop_checks': 'passed',
    'appimage_payload_verified': True, 'application_removed': True,
    'system_perl_and_brotli_verified': True, 'unsigned': True,
    'apparmor_profile': os.environ['KI_ACCEPTANCE_APPARMOR'], 'desktop_sandbox_disabled': False,
    'appimage_desktop_checks': 'passed', 'appimage_executable_sha256': appimage_sha256,
    'appimage_launch_mode': 'APPIMAGE_EXTRACT_AND_RUN=1',
    'appimage_default_launch_arguments': ['--no-sandbox'], 'appimage_sandbox_disabled': True,
}
(evidence / 'linux-install-acceptance.json').write_text(json.dumps(result, indent=2) + '\n')
print('Linux .deb install, both packaged desktop workflows, AppImage contents and uninstall passed.')
PY
