'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
assert(['win32', 'linux'].includes(process.platform), 'Supported release platforms are Windows and Linux');
const windows = process.platform === 'win32';
const suffix = windows ? '.exe' : '';
const runtime = path.resolve(process.env.KI_PACKAGED_RUNTIME || path.join(root, windows ? 'release/win-unpacked' : 'release/linux-unpacked'));
const archive = path.join(runtime, 'resources/app.asar');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function files(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(dir, entry.name);
    assert(!entry.isSymbolicLink(), 'Unexpected symlink in runtime inputs: ' + file);
    return entry.isDirectory() ? files(file) : [file];
  });
}
const payload = [];
function verify(source, target) {
  const sourceBytes = fs.readFileSync(source), targetBytes = fs.readFileSync(target);
  assert.equal(digest(targetBytes), digest(sourceBytes), 'Packaged bytes differ: ' + target);
  payload.push({path: path.relative(runtime, target).replaceAll('\\', '/'), bytes: targetBytes.length, sha256: digest(targetBytes)});
}
verify(path.join(root, 'native/target/release/ki-meta' + suffix), path.join(runtime, 'resources/bin/ki-meta' + suffix));
for (const [sourceDir, targetDir] of [[windows ? 'vendor/win32-x64' : 'vendor/linux-x64', 'resources/bin'], ['vendor/licenses', 'resources/licenses']]) {
  for (const file of files(path.join(root, sourceDir))) verify(file, path.join(runtime, targetDir, path.relative(path.join(root, sourceDir), file)));
}
const archived = asar.listPackage(archive).map(file => file.replaceAll('\\', '/'));
assert(!archived.some(file => /preview-bridge/.test(file)), 'Browser preview bridge leaked into the desktop package');
const archivedPkg = JSON.parse(asar.extractFile(archive, 'package.json'));
assert.equal(archivedPkg.version, pkg.version); assert.equal(archivedPkg.productName, pkg.productName);
let appFiles = 0;
for (const dir of ['dist', 'electron', 'assets']) {
  for (const file of files(path.join(root, dir))) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    if (/^dist\/renderer\/preview-bridge\.js(?:\.map)?$/.test(relative)) continue;
    // ASAR's directory traversal uses the host separator, including on Windows.
    assert.equal(digest(asar.extractFile(archive, path.normalize(relative))), digest(fs.readFileSync(file)), 'ASAR bytes differ: ' + relative);
    appFiles++;
  }
}
const executable = path.join(runtime, windows ? 'KI Metadata Workbench.exe' : 'ki-metadata-workbench');
process.stdout.write(JSON.stringify({
  version: pkg.version, platform: process.platform, arch: process.arch,
  verified_resource_files: payload.length, verified_app_files: appFiles,
  preview_bridge_excluded: true, resources: payload,
  native_core_sha256: digest(fs.readFileSync(path.join(runtime, 'resources/bin/ki-meta' + suffix))),
  installed_executable: {filename: path.basename(executable), bytes: fs.statSync(executable).size, sha256: digest(fs.readFileSync(executable))},
}) + '\n');
