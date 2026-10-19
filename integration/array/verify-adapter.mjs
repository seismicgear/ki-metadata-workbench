import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Pass the apps/desktop/core directory of a scratch Array checkout after applying register-adapter.patch.
// This checks the actual Array adapter with mocked OS boundaries. It does not run an installer.
const core=process.argv[2];
if(!core)throw Error('Usage: node integration/array/verify-adapter.mjs <patched-Array-apps/desktop/core>');
const {createAdapters}=await import(pathToFileURL(path.resolve(core,'adapters.mjs')).href);
let checks=0;
function pass(name){checks++;console.log('PASS '+name);}
const bytes=Buffer.from('deterministic executable identity fixture');
let status='Valid',product='KI Metadata Workbench',query='';
const publisher={thumbprint:'ABC123'};
const policy={productPublishers:{metadata:publisher}};
const adapters=createAdapters({platform:'win32',fs:{readFile:async()=>bytes},powershell:async script=>{
  query=script;
  if(script.includes('Get-Process'))return {stdout:'False'};
  return {stdout:JSON.stringify({product,version:'0.4.0.0',status,thumbprint:'ABC123'})};
}});
assert(adapters.annex&&adapters.forge&&adapters.metadata);
assert.equal(adapters.metadata.nativeId,'industries.kuykendall.metadata');
assert.deepEqual(adapters.metadata.kinds,['nsis']);
pass('Patched Array registers METADATA with the existing Annex and FORGE adapters and NSIS-only identity');
for(const platform of ['darwin','linux']){
  assert.equal(createAdapters({platform}).metadata,undefined);
  pass('No unsupported METADATA adapter is registered on '+platform);
}
const exe='C:\\KI Tools\\KI Metadata Workbench.exe';
await assert.rejects(()=>adapters.metadata.locate('C:\\KI Tools\\other.exe',policy),{code:'WRONG_EXECUTABLE'});
pass('The adapter rejects a different executable basename');
product='Electron';
await assert.rejects(()=>adapters.metadata.locate(exe,policy),{code:'WRONG_EXECUTABLE'});
pass('The adapter requires the actual KI product resource, not a generic Electron identity');
product='KI Metadata Workbench';status='NotSigned';
await assert.rejects(()=>adapters.metadata.locate(exe,policy),{code:'PUBLISHER_NOT_CONNECTED'});
await assert.rejects(()=>adapters.metadata.verifyArtifact('C:\\KI Tools\\Setup.exe',{},policy),{code:'NATIVE_SIGNATURE'});
pass('Unsigned application and installer candidates are refused by Array publisher trust');
status='Valid';
const located=await adapters.metadata.locate(exe,policy);
assert.equal(located.version,'0.4.0');
assert.equal(located.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
pass('A matching trusted identity resolves the release version and executable hash');
assert.equal(await adapters.metadata.isRunning({executable:exe}),false);
for(const name of ['KI Metadata Workbench','ki-meta','ffmpeg','ffprobe','exiftool'])assert(query.includes(name));
assert(query.includes('resources\\bin\\exiftool\\exiftool.exe'));
pass('Update protection checks the app, native core, FFmpeg, ffprobe and ExifTool at their installation paths');
console.log(`${checks} Array adapter contract checks passed against the patched source. Windows OS calls were mocked; no repository was published or installer executed.`);
