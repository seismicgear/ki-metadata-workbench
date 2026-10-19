// Real media fixtures. Native checks require a compiled Rust engine; never substitute a mock.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ki-media-tests-'));
const core=process.env.KI_CORE||path.resolve('native/target/release/ki-meta'+(process.platform==='win32'?'.exe':''));
const ffmpeg=process.env.KI_FFMPEG||'ffmpeg',ffprobe=process.env.KI_FFPROBE||'ffprobe';
const results=[];
function run(cmd,args){const r=spawnSync(cmd,args,{encoding:'utf8',timeout:120000,windowsHide:true,maxBuffer:16*1024*1024});if(r.error||r.status!==0)throw Error((r.error?.message??'')+' '+r.stderr);return r.stdout;}
function ff(args){return run(ffmpeg,['-v','error','-nostdin','-y',...args]);}
function hashes(file){return ff(['-i',file,'-map','0:a?','-map','0:V?','-c','copy','-f','streamhash','-hash','sha256','-']).trim();}
function check(name,fn){fn();results.push({name,passed:true});console.log('PASS '+name);}
function rpc(method,params){const request=path.join(dir,'request.json');fs.writeFileSync(request,JSON.stringify({id:1,method,params}));return JSON.parse(run(core,['request',request]));}
try{
  const mp3=path.join(dir,'source.mp3'),wav=path.join(dir,'source.wav'),video=path.join(dir,'source.mp4');
  ff(['-f','lavfi','-i','sine=frequency=440:duration=1','-c:a','libmp3lame','-metadata','title=Original','-metadata','comment=private-test-marker',mp3]);
  ff(['-f','lavfi','-i','sine=frequency=330:duration=1','-c:a','pcm_s16le',wav]);
  ff(['-f','lavfi','-i','color=c=black:s=64x64:d=1','-f','lavfi','-i','sine=frequency=220:duration=1','-map','0:v','-map','1:a','-c:v','mpeg4','-c:a','aac','-shortest','-metadata','title=Original','-metadata','comment=private-test-marker',video]);
  check('MP3 stream-copy tagging preserves demuxed A/V packet hashes',()=>{const out=path.join(dir,'ffmpeg-copy.mp3');ff(['-i',mp3,'-map','0:a:0','-map_metadata','-1','-c','copy','-metadata','artist=Montgomery Kuykendall',out]);assert.equal(hashes(mp3),hashes(out));});
  check('MP4 all-stream remux preserves packet hashes and requested tags',()=>{const out=path.join(dir,'ffmpeg-copy.mp4');ff(['-i',video,'-map','0','-copy_unknown','-c','copy','-map_chapters','0','-map_metadata','-1','-metadata','title=KI Test','-metadata','label=Kuykendall Industries','-movflags','+use_metadata_tags','-fflags','+bitexact',out]);assert.equal(hashes(video),hashes(out));const p=JSON.parse(run(ffprobe,['-v','error','-show_format','-show_streams','-of','json',out]));assert.equal(p.streams.length,2);assert.equal(p.format.tags.title,'KI Test');assert.equal(p.format.tags.label,'Kuykendall Industries');assert.equal(p.format.tags.comment,undefined);});
  if(process.argv.includes('--ffmpeg-only')){console.log('Native tests NOT RUN (--ffmpeg-only explicitly selected).');}
  else{
    if(!fs.existsSync(core))throw Error('Rust engine absent. Run npm run build:core. FFmpeg fixture checks passed, but native integration has NOT run.');
    process.env.KI_DATA_DIR=path.join(dir,'appdata');
    const inspect=file=>rpc('inspect',{path:file});
    const save=(file,patch,out,extra={})=>rpc('save',{path:file,expected_etag:inspect(file).etag,patch,output:out,replace_original:false,allow_unverified:false,accept_remux:false,...extra});
    const patch=fields=>({fields,raw:[],policy:'keep',artwork:{action:'keep'}});
    check('Native MP3 Unicode metadata edit and verification',()=>{const result=save(mp3,patch({title:'未来 & <KI>',artist:'Montgomery Kuykendall'}),path.join(dir,'native.mp3'));assert.equal(result.after.fields.title,'未来 & <KI>');assert.equal(result.verification.status,'matched');assert.equal(inspect(mp3).fields.title,'Original');});
    check('Native copy refuses clobber',()=>assert.throws(()=>save(mp3,patch({title:'x'}),path.join(dir,'native.mp3'))));
    check('Native stale etag refuses edit',()=>assert.throws(()=>save(mp3,patch({title:'x'}),path.join(dir,'stale.mp3'),{expected_etag:'0'.repeat(64)})));
    check('Native descriptive clear removes comment',()=>{const p=patch({title:'Public'});p.policy='clear_descriptive';const result=save(mp3,p,path.join(dir,'clean.mp3'));assert.equal(result.after.fields.comment,undefined);assert.equal(result.after.fields.title,'Public');});
    check('Native replacement backup and full-file restoration',()=>{const original=fs.readFileSync(wav);const result=save(wav,patch({title:'Edited'}),null,{replace_original:true});assert.ok(result.backup);assert.deepEqual(fs.readFileSync(result.backup),original);rpc('restore',{journal:result.journal});assert.deepEqual(fs.readFileSync(wav),original);});
    for(const ext of ['png','jpg']){
      const image=path.join(dir,'source.'+ext);ff(['-f','lavfi','-i','color=c=blue:s=64x64','-frames:v','1','-threads','1',image]);
      check('Native '+ext+' XMP preserves image bytes and Unicode',()=>{const result=save(image,patch({title:'未来 & KI',keywords:'Rock & Roll; KI'}),path.join(dir,'edited.'+ext));assert.equal(result.after.fields.title,'未来 & KI');assert.equal(result.verification.status,'matched');});
    }
    check('Native artwork replacement, extraction and removal',()=>{const p=patch({});p.artwork={action:'replace',path:path.join(dir,'source.jpg')};const art=save(mp3,p,path.join(dir,'art.mp3'));assert.equal(art.after.artwork.length,1);rpc('export_artwork',{path:art.output,index:0,output:path.join(dir,'extracted.jpg')});assert.deepEqual(fs.readFileSync(path.join(dir,'extracted.jpg')),fs.readFileSync(path.join(dir,'source.jpg')));p.artwork={action:'remove'};const removed=save(art.output,p,path.join(dir,'no-art.mp3'));assert.equal(removed.after.artwork.length,0);});
    check('Native video rejects unacknowledged remux',()=>assert.throws(()=>save(video,patch({title:'Updated'}),path.join(dir,'blocked.mp4'))));
    check('Native video tag edit retains A/V inventory',()=>{const r=save(video,patch({title:'Updated'}),path.join(dir,'native.mp4'),{accept_remux:true});assert.equal(r.after.fields.title,'Updated');assert.equal(r.after.properties.streams.length,2);assert.equal(r.verification.status,'matched');});
  }
  console.log(JSON.stringify({mode:process.argv.includes('--ffmpeg-only')?'ffmpeg-only':'native-and-ffmpeg',results},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
