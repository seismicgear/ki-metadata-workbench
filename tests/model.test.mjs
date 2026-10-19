import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyPatch,dirty,editField,valueFor,applyPreset,copyStagedPatch,setPolicy,supportsPolicy,setRaw,changeCount,formatBytes,formatDuration,findings,policyDescription,orientationWarning,appearanceWarnings,sharingPolicy,canEdit,FIELDS} from '../dist/renderer/model.js';
const doc=()=>({path:'sample.mp3',name:'sample.mp3',kind:'audio',format:'MP3',size:100,etag:'a'.repeat(64),fields:{title:'Before',artist:'Original',comment:'private'},raw:[{namespace:'Id3v2',key:'TrackTitle',value:'Before',writable:true},{namespace:'Id3v2',key:'Binary',value:'bytes',writable:false}],artwork:[],properties:{},warnings:[],capabilities:{fields:['title','artist','label'],artwork:true,raw_edit:true,policies:['keep','clear_descriptive','privacy'],writer:'test'}});
const imageDoc=(format='PNG')=>{const d=doc();d.path='sample.'+format.toLowerCase();d.kind='image';d.format=format;d.capabilities={...d.capabilities,artwork:false,policies:['keep','clear_descriptive','privacy','strip_metadata']};d.properties={orientation:6,image_privacy:{removable_blocks:2,categories:['EXIF','GPS'],trailing_bytes:4,exif_orientation:6,color_profiles:0}};return d;};
test('new patch is empty and unchanged',()=>{assert.equal(dirty(emptyPatch()),false);assert.equal(changeCount(emptyPatch()),0);});
test('editing does not mutate source inspection',()=>{const d=doc(),p=emptyPatch();editField(d,p,'title','After');assert.equal(d.fields.title,'Before');assert.equal(p.fields.title,'After');});
test('reverting a field removes its patch entry',()=>{const d=doc(),p=emptyPatch();editField(d,p,'title','After');editField(d,p,'title','Before');assert.equal(dirty(p),false);});
test('empty edit explicitly removes field',()=>{const p=emptyPatch();editField(doc(),p,'title','');assert.equal(p.fields.title,null);});
test('unsupported fields fail rather than disappear silently',()=>assert.throws(()=>editField(doc(),emptyPatch(),'publisher','KI')));
test('Unicode remains unchanged',()=>{const p=emptyPatch();editField(doc(),p,'title','未来 & <Monty>');assert.equal(p.fields.title,'未来 & <Monty>');});
test('clear policy renders empty baseline',()=>{const p=emptyPatch();p.policy='clear_descriptive';assert.equal(valueFor(doc(),p,'title'),'');});
test('explicit field survives clear baseline',()=>{const p=emptyPatch();p.policy='clear_descriptive';editField(doc(),p,'title','Before');assert.equal(valueFor(doc(),p,'title'),'Before');assert.ok(dirty(p));});
test('privacy clears visible comment baseline',()=>{const p=emptyPatch();p.policy='privacy';assert.equal(valueFor(doc(),p,'comment'),'');assert.equal(valueFor(doc(),p,'artist'),'Original');});
test('preset reports incompatible keys, does not reinterpret publisher',()=>{const p=emptyPatch();const skipped=applyPreset(doc(),p,{fields:{label:'KI',publisher:'Publishing'},policy:'keep'});assert.deepEqual(skipped,['publisher']);assert.equal(p.fields.label,'KI');assert.ok(!('publisher'in p.fields));});
test('label and publisher both exist as distinct semantic fields',()=>{assert.ok(FIELDS.some(f=>f.key==='label'));assert.ok(FIELDS.some(f=>f.key==='publisher'));});
test('known read-only raw fields reject editing',()=>assert.throws(()=>setRaw(doc(),emptyPatch(),{namespace:'Id3v2',key:'Binary',value:'hack'})));
test('repeated native edit is a single sparse operation',()=>{const p=emptyPatch();setRaw(doc(),p,{namespace:'Id3v2',key:'TrackTitle',value:'one'});setRaw(doc(),p,{namespace:'Id3v2',key:'TrackTitle',value:'two'});assert.equal(p.raw.length,1);assert.equal(p.raw[0].value,'two');});
test('native reversion removes native patch',()=>{const p=emptyPatch();setRaw(doc(),p,{namespace:'Id3v2',key:'TrackTitle',value:'one'});setRaw(doc(),p,{namespace:'Id3v2',key:'TrackTitle',value:'Before'});assert.equal(p.raw.length,0);});
test('artwork operation is part of dirty state',()=>{const p=emptyPatch();p.artwork={action:'remove'};assert.ok(dirty(p));assert.equal(changeCount(p),1);});
test('duration renders correctly',()=>{assert.equal(formatDuration(435.96),'7:15');assert.equal(formatDuration(null),'—');});
test('sizes are binary and guard invalid input',()=>{assert.equal(formatBytes(1048576),'1.0 MiB');assert.equal(formatBytes(NaN),'Unknown');});
test('findings are heuristic matches, not a privacy score',()=>{const d=doc();d.raw.push({namespace:'EXIF',key:'GPSLatitude',value:'test',writable:false});assert.equal(findings(d).length,1);assert.ok(policyDescription('clear_descriptive','video').includes('not globally stripped'));});
test('patch objects do not share mutable state',()=>{const a=emptyPatch(),b=emptyPatch();a.fields.title='x';a.raw.push({namespace:'x',key:'x',value:'x'});assert.equal(Object.keys(b.fields).length,0);assert.equal(b.raw.length,0);});
test('strip policy is restricted to supported image formats and native capability',()=>{
  for(const format of ['JPEG','PNG','WebP'])assert.ok(supportsPolicy(imageDoc(format),'strip_metadata'));
  for(const d of [doc(),{...doc(),kind:'video',format:'MP4'},imageDoc('TIFF')]){const p=emptyPatch();p.fields.title='Preserved';const before=structuredClone(p);assert.throws(()=>setPolicy(d,p,'strip_metadata'),/unavailable/);assert.deepEqual(p,before);}
  const d=imageDoc();d.capabilities.policies=['keep'];assert.equal(supportsPolicy(d,'strip_metadata'),false);
});
test('choosing strip clears all staged field, raw and artwork edits',()=>{
  const d=imageDoc(),original=structuredClone(d),p=emptyPatch();p.fields.title='New identifying title';p.raw=[{namespace:'XMP',key:'Creator',value:'Employee'}];p.artwork={action:'replace',path:'private.png'};
  setPolicy(d,p,'strip_metadata');assert.deepEqual(p,{fields:{},raw:[],artwork:{action:'keep'},policy:'strip_metadata'});assert.equal(valueFor(d,p,'title'),'');assert.equal(changeCount(p),1);assert.deepEqual(d,original);
});
test('strip policy refuses semantic and raw edits',()=>{
  const d=imageDoc(),p=emptyPatch();setPolicy(d,p,'strip_metadata');assert.throws(()=>editField(d,p,'title','Employee'),/does not allow/);assert.throws(()=>setRaw(d,p,{namespace:'XMP',key:'Creator',value:'Employee'}),/does not allow/);assert.deepEqual(p.fields,{});assert.deepEqual(p.raw,[]);
});
test('image privacy preset skips audio and video without changing their drafts',()=>{
  for(const d of [doc(),{...doc(),kind:'video',format:'MP4'}]){const p=emptyPatch();editField(d,p,'title','Existing draft');const before=structuredClone(p);const skipped=applyPreset(d,p,{fields:{},policy:'strip_metadata'});assert.equal(skipped.length,1);assert.match(skipped[0],/unavailable/);assert.deepEqual(p,before);}
});
test('image privacy preset clears existing image edits and refuses malformed preset additions',()=>{
  const d=imageDoc(),p=emptyPatch();editField(d,p,'title','Private');p.raw=[{namespace:'XMP',key:'x',value:'y'}];assert.deepEqual(applyPreset(d,p,{fields:{},policy:'strip_metadata'}),[]);assert.deepEqual(p.fields,{});assert.deepEqual(p.raw,[]);
  const before=structuredClone(p);assert.equal(applyPreset(d,p,{fields:{artist:'Employee'},policy:'strip_metadata'}).length,1);assert.deepEqual(p,before);
});
test('copying strict policy clears image target tags and skips incompatible media atomically',()=>{
  const source=imageDoc(),p=emptyPatch();setPolicy(source,p,'strip_metadata');const target=emptyPatch();target.fields.title='Private title';target.raw=[{namespace:'XMP',key:'private',value:'value'}];assert.deepEqual(copyStagedPatch(source,p,imageDoc('WebP'),target),[]);assert.deepEqual(target,p);
  const audio=emptyPatch();audio.fields.title='Keep';const before=structuredClone(audio);assert.equal(copyStagedPatch(source,p,doc(),audio).length,1);assert.deepEqual(audio,before);
});
test('WebP policy capabilities prevent unsupported descriptive presets',()=>{
  const d=imageDoc('WebP');d.capabilities.fields=[];d.capabilities.policies=['keep','strip_metadata'];const p=emptyPatch();setPolicy(d,p,'strip_metadata');const before=structuredClone(p);assert.equal(applyPreset(d,p,{policy:'clear_descriptive',fields:{}}).length,1);assert.deepEqual(p,before);
});
test('strict display never exposes stale staged values and switching policy permits edits again',()=>{
  const d=imageDoc(),p=emptyPatch();setPolicy(d,p,'strip_metadata');p.fields.title='Stale';assert.equal(valueFor(d,p,'title'),'');setPolicy(d,p,'strip_metadata');setPolicy(d,p,'keep');assert.equal(valueFor(d,p,'title'),'Before');editField(d,p,'title','After');assert.equal(valueFor(d,p,'title'),'After');
});
test('appearance warnings use native orientation and embedded profile inspection',()=>{
  const d=imageDoc();assert.match(orientationWarning(d),/rotated or flipped/);d.properties.image_privacy.color_profiles=1;assert.match(appearanceWarnings(d).join(' '),/colors can change/);d.properties.image_privacy.exif_orientation=1;d.properties.orientation=1;assert.equal(orientationWarning(d),null);d.properties.image_privacy.exif_orientation=null;assert.match(orientationWarning(d),/could not be confirmed/);d.properties.image_privacy.categories=[];assert.equal(orientationWarning(d),null);
});
test('AI generation and provenance inventories are discoverable in audit findings',()=>{
  const d=imageDoc();d.raw=[{namespace:'PNG',key:'parameters',value:'private prompt',writable:false},{namespace:'C2PA / JUMBF',key:'Manifest',value:'data',writable:false},{namespace:'PNG',key:'workflow',value:'private graph',writable:false}];assert.equal(findings(d).length,3);const text=policyDescription('strip_metadata','image');for(const name of ['EXIF','GPS','C2PA','JUMBF','Stable Diffusion','ComfyUI','pixel watermarks remain'])assert.ok(text.includes(name));
});

test('recommended cleanup follows native capabilities across mixed files',()=>{const d=doc();assert.equal(sharingPolicy(d),'privacy');assert.equal(sharingPolicy(imageDoc()),'strip_metadata');d.kind='document';assert.equal(sharingPolicy(d),'privacy');d.capabilities={fields:[],policies:[],artwork:false,raw_edit:false,writer:'inspect'};assert.equal(sharingPolicy(d),null);assert.equal(canEdit(d),false);});
test('document privacy baseline clears the actual property fields',()=>{const d=doc();d.kind='document';d.properties.privacy_clears=['artist','title'];const p=emptyPatch();p.policy='privacy';assert.equal(valueFor(d,p,'artist'),'');editField(d,p,'artist','KI');assert.equal(valueFor(d,p,'artist'),'KI');});
test('extended-image privacy clears the XMP field baseline',()=>{const d=imageDoc('TIFF');d.properties={adapter:'exiftool'};const p=emptyPatch();p.policy='privacy';assert.equal(valueFor(d,p,'title'),'');assert.equal(valueFor(d,p,'artist'),'');});
