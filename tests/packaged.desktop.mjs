// Windows acceptance against the installed application and its bundled engines.
import {_electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';

assert.equal(process.platform, 'win32', 'This acceptance test requires actual Windows.');
assert.ok(process.env.KI_PACKAGED_EXE, 'Set KI_PACKAGED_EXE to the installed application.');
const executablePath = await fs.realpath(process.env.KI_PACKAGED_EXE);
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ki-installed-'));
const checks = [];
let app;
const pass = name => {checks.push(name); console.log('PASS ' + name);};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function chunk(type, data) {
  const label = Buffer.from(type), result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); label.copy(result, 4); data.copy(result, 8);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([label, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return result;
}
function fixture() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('tEXt', Buffer.from('parameters\0Synthetic employee privacy test, Steps: 20, Seed: 42')),
    chunk('IDAT', deflateSync(Buffer.alloc(14))), chunk('IEND', Buffer.alloc(0)),
  ]);
}
async function launch(args) {
  // Do not allow the development tool paths to make a broken package appear healthy.
  const env = {...process.env};
  for (const key of ['KI_CORE', 'KI_EXIFTOOL', 'KI_FFMPEG', 'KI_FFPROBE', 'KI_READ_ONLY', 'ELECTRON_RUN_AS_NODE']) delete env[key];
  app = await _electron.launch({executablePath, args, env, timeout: 60000});
  const win = await app.firstWindow();
  win.setDefaultTimeout(20000);
  await win.waitForFunction(() => document.querySelectorAll('.file-row').length === 1 && document.getElementById('stop-jobs').hidden);
  return win;
}
try {
  const source = path.join(root, 'Synthetic employee image.png'), output = path.join(root, 'Shared copy.png');
  const original = fixture(); await fs.writeFile(source, original);
  const win = await launch([source]);
  const identity = await app.evaluate(({app}) => ({packaged: app.isPackaged, version: app.getVersion(), name: app.getName()}));
  assert.deepEqual(identity, {packaged: true, version: pkg.version, name: pkg.productName});
  assert.equal(await win.evaluate(() => !!window.KI_PREVIEW), false);
  pass('The installed branded application launches as a real packaged desktop application');
  const doctor = await win.evaluate(() => window.ki.doctor());
  assert.equal(doctor.version, pkg.version);
  for (const tool of ['exiftool', 'ffmpeg', 'ffprobe']) assert.equal(doctor[tool].available, true, JSON.stringify(doctor[tool]));
  pass('The installed Rust engine and all three bundled metadata tools execute');
  const before = await win.evaluate(file => window.ki.inspect(file), source);
  assert.equal(before.properties.evidence.sha256, sha256(original));
  assert.match(JSON.stringify(before.raw), /Synthetic employee privacy test/);
  pass('Launching with a file imports it and reads its actual metadata and SHA-256');
  await app.evaluate(({dialog}, destination) => {
    dialog.showSaveDialog = async () => ({canceled: false, filePath: destination});
  }, output);
  const saved = await win.evaluate(async file => {
    const current = await window.ki.inspect(file);
    return window.ki.save({path: file, expected_etag: current.etag,
      patch: {fields: {}, raw: [], policy: 'strip_metadata', artwork: {action: 'keep'}},
      replace_original: false, allow_unverified: false, accept_remux: false});
  }, source);
  assert.equal(saved.verification.status, 'matched');
  const after = await win.evaluate(file => window.ki.inspect(file), saved.output);
  assert.equal(after.properties.image_privacy.removable_blocks, 0);
  assert.doesNotMatch(JSON.stringify(after.raw), /Synthetic employee privacy test/);
  assert.deepEqual(await fs.readFile(source), original);
  assert.notEqual(sha256(await fs.readFile(output)), sha256(original));
  pass('The packaged privacy workflow writes and verifies a cleaned copy while preserving the original');
  const denied = await win.evaluate(async file => {
    try {await window.ki.inspect(file); return false;} catch (error) {return /Choose this file/.test(error.message);}
  }, path.join(root, 'unselected.png'));
  assert.equal(denied, true);
  pass('The installed renderer cannot inspect an unselected file');
  await app.close(); app = null;
  const locked = await launch(['--inspect-only', source]);
  assert.deepEqual(await locked.evaluate(() => window.ki.sessionState()), {read_only: true, locked: true});
  assert.equal(await locked.locator('#session-mode').isDisabled(), true);
  pass('The packaged inspection profile locks the interface before importing files');
  const blocked = await locked.evaluate(async file => {
    const current = await window.ki.inspect(file), results = [];
    for (const action of [
      () => window.ki.setReadOnly(false),
      () => window.ki.save({path: file, expected_etag: current.etag,
        patch: {fields: {title: 'Blocked'}, raw: [], policy: 'keep', artwork: {action: 'keep'}},
        replace_original: false, allow_unverified: false, accept_remux: false}),
      () => window.ki.restore('unapproved-journal'),
    ]) {
      try {await action(); results.push(false);} catch (error) {results.push(/inspection locked|Inspect-only/.test(error.message));}
    }
    return results;
  }, source);
  assert.deepEqual(blocked, [true, true, true]);
  assert.deepEqual(await fs.readFile(source), original);
  pass('Installed IPC rejects unlock, save and restore operations in the locked profile');
  await fs.mkdir('release/ci-evidence', {recursive: true});
  await fs.writeFile('release/ci-evidence/packaged-desktop.json', JSON.stringify({
    version: pkg.version, platform: process.platform, arch: process.arch,
    installed_executable_sha256: sha256(await fs.readFile(executablePath)),
    commit: process.env.GITHUB_SHA || null, checks, passed: checks.length,
    actual_packaged_electron: true, picker_responses_automated: true,
  }, null, 2) + '\n');
  console.log(`${checks.length} installed Windows desktop acceptance checks passed.`);
} finally {
  if (app) await app.close();
  await fs.rm(root, {recursive: true, force: true});
}
