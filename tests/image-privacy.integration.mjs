// Real native-engine tests. Fixtures are decoded by FFmpeg and container bytes are
// checked independently; no mock engine or re-encoded replacement can pass these checks.
// Run: node tests/image-privacy.integration.mjs
// Optional: KI_CORE=/path/to/ki-meta KI_FFMPEG=/path/to/ffmpeg KI_KEEP_IMAGE_TESTS=1
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ki-image-privacy-'));
const core = process.env.KI_CORE || path.resolve('native/target/release/ki-meta' + (process.platform === 'win32' ? '.exe' : ''));
const ffmpeg = process.env.KI_FFMPEG || 'ffmpeg';
const env = {...process.env, KI_DATA_DIR: path.join(dir, 'appdata')};
const results = [];
const secret = 'KI-PRIVATE-EMPLOYEE-MARKER';
const parameters = `${secret}: a staff portrait\nNegative prompt: private office\nSteps: 25, Sampler: DPM++ 2M, CFG scale: 7, Seed: 123456789, Model: private-model.safetensors`;
const workflow = JSON.stringify({last_node_id: 4, nodes: [{id: 4, type: 'CLIPTextEncode', widgets_values: [secret]}], prompt: {'4': {class_type: 'CLIPTextEncode', inputs: {text: secret}}}});
const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:iptc="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"><dc:description>${secret}</dc:description><iptc:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia</iptc:DigitalSourceType></rdf:Description></rdf:RDF></x:xmpmeta>`;
const xmpHeader = Buffer.from('http://ns.adobe.com/xap/1.0/\0');
const exifHeader = Buffer.from('Exif\0\0');
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');

// Small, real progressive JPEG, created once with Pillow from a 32 x 24 RGB
// gradient. Keeping this fixture inline avoids a Pillow/ImageMagick dependency.
const progressiveFixture = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAQDAwQDAwQEAwQFBAQFBgoHBgYGBg0JCggKDw0QEA8NDw4RExgUERIXEg4PFRwVFxkZGxsbEBQdHx0aHxgaGxr/2wBDAQQFBQYFBgwHBwwaEQ8RGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhr/wgARCAAYACADASIAAhEBAxEB/8QAGQAAAwADAAAAAAAAAAAAAAAAAAUGAgMH/8QAFgEBAQEAAAAAAAAAAAAAAAAABgQF/9oADAMBAAIQAxAAAAHldM5pdSGUeOqIwrnMQ2zepKFa3//EAB0QAAICAgMBAAAAAAAAAAAAAAMEAAIBBQYREhT/2gAIAQEAAQUCAnAJz5u7ATgE4JXzgKncot4piyy8NukBUpyCmL7PkL2Q/wD/xAAfEQAABgEFAAAAAAAAAAAAAAAAAQIDBAUxERIhQVH/2gAIAQMBAT8BZmBmaTaeTwKOrZlES3DMWkGNGrl7EZ0L3sf/xAAhEQABAwMEAwAAAAAAAAAAAAABAgQRAAMhBRIUMUKh8f/aAAgBAgEBPwFg4CBuUcVafKeOVXj5H5XCQvSlLk5j33WisGtk7giYE5z0K//EACUQAAEDAwALAAAAAAAAAAAAAAIAAREDITEEEBITI0FRgZHR8P/aAAgBAQAGPwLCwo6LCwpfU5O1haU7Vq9MCHIuV/CHYIqru+BD2uFohEPJyOENIN1Sl5JxG8d/rL//xAAdEAEAAgIDAQEAAAAAAAAAAAABABEhMUFhsVGB/9oACAEBAAE/IdEaIxwY9TRGiDoMERWmWE3KFXUWKmya4vtALLhwh90ig4GDfwH2XGua9HFWxcf/2gAMAwEAAgADAAAAEOivPf/EABsRAQEBAQADAQAAAAAAAAAAAAERIQBRcaHB/9oACAEDAQE/EFYD1rAG/vX+8YIGl8X7y4VoW4QOKmijk313/8QAGxEBAAIDAQEAAAAAAAAAAAAAARExACFRcYH/2gAIAQIBAT8Q0UAleBblqEh5Q+EGKOSCwlIhU7FLpwKVMNhKJIsXyM//xAAdEAEBAAMAAwEBAAAAAAAAAAABEQAhMWFx8ZHB/9oACAEBAAE/EPkZ8jJrQzh7fz8z5GfIxDKNdZvPSrOrh9QgbQVnnWabkYTyLURAFaQbgQ5HbpUmUON8SwkRnFItLN061vXD1HclaU0hoDYsUz//2Q==', 'base64');
// Actual sRGB ICC profile. Its copyright text is replaced below with private text.
const icc = Buffer.from('AAACTGxjbXMEQAAAbW50clJHQiBYWVogB+oACgASABMACgAOYWNzcEFQUEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1sY21zAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALZGVzYwAAAQgAAAA2Y3BydAAAAUAAAABMd3RwdAAAAYwAAAAUY2hhZAAAAaAAAAAsclhZWgAAAcwAAAAUYlhZWgAAAeAAAAAUZ1hZWgAAAfQAAAAUclRSQwAAAggAAAAgZ1RSQwAAAggAAAAgYlRSQwAAAggAAAAgY2hybQAAAigAAAAkbWx1YwAAAAAAAAABAAAADGVuVVMAAAAaAAAAHABzAFIARwBCACAAYgB1AGkAbAB0AC0AaQBuAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAADAAAAAcAE4AbwAgAGMAbwBwAHkAcgBpAGcAaAB0ACwAIAB1AHMAZQAgAGYAcgBlAGUAbAB5WFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDEIAAAXe///zJQAAB5MAAP2Q///7of///aIAAAPcAADAblhZWiAAAAAAAABvoAAAOPUAAAOQWFlaIAAAAAAAACSfAAAPhAAAtsNYWVogAAAAAAAAYpcAALeHAAAY2XBhcmEAAAAAAAMAAAACZmYAAPKnAAANWQAAE9AAAApbY2hybQAAAAAAAwAAAACj1wAAVHsAAEzNAACZmgAAJmYAAA9c', 'base64');
const iccPrivateText = Buffer.from('KI PRIVATE ICC EMPLOYEE!'.padEnd(24, ' '), 'utf16le').swap16();
iccPrivateText.copy(icc, 0x140 + 28);

function run(command, args) {
  const result = spawnSync(command, args, {encoding: 'utf8', timeout: 120000, windowsHide: true, env, maxBuffer: 16 * 1024 * 1024});
  if (result.error || result.status !== 0) throw Error(`${command}: ${result.error?.message || ''}${result.stderr || result.stdout || `exit ${result.status}`}`);
  return result.stdout;
}
function ff(args) { return run(ffmpeg, ['-v', 'error', '-nostdin', '-y', ...args]); }
function decodedHash(file, inputFormat) {
  // Strict stripping intentionally removes EXIF orientation; compare stored pixels.
  return ff(['-noautorotate', ...(inputFormat ? ['-f', inputFormat] : []), '-i', file, '-map', '0:v:0', '-fps_mode', 'passthrough', '-threads', '1', '-pix_fmt', 'rgba', '-f', 'hash', '-hash', 'sha256', '-']).trim();
}
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function rpc(method, params) {
  const request = path.join(dir, 'request.json');
  fs.writeFileSync(request, JSON.stringify({id: 1, method, params}));
  return JSON.parse(run(core, ['request', request]));
}
const inspect = file => rpc('inspect', {path: file});
const strictPatch = () => ({fields: {}, raw: [], policy: 'strip_metadata', artwork: {action: 'keep'}});
function save(file, output, patch = strictPatch(), extra = {}) {
  return rpc('save', {path: file, expected_etag: inspect(file).etag, patch, output, replace_original: false, allow_unverified: false, accept_remux: false, ...extra});
}
function file(name, bytes) { const dest = path.join(dir, name); fs.writeFileSync(dest, bytes); return dest; }
function check(name, fn) {
  try { fn(); results.push({name, passed: true}); console.log('PASS ' + name); }
  catch (error) { console.error('FAIL ' + name); throw error; }
}
function cleanInspection(doc) {
  const privacy = doc.properties.image_privacy;
  assert.ok(privacy, 'native inspection must expose an image privacy inventory');
  assert.equal(privacy.removable_blocks, 0, 'no removable blocks may remain');
  assert.equal(privacy.trailing_bytes, 0, 'no data may remain beyond the container end');
  assert.equal(privacy.color_profiles, 0, 'ICC profiles can carry private text');
  assert.equal(privacy.exif_orientation, null, 'strict stripping must remove orientation EXIF too');
  assert.deepEqual(doc.fields, {}, 'a strict export must not reintroduce descriptive XMP fields');
  assert.ok(!JSON.stringify(doc.raw).includes(secret));
}
function strip(filePath, name) {
  const original = fs.readFileSync(filePath);
  const before = inspect(filePath);
  assert.ok(before.capabilities.policies.includes('strip_metadata'));
  const result = save(filePath, path.join(dir, name));
  assert.equal(result.verification.status, 'matched');
  assert.equal(result.verification.before, result.verification.after);
  assert.equal(result.backup, null, 'Save Copy should leave the source in place');
  cleanInspection(result.after);
  cleanInspection(inspect(result.output));
  assert.deepEqual(fs.readFileSync(filePath), original, 'source file must be byte-for-byte unchanged');
  return result;
}

function be32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }
function le32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
function le24(n) { const b = Buffer.alloc(3); b.writeUIntLE(n, 0, 3); return b; }
function box(type, data) { return Buffer.concat([be32(data.length + 8), Buffer.from(type), data]); }
const c2pa = box('jumb', box('json', Buffer.from(JSON.stringify({'c2pa.claim': {generator: secret, assertions: ['c2pa.actions']}}))));

// Build a genuine TIFF with orientation, EXIF MakerNote/UserComment, and GPS IFDs.
function privateExif() {
  const b = Buffer.alloc(4096);
  Buffer.from('49492a0008000000', 'hex').copy(b);
  const root = 8, exif = root + 2 + 6 * 12 + 4, gps = exif + 2 + 2 * 12 + 4;
  let tail = gps + 2 + 4 * 12 + 4;
  const ascii = text => Buffer.from(text + '\0');
  const short = n => { const v = Buffer.alloc(2); v.writeUInt16LE(n); return v; };
  const rationals = numbers => Buffer.concat(numbers.map(n => Buffer.concat([le32(n), le32(1)])));
  function ifd(offset, entries) {
    b.writeUInt16LE(entries.length, offset);
    for (const [index, [tag, type, count, data]] of entries.entries()) {
      const at = offset + 2 + index * 12;
      b.writeUInt16LE(tag, at); b.writeUInt16LE(type, at + 2); b.writeUInt32LE(count, at + 4);
      if (data.length <= 4) data.copy(b, at + 8);
      else { b.writeUInt32LE(tail, at + 8); data.copy(b, tail); tail += data.length; if (tail & 1) tail++; }
    }
  }
  const description = ascii(secret), software = ascii('Stable Diffusion ' + secret), comment = Buffer.concat([Buffer.from('ASCII\0\0\0'), Buffer.from(parameters)]);
  ifd(root, [[0x010e, 2, description.length, description], [0x0112, 3, 1, short(6)], [0x0131, 2, software.length, software], [0x013b, 2, description.length, description], [0x8769, 4, 1, le32(exif)], [0x8825, 4, 1, le32(gps)]]);
  ifd(exif, [[0x927c, 7, description.length, description], [0x9286, 7, comment.length, comment]]);
  ifd(gps, [[1, 2, 2, ascii('N')], [2, 5, 3, rationals([43, 36, 0])], [3, 2, 2, ascii('W')], [4, 5, 3, rationals([116, 12, 0])]]);
  return b.subarray(0, tail);
}

function jpegSegment(marker, data) {
  assert.ok(data.length <= 65533);
  const header = Buffer.from([0xff, marker, 0, 0]); header.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([header, data]);
}
function parseJpeg(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8);
  const parts = [{marker: 0xd8, start: 0, end: 2, data: bytes.subarray(0, 2), payload: Buffer.alloc(0)}];
  let at = 2, scans = 0;
  while (at < bytes.length) {
    const start = at;
    assert.equal(bytes[at++], 0xff, `expected JPEG marker at ${start}`);
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at++];
    assert.notEqual(marker, undefined, 'truncated JPEG marker');
    if (marker === 0xd9) {
      parts.push({marker, start, end: at, data: bytes.subarray(start, at), payload: Buffer.alloc(0)});
      return {parts, scans, end: at, trailer: bytes.subarray(at)};
    }
    assert.ok(marker !== 0 && marker !== 0xd8);
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push({marker, start, end: at, data: bytes.subarray(start, at), payload: Buffer.alloc(0)});
      continue;
    }
    assert.ok(at + 2 <= bytes.length, 'truncated JPEG length');
    const length = bytes.readUInt16BE(at);
    assert.ok(length >= 2 && at + length <= bytes.length, 'invalid JPEG segment length');
    const payload = bytes.subarray(at + 2, at + length); at += length;
    parts.push({marker, start, end: at, data: bytes.subarray(start, at), payload});
    if (marker !== 0xda) continue;
    scans++;
    const scanStart = at;
    for (;;) {
      assert.ok(at < bytes.length, 'unterminated JPEG scan');
      if (bytes[at] !== 0xff) { at++; continue; }
      let next = at + 1;
      while (bytes[next] === 0xff) next++;
      assert.ok(next < bytes.length, 'truncated JPEG entropy marker');
      const code = bytes[next];
      if (code === 0 || (code >= 0xd0 && code <= 0xd7)) { at = next + 1; continue; }
      break;
    }
    parts.push({marker: null, start: scanStart, end: at, data: bytes.subarray(scanStart, at), payload: bytes.subarray(scanStart, at)});
  }
  throw Error('JPEG fixture has no EOI');
}
function jpegCodingHash(bytes) {
  return sha(Buffer.concat(parseJpeg(bytes).parts.filter(p => p.marker === null || !(p.marker === 0xfe || (p.marker >= 0xe0 && p.marker <= 0xef))).map(p => p.data)));
}
function assertJpegClean(bytes) {
  const parsed = parseJpeg(bytes);
  assert.equal(parsed.trailer.length, 0);
  for (const p of parsed.parts) {
    assert.notEqual(p.marker, 0xfe, 'JPEG comments must be removed');
    if (p.marker >= 0xe0 && p.marker <= 0xef) {
      if (p.marker === 0xe0 && p.payload.subarray(0, 5).equals(Buffer.from('JFIF\0'))) {
        assert.equal(p.payload.length, 14, 'JFIF thumbnail and extra bytes must be removed');
        assert.equal(p.payload[12], 0); assert.equal(p.payload[13], 0);
      } else {
        assert.equal(p.marker, 0xee, 'only structural JFIF/Adobe APP blocks may survive');
        assert.ok(p.payload.subarray(0, 5).equals(Buffer.from('Adobe')));
        assert.equal(p.payload.length, 12);
      }
    }
  }
  assert.ok(!bytes.includes(Buffer.from(secret)));
  assert.ok(!bytes.includes(iccPrivateText));
}
function jpegPrivate(base, {malformed = false, late = false} = {}) {
  const jfif = Buffer.from('4a46494600010200000100010101ff00ff', 'hex'); // 1 x 1 RGB thumbnail
  const app11 = Buffer.concat([Buffer.from('4a50000100000001', 'hex'), c2pa]);
  const metadata = Buffer.concat([
    jpegSegment(0xe0, jfif),
    jpegSegment(0xe1, Buffer.concat([exifHeader, malformed ? Buffer.from('bad-exif-' + secret) : privateExif()])),
    jpegSegment(0xe1, Buffer.concat([xmpHeader, malformed ? Buffer.from([0xff, 0xfe, 0x80]) : Buffer.from(xmp)])),
    jpegSegment(0xe1, Buffer.concat([Buffer.from('http://ns.adobe.com/xmp/extension/\0'), Buffer.from(secret)])),
    jpegSegment(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0\x01\x01'), icc])),
    jpegSegment(0xed, Buffer.from('Photoshop 3.0\0' + secret)),
    jpegSegment(0xeb, app11),
    jpegSegment(0xe7, Buffer.from(secret)),
    jpegSegment(0xfe, Buffer.from(parameters)),
  ]);
  // Remove preexisting APP0 to keep a single genuine JFIF header in the fixture.
  const original = parseJpeg(base);
  const withoutJfif = Buffer.concat(original.parts.filter(p => p.marker !== 0xe0).map(p => p.data));
  let decorated = Buffer.concat([withoutJfif.subarray(0, 2), metadata, withoutJfif.subarray(2)]);
  if (late) {
    const firstScan = parseJpeg(decorated).parts.find(p => p.marker === null);
    const extra = Buffer.concat([jpegSegment(0xe1, Buffer.concat([xmpHeader, Buffer.from(xmp)])), jpegSegment(0xeb, app11), jpegSegment(0xfe, Buffer.from(secret + '-after-first-scan'))]);
    decorated = Buffer.concat([decorated.subarray(0, firstScan.end), extra, decorated.subarray(firstScan.end)]);
  }
  return Buffer.concat([decorated, Buffer.from(secret + '-after-EOI')]);
}

const crcTable = Array.from({length: 256}, (_, n) => {
  let c = n; for (let bit = 0; bit < 8; bit++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  return Buffer.concat([be32(data.length), body, be32(crc32(body))]);
}
function parsePng(bytes) {
  assert.ok(bytes.subarray(0, 8).equals(pngSignature));
  const chunks = []; let at = 8;
  while (at < bytes.length) {
    assert.ok(at + 12 <= bytes.length, 'truncated PNG chunk');
    const length = bytes.readUInt32BE(at), end = at + 12 + length;
    assert.ok(end <= bytes.length, 'PNG chunk exceeds file');
    const type = bytes.toString('ascii', at + 4, at + 8), data = bytes.subarray(at + 8, end - 4);
    assert.equal(bytes.readUInt32BE(end - 4), crc32(bytes.subarray(at + 4, end - 4)), 'PNG CRC mismatch');
    chunks.push({type, data, start: at, end, bytes: bytes.subarray(at, end)}); at = end;
    if (type === 'IEND') return {chunks, end, trailer: bytes.subarray(end)};
  }
  throw Error('PNG fixture has no IEND');
}
const pngRendering = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'cICP', 'mDCV', 'cLLI', 'sBIT', 'bKGD', 'pHYs', 'acTL', 'fcTL', 'fdAT']);
function pngCodingHash(bytes) { return sha(Buffer.concat(parsePng(bytes).chunks.filter(c => pngRendering.has(c.type)).map(c => c.bytes))); }
function assertPngClean(bytes) {
  const parsed = parsePng(bytes);
  assert.equal(parsed.trailer.length, 0);
  for (const c of parsed.chunks) assert.ok(pngRendering.has(c.type), `unexpected PNG metadata/private chunk: ${c.type}`);
  assert.ok(!bytes.includes(Buffer.from(secret)));
}
function pngPrivate(base, malformed = false) {
  const parsed = parsePng(base);
  const metadata = Buffer.concat([
    pngChunk('eXIf', malformed ? Buffer.from('bad-exif-' + secret) : privateExif()),
    pngChunk('tEXt', Buffer.from('parameters\0' + parameters)),
    pngChunk('tEXt', Buffer.from('Software\0Stable Diffusion ' + secret)),
    pngChunk('zTXt', malformed ? Buffer.from('parameters\0\x07broken') : Buffer.concat([Buffer.from('parameters\0\0'), deflateSync(Buffer.from(parameters))])),
    pngChunk('iTXt', malformed ? Buffer.from('unterminated-key') : Buffer.concat([Buffer.from('workflow\0\x01\0\0\0'), deflateSync(Buffer.from(workflow))])),
    pngChunk('iTXt', Buffer.concat([Buffer.from('XML:com.adobe.xmp\0\0\0\0\0'), Buffer.from(xmp)])),
    pngChunk('caBX', c2pa),
    pngChunk('iCCP', Buffer.concat([Buffer.from('Private ICC\0\0'), deflateSync(icc)])),
    pngChunk('tIME', Buffer.from([0x07, 0xea, 10, 18, 12, 34, 56])),
    pngChunk('meTa', Buffer.from(secret)),
  ]);
  const animationControl = parsed.chunks.find(c => c.type === 'acTL');
  const metadataAt = (animationControl || parsed.chunks.find(c => c.type === 'IDAT')).start;
  const iend = parsed.chunks.find(c => c.type === 'IEND').start;
  // Ordinary PNG covers text before and after IDAT. Put APNG metadata before
  // animation controls because FFmpeg does not support text between frame chunks.
  const lateText = animationControl ? Buffer.alloc(0) : pngChunk('zTXt', Buffer.concat([Buffer.from('prompt\0\0'), deflateSync(Buffer.from(secret + '-after-IDAT'))]));
  return Buffer.concat([base.subarray(0, metadataAt), metadata, base.subarray(metadataAt, iend), lateText, base.subarray(iend, parsed.end), Buffer.from(secret + '-after-IEND')]);
}

function riffChunk(type, data, padding = 0) {
  return Buffer.concat([Buffer.from(type), le32(data.length), data, data.length & 1 ? Buffer.from([padding]) : Buffer.alloc(0)]);
}
function webp(chunks, trailer = Buffer.alloc(0)) {
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  return Buffer.concat([Buffer.from('RIFF'), le32(body.length), body, trailer]);
}
function parseRiffChunks(bytes, start, end) {
  const chunks = []; let at = start;
  while (at < end) {
    assert.ok(at + 8 <= end, 'truncated RIFF chunk');
    const type = bytes.toString('ascii', at, at + 4), length = bytes.readUInt32LE(at + 4), dataEnd = at + 8 + length;
    const chunkEnd = dataEnd + (length & 1);
    assert.ok(chunkEnd <= end, 'RIFF chunk exceeds declared bounds');
    chunks.push({type, data: bytes.subarray(at + 8, dataEnd), padding: length & 1 ? bytes[dataEnd] : null, bytes: bytes.subarray(at, chunkEnd)});
    at = chunkEnd;
  }
  assert.equal(at, end);
  return chunks;
}
function parseWebp(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  const end = bytes.readUInt32LE(4) + 8;
  assert.ok(end <= bytes.length, 'RIFF size exceeds actual file');
  return {chunks: parseRiffChunks(bytes, 12, end), end, trailer: bytes.subarray(end)};
}
function vp8x(width, height, flags) { return Buffer.concat([Buffer.from([flags, 0, 0, 0]), le24(width - 1), le24(height - 1)]); }
function webpCoding(bytes) {
  return parseWebp(bytes).chunks.flatMap(c => {
    if (['VP8 ', 'VP8L', 'ALPH', 'ANIM'].includes(c.type)) return [{type: c.type, hash: sha(c.data)}];
    if (c.type === 'VP8X') return [{type: c.type, data: [c.data[0] & ~0x2c, ...c.data.subarray(1)]}];
    if (c.type === 'ANMF') return [{type: c.type, header: [...c.data.subarray(0, 16)], chunks: parseRiffChunks(c.data, 16, c.data.length).filter(s => ['VP8 ', 'VP8L', 'ALPH'].includes(s.type)).map(s => ({type: s.type, hash: sha(s.data)}))}];
    return [];
  });
}
function assertWebpClean(bytes) {
  const parsed = parseWebp(bytes);
  assert.equal(parsed.trailer.length, 0);
  for (const c of parsed.chunks) {
    assert.ok(['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ANIM', 'ANMF'].includes(c.type), `unexpected WebP metadata/private chunk: ${c.type}`);
    if (c.padding !== null) assert.equal(c.padding, 0, 'retained chunk padding must be cleared');
    if (c.type === 'VP8X') assert.equal(c.data[0] & 0x2c, 0, 'ICCP/EXIF/XMP flags must be cleared');
    if (c.type === 'ANMF') {
      for (const nested of parseRiffChunks(c.data, 16, c.data.length)) {
        assert.ok(['VP8 ', 'VP8L', 'ALPH'].includes(nested.type), 'private metadata inside an ANMF frame must be removed');
        if (nested.padding !== null) assert.equal(nested.padding, 0, 'frame padding must be cleared');
      }
    }
  }
  assert.ok(!bytes.includes(Buffer.from(secret)));
  assert.ok(!bytes.includes(iccPrivateText));
}
function webpPrivate(base, width, height, malformed = false) {
  const coding = parseWebp(base).chunks.filter(c => ['VP8 ', 'VP8L', 'ALPH'].includes(c.type));
  const alpha = coding.some(c => c.type === 'ALPH') || coding.some(c => c.type === 'VP8L' && (c.data[4] & 0x10));
  return webp([
    riffChunk('VP8X', vp8x(width, height, 0x2c | (alpha ? 0x10 : 0))),
    riffChunk('ICCP', icc),
    ...coding.map(c => riffChunk(c.type, c.data, 0xad)),
    riffChunk('EXIF', malformed ? Buffer.from('bad-exif-' + secret) : privateExif()),
    riffChunk('XMP ', Buffer.from(xmp)),
    riffChunk('C2PA', c2pa),
    riffChunk('PRIV', Buffer.from(secret + '!'), 0xeb),
  ], Buffer.from(secret + '-after-RIFF'));
}
function animatedWebpPrivate(bases, width, height) {
  const frames = bases.map((base, index) => {
    const coding = parseWebp(base).chunks.filter(c => ['VP8 ', 'VP8L', 'ALPH'].includes(c.type));
    const header = Buffer.concat([le24(0), le24(0), le24(width - 1), le24(height - 1), le24(125 + index * 125), Buffer.from([2])]);
    return riffChunk('ANMF', Buffer.concat([header, ...coding.map(c => riffChunk(c.type, c.data, 0xda)), riffChunk('EXIF', privateExif()), riffChunk('C2PA', c2pa), riffChunk('PRIV', Buffer.from(secret + '!'), 0xea)]));
  });
  return webp([riffChunk('VP8X', vp8x(width, height, 0x2e)), riffChunk('ICCP', icc), riffChunk('ANIM', Buffer.from([0, 0, 0, 0, 3, 0])), ...frames, riffChunk('XMP ', Buffer.from(xmp))], Buffer.from(secret + '-animated-trailer'));
}
function decodedWebpFrameHashes(bytes, prefix) {
  return parseWebp(bytes).chunks.filter(c => c.type === 'ANMF').map((frame, index) => {
    const chunks = parseRiffChunks(frame.data, 16, frame.data.length).filter(c => ['VP8 ', 'VP8L', 'ALPH'].includes(c.type));
    const width = frame.data.readUIntLE(6, 3) + 1, height = frame.data.readUIntLE(9, 3) + 1;
    const alpha = chunks.some(c => c.type === 'ALPH') || chunks.some(c => c.type === 'VP8L' && (c.data[4] & 0x10));
    const standalone = webp([riffChunk('VP8X', vp8x(width, height, alpha ? 0x10 : 0)), ...chunks.map(c => riffChunk(c.type, c.data))]);
    return decodedHash(file(`${prefix}-frame-${index}.webp`, standalone));
  });
}

try {
  if (!fs.existsSync(core)) throw Error('Rust engine absent. Build the native core first. Native image privacy integration has NOT run.');
  const source = {};
  for (const ext of ['jpg', 'png', 'webp']) {
    source[ext] = path.join(dir, 'source.' + ext);
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=40x24:rate=1', '-frames:v', '1', '-threads', '1', ...(ext === 'webp' ? ['-c:v', 'libwebp', '-lossless', '1'] : []), source[ext]]);
  }
  const originalPixels = Object.fromEntries(Object.entries(source).map(([ext, f]) => [ext, decodedHash(f)]));
  const originals = Object.fromEntries(Object.entries(source).map(([ext, f]) => [ext, fs.readFileSync(f)]));
  const dirtyJpeg = file('private.jpg', jpegPrivate(originals.jpg));
  const dirtyPng = file('private.png', pngPrivate(originals.png));
  const dirtyWebp = file('private.webp', webpPrivate(originals.webp, 40, 24));

  check('JPEG inspection detects EXIF orientation, removable metadata, ICC and trailing bytes', () => {
    const doc = inspect(dirtyJpeg), p = doc.properties.image_privacy;
    assert.ok(p.removable_blocks >= 8);
    assert.equal(p.exif_orientation, 6);
    assert.ok(p.color_profiles >= 1);
    assert.equal(p.trailing_bytes, Buffer.byteLength(secret + '-after-EOI'));
    assert.ok(p.categories && Object.keys(p.categories).length > 0);
  });
  check('PNG inspection detects compressed AI workflow/text, EXIF, ICC and trailing bytes', () => {
    const doc = inspect(dirtyPng), p = doc.properties.image_privacy;
    assert.ok(p.removable_blocks >= 10);
    assert.equal(p.exif_orientation, 6);
    assert.ok(p.color_profiles >= 1);
    assert.equal(p.trailing_bytes, Buffer.byteLength(secret + '-after-IEND'));
    assert.ok(JSON.stringify(doc.raw).includes(secret), 'fixture metadata must actually be readable before stripping');
  });
  check('WebP inspection detects EXIF, XMP, C2PA, ICC, unknown chunks and trailing bytes', () => {
    const p = inspect(dirtyWebp).properties.image_privacy;
    assert.ok(p.removable_blocks >= 5);
    assert.equal(p.exif_orientation, 6);
    assert.ok(p.color_profiles >= 1);
    assert.equal(p.trailing_bytes, Buffer.byteLength(secret + '-after-RIFF'));
  });

  const cleaned = {};
  for (const [ext, dirty, codingHash, assertClean] of [
    ['jpg', dirtyJpeg, jpegCodingHash, assertJpegClean],
    ['png', dirtyPng, pngCodingHash, assertPngClean],
    ['webp', dirtyWebp, webpCoding, assertWebpClean],
  ]) {
    check(`Native ${ext} strip removes all injected privacy blocks without changing encoded or decoded pixels`, () => {
      assert.equal(decodedHash(dirty), originalPixels[ext], 'metadata fixture must preserve original stored pixels');
      const result = strip(dirty, 'clean.' + ext);
      cleaned[ext] = result.output;
      const bytes = fs.readFileSync(result.output);
      assertClean(bytes);
      assert.deepEqual(codingHash(bytes), codingHash(fs.readFileSync(dirty)), 'compressed image/coding data must remain identical');
      assert.equal(decodedHash(result.output), originalPixels[ext], 'actual decoded raster must remain identical');
    });
    check(`Native ${ext} strict export is idempotent and does not reintroduce metadata`, () => {
      const result = strip(cleaned[ext], 'clean-again.' + ext);
      assert.deepEqual(fs.readFileSync(result.output), fs.readFileSync(cleaned[ext]));
      assertClean(fs.readFileSync(result.output));
    });
  }

  check('Progressive JPEG metadata between scans is removed; every scan and decoded pixel survives', () => {
    const clean = file('progressive-source.jpg', progressiveFixture);
    const dirty = file('progressive-private.jpg', jpegPrivate(progressiveFixture, {late: true}));
    const before = parseJpeg(fs.readFileSync(dirty));
    assert.ok(before.scans > 1, 'fixture must be a real multiscan JPEG');
    const firstScanEnd = before.parts.find(p => p.marker === null).end;
    assert.ok(before.parts.some(p => p.marker === 0xeb && p.start >= firstScanEnd), 'fixture must contain APP11 after the first scan');
    const result = strip(dirty, 'progressive-clean.jpg'), bytes = fs.readFileSync(result.output);
    assertJpegClean(bytes);
    assert.equal(parseJpeg(bytes).scans, before.scans);
    assert.equal(jpegCodingHash(bytes), jpegCodingHash(progressiveFixture));
    assert.equal(decodedHash(result.output), decodedHash(clean));
  });

  for (const [ext, bytes, assertClean] of [
    ['jpg', jpegPrivate(originals.jpg, {malformed: true}), assertJpegClean],
    ['png', pngPrivate(originals.png, true), assertPngClean],
    ['webp', webpPrivate(originals.webp, 40, 24, true), assertWebpClean],
  ]) {
    check(`Malformed ${ext} EXIF/text payloads are removable without requiring their successful interpretation`, () => {
      const dirty = file('malformed-metadata.' + ext, bytes);
      const result = strip(dirty, 'malformed-metadata-clean.' + ext);
      assertClean(fs.readFileSync(result.output));
      assert.equal(decodedHash(result.output), originalPixels[ext]);
    });
  }

  check('A bad CRC in removable PNG text does not prevent a verified privacy export', () => {
    const bytes = Buffer.from(pngPrivate(originals.png));
    const text = parsePng(bytes).chunks.find(c => c.type === 'tEXt');
    bytes[text.end - 1] ^= 1;
    const dirty = file('bad-metadata-crc.png', bytes);
    const result = strip(dirty, 'bad-metadata-crc-clean.png');
    assertPngClean(fs.readFileSync(result.output));
    assert.equal(decodedHash(result.output), originalPixels.png);
  });

  check('Deeply nested valid XMP is bounded during inspection and removable without parsing it', () => {
    const deepXml = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description>${'<v>'.repeat(96)}${secret}${'</v>'.repeat(96)}</rdf:Description></rdf:RDF></x:xmpmeta>`;
    const bytes = Buffer.concat([originals.jpg.subarray(0, 2), jpegSegment(0xe1, Buffer.concat([xmpHeader, Buffer.from(deepXml)])), originals.jpg.subarray(2)]);
    const dirty = file('deep-xmp.jpg', bytes);
    assert.ok(inspect(dirty).warnings.some(w => /nest|depth|limit/i.test(w)), 'depth guard must report the bounded inspection');
    const result = strip(dirty, 'deep-xmp-clean.jpg');
    assertJpegClean(fs.readFileSync(result.output));
    assert.equal(decodedHash(result.output), originalPixels.jpg);
  });

  check('Persisted strict-export journals do not retain the removed private metadata', () => {
    const result = strip(dirtyPng, 'journal-check.png');
    assert.ok(JSON.stringify(result.before.raw).includes(secret), 'source fixture must contain readable private metadata');
    assert.ok(result.journal, 'successful native save should produce its local audit record');
    const serialized = fs.readFileSync(result.journal, 'utf8'), journal = JSON.parse(serialized);
    assert.ok(!serialized.includes(secret));
    assert.ok(!serialized.includes('private-model.safetensors'));
    assert.deepEqual(journal.before.fields, {});
    assert.deepEqual(journal.before.raw, []);
    assert.deepEqual(journal.before.warnings, []);
  });

  check('Animated PNG retains frame controls, timing, encoded frames and actual decoded pixels', () => {
    const animation = path.join(dir, 'animation-source.png');
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=40x24:rate=2:duration=1', '-threads', '1', '-plays', '3', '-f', 'apng', animation]);
    const original = fs.readFileSync(animation), chunks = parsePng(original).chunks;
    assert.ok(chunks.some(c => c.type === 'acTL'));
    assert.equal(chunks.filter(c => c.type === 'fcTL').length, 2);
    const dirty = file('animation-private.png', pngPrivate(original));
    // Large metadata can make FFmpeg's bounded auto-probe mistake APNG for PNG.
    // Force the APNG demuxer so both frames are actually decoded for comparison.
    assert.equal(decodedHash(dirty, 'apng'), decodedHash(animation, 'apng'));
    const result = strip(dirty, 'animation-clean.png'), bytes = fs.readFileSync(result.output);
    assertPngClean(bytes);
    assert.equal(pngCodingHash(bytes), pngCodingHash(original));
    assert.equal(decodedHash(result.output, 'apng'), decodedHash(animation, 'apng'));
  });

  check('PNG palette, transparency and rendering chunks survive strict stripping', () => {
    const palette = path.join(dir, 'palette-source.png');
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=40x24:rate=1', '-frames:v', '1', '-pix_fmt', 'pal8', '-threads', '1', palette]);
    const chunks = parsePng(fs.readFileSync(palette)).chunks;
    assert.ok(chunks.some(c => c.type === 'PLTE'));
    let insertedTransparency = false;
    const withTransparency = Buffer.concat([pngSignature, ...chunks.filter(c => c.type !== 'tRNS').flatMap(c => {
      if (c.type !== 'IDAT' || insertedTransparency) return [c.bytes];
      insertedTransparency = true;
      return [pngChunk('tRNS', Buffer.from([0, 64, 128, 255])), c.bytes];
    })]);
    const transparent = file('palette-transparent.png', withTransparency);
    const dirty = file('palette-private.png', pngPrivate(withTransparency));
    const result = strip(dirty, 'palette-clean.png'), bytes = fs.readFileSync(result.output);
    assertPngClean(bytes);
    assert.equal(pngCodingHash(bytes), pngCodingHash(withTransparency));
    assert.equal(decodedHash(result.output), decodedHash(transparent));
  });

  check('WebP retained odd-byte chunk padding is cleared while lossless coding bytes remain intact', () => {
    let odd;
    for (let width = 32; width <= 60 && !odd; width += 2) {
      const candidate = path.join(dir, `lossless-${width}.webp`);
      ff(['-f', 'lavfi', '-i', `testsrc2=size=${width}x24:rate=1`, '-frames:v', '1', '-threads', '1', '-c:v', 'libwebp', '-lossless', '1', candidate]);
      const bytes = fs.readFileSync(candidate);
      if (parseWebp(bytes).chunks.some(c => c.type === 'VP8L' && (c.data.length & 1))) odd = {candidate, bytes, width};
    }
    assert.ok(odd, 'FFmpeg must produce a real odd-length coding chunk for the padding test');
    const dirty = file('odd-padding-private.webp', webpPrivate(odd.bytes, odd.width, 24));
    assert.ok(parseWebp(fs.readFileSync(dirty)).chunks.some(c => c.type === 'VP8L' && c.padding === 0xad));
    const result = strip(dirty, 'odd-padding-clean.webp'), bytes = fs.readFileSync(result.output);
    assertWebpClean(bytes);
    assert.deepEqual(webpCoding(bytes), webpCoding(fs.readFileSync(dirty)));
    assert.equal(decodedHash(result.output), decodedHash(odd.candidate));
  });

  let lossyBytes;
  check('Lossy WebP preserves its exact VP8 coding data and actual decoded pixels', () => {
    const lossy = path.join(dir, 'lossy-source.webp');
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=40x24:rate=1', '-frames:v', '1', '-threads', '1', '-c:v', 'libwebp', '-lossless', '0', '-q:v', '77', lossy]);
    const original = fs.readFileSync(lossy); lossyBytes = original;
    assert.ok(parseWebp(original).chunks.some(c => c.type === 'VP8 '));
    const dirty = file('lossy-private.webp', webpPrivate(original, 40, 24));
    const result = strip(dirty, 'lossy-clean.webp'), bytes = fs.readFileSync(result.output);
    assertWebpClean(bytes);
    assert.deepEqual(webpCoding(bytes), webpCoding(fs.readFileSync(dirty)));
    assert.equal(decodedHash(result.output), decodedHash(lossy));
  });

  check('Real transparent WebP keeps its ALPH data, alpha feature flag and decoded RGBA pixels', () => {
    const alpha = path.join(dir, 'alpha-source.webp');
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=40x24:rate=1,format=rgba,colorchannelmixer=aa=0.5', '-frames:v', '1', '-threads', '1', '-c:v', 'libwebp', '-lossless', '0', '-q:v', '77', alpha]);
    const original = fs.readFileSync(alpha), chunks = parseWebp(original).chunks;
    assert.ok(chunks.some(c => c.type === 'ALPH'));
    assert.equal(chunks.find(c => c.type === 'VP8X').data[0] & 0x10, 0x10);
    const dirty = file('alpha-private.webp', webpPrivate(original, 40, 24));
    const result = strip(dirty, 'alpha-clean.webp'), bytes = fs.readFileSync(result.output);
    assertWebpClean(bytes);
    assert.deepEqual(webpCoding(bytes), webpCoding(fs.readFileSync(dirty)));
    assert.equal(parseWebp(bytes).chunks.find(c => c.type === 'VP8X').data[0] & 0x10, 0x10);
    assert.equal(decodedHash(result.output), decodedHash(alpha));
  });

  check('Animated WebP strips metadata inside ANMF frames and preserves frame pixels, timing and loop count', () => {
    const second = path.join(dir, 'second-frame.webp');
    ff(['-f', 'lavfi', '-i', 'color=c=blue:size=40x24:rate=1', '-frames:v', '1', '-threads', '1', '-c:v', 'libwebp', '-lossless', '1', second]);
    const dirtyBytes = animatedWebpPrivate([originals.webp, fs.readFileSync(second)], 40, 24);
    const dirty = file('animation-private.webp', dirtyBytes);
    const result = strip(dirty, 'animation-clean.webp'), bytes = fs.readFileSync(result.output);
    assertWebpClean(bytes);
    assert.deepEqual(webpCoding(bytes), webpCoding(dirtyBytes));
    assert.deepEqual(decodedWebpFrameHashes(bytes, 'after'), decodedWebpFrameHashes(dirtyBytes, 'before'));
    assert.equal(parseWebp(bytes).chunks.find(c => c.type === 'VP8X').data[0] & 2, 2);
  });

  for (const [name, change] of [
    ['descriptive fields', p => { p.fields = {title: secret}; }],
    ['raw fields', p => { p.raw = [{namespace: 'XMP/KI', key: 'employee', value: secret}]; }],
    ['artwork changes', p => { p.artwork = {action: 'remove'}; }],
  ]) {
    check(`Strict policy rejects ${name} so an export cannot silently reintroduce metadata`, () => {
      const patch = strictPatch(); change(patch);
      const out = path.join(dir, 'rejected-' + name.replaceAll(' ', '-') + '.jpg'), before = fs.readFileSync(dirtyJpeg);
      assert.throws(() => save(dirtyJpeg, out, patch));
      assert.ok(!fs.existsSync(out));
      assert.deepEqual(fs.readFileSync(dirtyJpeg), before);
    });
  }
  check('Strict image policy rejects audio instead of silently using a weaker audio policy', () => {
    const audio = path.join(dir, 'source.wav'), out = path.join(dir, 'rejected-audio.wav');
    ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', '-c:a', 'pcm_s16le', audio]);
    const before = fs.readFileSync(audio);
    assert.throws(() => save(audio, out));
    assert.ok(!fs.existsSync(out));
    assert.deepEqual(fs.readFileSync(audio), before);
  });
  check('Strict export refuses a stale source fingerprint and leaves both source and output untouched', () => {
    const out = path.join(dir, 'stale.jpg'), before = fs.readFileSync(dirtyJpeg);
    assert.throws(() => save(dirtyJpeg, out, strictPatch(), {expected_etag: '0'.repeat(64)}), /changed|reload|etag/i);
    assert.ok(!fs.existsSync(out));
    assert.deepEqual(fs.readFileSync(dirtyJpeg), before);
  });
  check('Strict Save Copy never overwrites an existing destination', () => {
    const out = file('existing.jpg', Buffer.from('existing destination content'));
    assert.throws(() => save(dirtyJpeg, out));
    assert.equal(fs.readFileSync(out, 'utf8'), 'existing destination content');
  });

  const unknownCritical = Buffer.concat([originals.png.subarray(0, 33), pngChunk('PRIV', Buffer.from(secret)), originals.png.subarray(33)]);
  const badPngCrc = Buffer.from(originals.png); badPngCrc[29] ^= 1;
  const oversizedRiff = Buffer.from(originals.webp); oversizedRiff.writeUInt32LE(oversizedRiff.readUInt32LE(4) + 8, 4);
  const forgedAlpha = webp([
    riffChunk('VP8X', vp8x(40, 24, 0x10)),
    riffChunk('ALPH', Buffer.concat([Buffer.from([0]), Buffer.alloc(40 * 24, 128), Buffer.from(secret)])),
    ...parseWebp(lossyBytes).chunks.filter(c => c.type === 'VP8 ').map(c => riffChunk(c.type, c.data)),
  ]);
  for (const [name, ext, bytes] of [
    ['unknown critical PNG chunk', 'png', unknownCritical],
    ['corrupted PNG header CRC', 'png', badPngCrc],
    ['truncated PNG IEND', 'png', originals.png.subarray(0, originals.png.length - 5)],
    ['truncated JPEG without EOI', 'jpg', originals.jpg.subarray(0, originals.jpg.length - 2)],
    ['WebP RIFF size beyond file', 'webp', oversizedRiff],
    ['raw WebP ALPH with forged extra bytes', 'webp', forgedAlpha],
  ]) {
    check(`Malformed container is rejected without any file change: ${name}`, () => {
      const stem = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
      const bad = file(stem + '.' + ext, bytes), out = path.join(dir, stem + '-out.' + ext);
      assert.throws(() => inspect(bad), 'unsafe container must not be reported as a supported cleanable image');
      assert.throws(() => rpc('save', {path: bad, expected_etag: '0'.repeat(64), patch: strictPatch(), output: out, replace_original: false, allow_unverified: false, accept_remux: false}));
      assert.ok(!fs.existsSync(out));
      assert.deepEqual(fs.readFileSync(bad), bytes);
    });
  }

  check('Explicit image replacement creates an exact recoverable original backup', () => {
    const replace = file('replace-original.png', pngPrivate(originals.png)), original = fs.readFileSync(replace);
    const result = save(replace, null, strictPatch(), {replace_original: true});
    cleanInspection(result.after);
    assertPngClean(fs.readFileSync(replace));
    assert.ok(result.backup && result.journal);
    assert.deepEqual(fs.readFileSync(result.backup), original);
    rpc('restore', {journal: result.journal});
    assert.deepEqual(fs.readFileSync(replace), original);
  });

  console.log(JSON.stringify({mode: 'real-native-image-privacy', checks: results.length, results}, null, 2));
} finally {
  if (process.env.KI_KEEP_IMAGE_TESTS === '1') console.log('Retained generated test fixtures: ' + dir);
  else fs.rmSync(dir, {recursive: true, force: true});
}
