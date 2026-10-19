import {spawnSync} from 'node:child_process';
import fs from 'node:fs';import path from 'node:path';
const vendor=(name)=>{const ext=process.platform==='win32'?'.exe':'';const file=path.resolve('vendor',process.platform==='win32'?'win32-x64':'local',name==='exiftool'?'exiftool/'+name+ext:name+ext);return fs.existsSync(file)?file:name;};
const checks=[['Node','node',['--version'],true],['Rust compiler','rustc',['--version'],true],['Cargo','cargo',['--version'],true],['FFmpeg',process.env.KI_FFMPEG||vendor('ffmpeg'),['-version'],false],['ffprobe',process.env.KI_FFPROBE||vendor('ffprobe'),['-version'],false],['ExifTool',process.env.KI_EXIFTOOL||vendor('exiftool'),['-ver'],false]];
let failures=0;
console.log('KUYKENDALL INDUSTRIES / METADATA 0.4.0\nSource-build diagnostics\n');
for(const [label,exe,args,required]of checks){const result=spawnSync(exe,args,{encoding:'utf8',windowsHide:true,shell:false,timeout:10000});const ok=!result.error&&result.status===0;console.log(`${ok?'OK':'MISSING'}  ${label}: ${ok?result.stdout.split('\n')[0]:'not available; check its configured path'}`);if(!ok&&required)failures++;}
if(Number(process.versions.node.split('.')[0])<22){console.log('Node 22 or newer is required for development.');failures++;}
const binary=path.resolve('native/target/release/ki-meta'+(process.platform==='win32'?'.exe':''));console.log(`${fs.existsSync(binary)?'OK':'NOT BUILT'}  Native engine: ${binary}`);
if(process.platform==='win32')console.log('\nRust MSVC source builds also need Visual Studio C++ Build Tools and a Windows SDK.');
console.log('\nThe portable application includes its runtime tools; these compiler checks apply only to source builds.');
console.log('Native integration tests additionally need Python 3 and a full FFmpeg build capable of generating fixtures.');
process.exitCode=failures?1:0;
