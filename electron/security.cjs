'use strict';
const path = require('node:path');
const SUPPORTED = new Set([".mp3", ".flac", ".wav", ".wave", ".aif", ".aiff", ".aifc", ".m4a", ".m4b", ".ogg", ".oga", ".opus", ".jpg", ".jpeg", ".png", ".apng", ".webp", ".tif", ".tiff", ".heic", ".heif", ".hif", ".avif", ".jxl", ".dng", ".nef", ".nrw", ".arw", ".cr2", ".cr3", ".orf", ".rw2", ".pef", ".srw", ".raf", ".rwl", ".mos", ".mrw", ".iiq", ".3fr", ".mef", ".erf", ".kdc", ".dcr", ".sr2", ".srf", ".x3f", ".jp2", ".jpx", ".psd", ".psb", ".gif", ".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".wmv", ".asf", ".docx", ".docm", ".dotx", ".dotm", ".xlsx", ".xlsm", ".xltx", ".xltm", ".pptx", ".pptm", ".potx", ".potm", ".ppsx", ".ppsm", ".odt", ".ods", ".odp", ".odg", ".odf", ".ott", ".ots", ".otp", ".otg", ".pdf"]);
const IMAGE = new Set(['.jpg','.jpeg','.png']);
const PRIVACY_IMAGE = new Set([...IMAGE,'.apng','.webp']);
const POLICIES = new Set(['keep','privacy','clear_descriptive','strip_metadata']);
function supported(file) { return typeof file === 'string' && file.length > 0 && !file.includes('\0'); }
function safeName(value, fallback = 'metadata.json') {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 160) || fallback;
}
function validatePreset(value) {
  if (!value || typeof value !== 'object' || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw Error('A preset needs a name of 1–100 characters.');
  const fields = {};
  if (!value.fields || typeof value.fields !== 'object' || Array.isArray(value.fields)) throw Error('Invalid preset fields.');
  for (const [key, val] of Object.entries(value.fields)) {
    if (!/^[a-z][a-z_]{0,50}$/.test(key) || ['constructor','prototype','__proto__'].includes(key)) throw Error('Invalid preset field.');
    if (typeof val !== 'string' || val.length > 1048576 || val.includes('\0')) throw Error('Invalid preset value.');
    fields[key] = val;
  }
  if (Object.keys(fields).length > 80) throw Error('Too many preset fields.');
  if (!POLICIES.has(value.policy)) throw Error('Invalid preset policy.');
  if (value.policy === 'strip_metadata' && Object.keys(fields).length) throw Error('Strip image metadata presets cannot add fields.');
  const id = typeof value.id === 'string' && /^[a-z0-9-]{1,100}$/.test(value.id) && !value.id.startsWith('builtin-') ? value.id : require('node:crypto').randomUUID();
  return { id, name: value.name.trim(), fields, policy: value.policy };
}
function validateSave(req) {
  if (!req || typeof req !== 'object' || typeof req.path !== 'string' || typeof req.expected_etag !== 'string' || !/^[a-f0-9]{64}$/.test(req.expected_etag)) throw Error('Invalid save request. Reload the file.');
  if (!req.patch || typeof req.patch !== 'object' || !POLICIES.has(req.patch.policy)) throw Error('Invalid metadata patch.');
  if (!req.patch.fields || typeof req.patch.fields !== 'object' || Array.isArray(req.patch.fields) || !Array.isArray(req.patch.raw) || !req.patch.artwork || typeof req.patch.artwork !== 'object' || !['keep','remove','replace'].includes(req.patch.artwork.action)) throw Error('Invalid metadata patch fields.');
  if (req.patch.policy === 'strip_metadata') {
    if (!PRIVACY_IMAGE.has(path.extname(req.path).toLowerCase())) throw Error('Strip image metadata supports JPEG, PNG and WebP images only.');
    if (Object.keys(req.patch.fields).length || req.patch.raw.length || req.patch.artwork.action !== 'keep') throw Error('Strip image metadata cannot include field, raw tag or artwork edits.');
  }
  if (JSON.stringify(req.patch).length > 12 * 1024 * 1024) throw Error('Patch exceeds the size limit.');
  for (const key of ['replace_original','allow_unverified','accept_remux']) if (typeof req[key] !== 'boolean') throw Error('Invalid save option.');
  if (req.replace_original && req.allow_unverified) throw Error('Unverified writes are copy-only.');
  if (req.batch_token !== undefined && (typeof req.batch_token !== 'string' || !/^[a-f0-9-]{36}$/.test(req.batch_token))) throw Error('Invalid export folder token.');
  if (req.batch_token && req.replace_original) throw Error('Batch exports create copies only.');
  return {
    ...(req.batch_token ? {batch_token:req.batch_token} : {}),
    path: req.path, expected_etag: req.expected_etag, patch: req.patch,
    replace_original: req.replace_original, allow_unverified: req.allow_unverified, accept_remux: req.accept_remux
  };
}
function validatePresetPack(value) {
  if (!value || value.application !== 'KI Metadata Workbench' || value.schema_version !== 1 || !Array.isArray(value.presets) || !value.presets.length || value.presets.length > 100) throw Error('Choose a KI preset pack with 1–100 presets.');
  return value.presets.map(item => validatePreset({...item,id:undefined}));
}
module.exports = { validatePresetPack, SUPPORTED, IMAGE, PRIVACY_IMAGE, supported, safeName, validatePreset, validateSave };
