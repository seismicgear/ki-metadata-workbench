'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {SUPPORTED,supported,safeName,validatePreset,validatePresetPack,validateSave}=require('../electron/security.cjs');
const req=()=>({path:'C:\\Music\\x.mp3',expected_etag:'a'.repeat(64),patch:{fields:{},raw:[],policy:'keep',artwork:{action:'keep'}},replace_original:false,allow_unverified:false,accept_remux:false});
test('any regular-file path may be inspected; write candidates remain explicit',()=>{for(const file of ['x.MP3','x.WEBP','x.pdf','x.exe','x.mp3.exe','unknown'])assert.ok(supported(file));assert.ok(!supported(''));assert.ok(!supported('x\0.jpg'));assert.ok(SUPPORTED.has('.pdf'));assert.ok(SUPPORTED.has('.docx'));assert.ok(!SUPPORTED.has('.exe'));});
test('safe export name does not accept traversal',()=>{assert.equal(safeName('../../x.json'),'.._.._x.json');assert.ok(!safeName('c:\\foo\\x.json').includes('\\'));});
test('preset rejects prototype pollution keys',()=>assert.throws(()=>validatePreset({name:'bad',policy:'keep',fields:JSON.parse('{"__proto__":"x"}')})));
test('preset protects built-in identifier',()=>{const p=validatePreset({id:'builtin-ki-release',name:'copy',policy:'keep',fields:{artist:'Monty'}});assert.notEqual(p.id,'builtin-ki-release');});
test('preset values are bounded strings',()=>assert.throws(()=>validatePreset({name:'x',policy:'keep',fields:{artist:42}})));
test('save discards renderer-provided output path',()=>{const r=req();r.output='C:\\danger.exe';assert.ok(!Object.hasOwn(validateSave(r),'output'));});
test('replacement never allows unverified mode',()=>{const r=req();r.replace_original=true;r.allow_unverified=true;assert.throws(()=>validateSave(r));});
test('source fingerprint is mandatory',()=>{const r=req();r.expected_etag='';assert.throws(()=>validateSave(r));});
test('cleanup policy is constrained',()=>{const r=req();r.patch.policy='delete_media';assert.throws(()=>validateSave(r));});
test('strip save policy accepts only JPEG PNG and WebP image paths',()=>{
  for(const ext of ['jpg','JPEG','png','WEBP']){const r=req();r.path='C:\\Images\\private.'+ext;r.patch.policy='strip_metadata';assert.equal(validateSave(r).patch.policy,'strip_metadata');}
  for(const ext of ['mp3','wav','mp4','webm','gif','tiff']){const r=req();r.path='file.'+ext;r.patch.policy='strip_metadata';assert.throws(()=>validateSave(r),/images only/);}
});
test('strip save rejects every staged metadata addition or artwork operation',()=>{
  for(const mutate of [p=>p.fields={artist:'Employee'},p=>p.fields={artist:null},p=>p.raw=[{namespace:'XMP',key:'Creator',value:'Employee'}],p=>p.artwork={action:'remove'},p=>p.artwork={action:'replace',path:'private.png'}]){const r=req();r.path='private.png';r.patch.policy='strip_metadata';mutate(r.patch);assert.throws(()=>validateSave(r),/cannot include/);}
});
test('strip save rejects malformed empty-looking patch containers',()=>{
  for(const mutate of [p=>p.fields=[],p=>p.fields=null,p=>p.raw={},p=>p.artwork=null]){const r=req();r.path='private.webp';r.patch.policy='strip_metadata';mutate(r.patch);assert.throws(()=>validateSave(r),/Invalid metadata patch/);}
});
test('image privacy preset is supported but cannot reintroduce fields',()=>{
  assert.equal(validatePreset({name:'Private sharing',policy:'strip_metadata',fields:{}}).policy,'strip_metadata');assert.throws(()=>validatePreset({name:'Invalid',policy:'strip_metadata',fields:{artist:'Employee'}}),/cannot add fields/);
});
test('bridge handles missing native binary explicitly',async()=>{const {CoreBridge}=require('../electron/core-bridge.cjs');await assert.rejects(new CoreBridge(path.join(__dirname,'missing-engine'),{}).call('doctor'),/has not been built/);});
test('renderer source does not inject metadata as HTML',()=>{const code=fs.readFileSync(path.join(__dirname,'../src/renderer/app.ts'),'utf8');assert.ok(!code.includes('.innerHTML'));assert.ok(!code.includes('eval('));});
test('Electron security configuration is present (static assertion)',()=>{const code=fs.readFileSync(path.join(__dirname,'../electron/main.cjs'),'utf8');for(const token of ['nodeIntegration:false','contextIsolation:true','sandbox:true','webSecurity:true','validateSender','setPermissionRequestHandler','onBeforeRequest','setWindowOpenHandler'])assert.ok(code.includes(token));});
test('no renderer-facing generic IPC primitive (static assertion)',()=>{const code=fs.readFileSync(path.join(__dirname,'../electron/preload.cjs'),'utf8');assert.ok(!code.includes('send:'));assert.ok(!code.includes('invoke:'));assert.ok(code.includes('getPathForFile'));});

test('export folders use bounded tokens and never accept renderer paths',()=>{const r=req();r.batch_token='01234567-0123-0123-0123-0123456789ab';r.output='elsewhere';assert.equal(validateSave(r).batch_token,r.batch_token);assert.ok(!validateSave(r).output);r.batch_token='../../folder';assert.throws(()=>validateSave(r));});
test('batch exports cannot replace originals',()=>{const r=req();r.batch_token='01234567-0123-0123-0123-0123456789ab';r.replace_original=true;assert.throws(()=>validateSave(r),/copies only/);});
test('preset pack validates every item before import and reissues identities',()=>{const pack={application:'KI Metadata Workbench',schema_version:1,presets:[{id:'builtin-ki-release',name:'Team',policy:'keep',fields:{company:'KI'}}]};const [p]=validatePresetPack(pack);assert.notEqual(p.id,'builtin-ki-release');pack.presets.push({name:'bad',policy:'keep',fields:{company:42}});assert.throws(()=>validatePresetPack(pack));});
test('preset import rejects foreign schemas and oversized collections',()=>{for(const p of [{}, {application:'KI Metadata Workbench',schema_version:2,presets:[]},{application:'KI Metadata Workbench',schema_version:1,presets:Array(101).fill({})}])assert.throws(()=>validatePresetPack(p));});
