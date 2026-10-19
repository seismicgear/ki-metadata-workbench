// Applies only resources to an unsigned upstream Electron executable, then verifies every other section.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import * as R from 'resedit';
import {calculateCheckSumForPE} from 'pe-library';
const [source,destination]=process.argv.slice(2);
if(!source||!destination||path.resolve(source)===path.resolve(destination))throw Error('Usage: node scripts/brand-windows.mjs <upstream-electron.exe> <different-output.exe>');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8')),original=fs.readFileSync(source),exe=R.NtExecutable.from(original),resources=R.NtExecutableResource.from(exe);
const sha=b=>createHash('sha256').update(Buffer.from(b)).digest('hex');
const snapshot=executable=>executable.getAllSections().filter(s=>s.info.name!=='.rsrc').map(s=>({name:s.info.name,virtualAddress:s.info.virtualAddress,virtualSize:s.info.virtualSize,characteristics:s.info.characteristics,sha256:sha(s.data??new ArrayBuffer(0))}));
const before=snapshot(exe),extra=sha(exe.getExtraData()??new ArrayBuffer(0));
const icons=R.Data.IconFile.from(fs.readFileSync('assets/metadata-icon.ico'));
for(const group of R.Resource.IconGroupEntry.fromEntries(resources.entries))R.Resource.IconGroupEntry.replaceIconsForResource(resources.entries,group.id,group.lang,icons.icons.map(i=>i.data));
const versions=R.Resource.VersionInfo.fromEntries(resources.entries);assert.equal(versions.length,1,'Expected one Electron version resource');
const vi=versions[0];for(const language of vi.getAllLanguagesForStringValues()){
  vi.setFileVersion(pkg.version,language.lang);vi.setProductVersion(pkg.version,language.lang);
  vi.setStringValues(language,{CompanyName:'Kuykendall Industries',FileDescription:pkg.productName,ProductName:pkg.productName,InternalName:'ki-metadata-workbench',OriginalFilename:pkg.productName+'.exe',LegalCopyright:'Kuykendall Industries'});
}vi.outputToResourceEntries(resources.entries);
// Keep the original resource allocation and every RVA. Regenerating the whole PE
// can move .reloc when resource contents become smaller than Electron's reservation.
const resourceSection=exe.getSectionByEntry(2);assert.ok(resourceSection?.data,'Missing resource section');
const generated=resources.generateResourceData(resourceSection.info.virtualAddress,exe.getFileAlignment(),true,false);
assert.ok(generated.bin.byteLength<=resourceSection.info.sizeOfRawData&&generated.rawSize<=resourceSection.info.virtualSize,'Resources exceed the upstream allocation');
const storage=new Uint8Array(original.length);storage.set(original);const binary=Buffer.from(storage.buffer),start=resourceSection.info.pointerToRawData,end=start+resourceSection.info.sizeOfRawData;
binary.fill(0,start,end);Buffer.from(generated.bin).copy(binary,start);
const checksumOffset=exe.dosHeader.newHeaderAddress+88;calculateCheckSumForPE(storage.buffer,true);
assert.ok(binary.subarray(0,checksumOffset).equals(original.subarray(0,checksumOffset)));assert.ok(binary.subarray(checksumOffset+4,start).equals(original.subarray(checksumOffset+4,start)));assert.ok(binary.subarray(end).equals(original.subarray(end)));
const readback=R.NtExecutable.from(binary);assert.deepEqual(snapshot(readback),before,'Non-resource section data or virtual addresses changed');assert.equal(sha(readback.getExtraData()??new ArrayBuffer(0)),extra,'Executable overlay changed');
const verified=R.Resource.VersionInfo.fromEntries(R.NtExecutableResource.from(readback).entries)[0];const strings=verified.getAllLanguagesForStringValues().map(l=>verified.getStringValues(l));for(const s of strings){assert.equal(s.ProductName,pkg.productName);assert.ok(s.FileVersion.startsWith(pkg.version));assert.equal(s.CompanyName,'Kuykendall Industries');}
fs.writeFileSync(destination,binary);
const evidence={version:pkg.version,tool:'resedit 3.1.0',source_sha256:sha(original),output_sha256:sha(binary),non_resource_sections_unchanged:true,overlay_unchanged:true,sections_verified:before,version_resources:strings,signed:false};
fs.mkdirSync('docs/evidence',{recursive:true});fs.writeFileSync('docs/evidence/windows-brand-resources-'+pkg.version+'.json',JSON.stringify(evidence,null,2)+'\n');
console.log('Windows product/version/icon resources verified; every non-resource section and overlay is unchanged.');
