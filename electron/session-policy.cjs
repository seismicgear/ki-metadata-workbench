'use strict';
const path=require('node:path');

// This is an application write lock, not an operating-system forensic write blocker.
class SessionPolicy {
  constructor(locked=false){this.locked=locked;this.readOnly=locked;}
  state(){return {read_only:this.readOnly,locked:this.locked};}
  set(value,writing=false){
    if(typeof value!=='boolean')throw Error('Invalid inspection mode.');
    if(writing)throw Error('Wait for the current write to finish before changing modes.');
    if(this.locked&&!value)throw Error('This session was launched with inspection locked. Start a new session without --inspect-only to enable edits.');
    this.readOnly=value;return this.state();
  }
  lock(){this.locked=true;this.readOnly=true;return this.state();}
  assertWritable(){if(this.readOnly)throw Error('Inspect-only mode blocks file edits and backup restoration. Switch to Edit & clean to save changes.');}
}
function launchArguments(argv,packaged){
  const args=argv.slice(1);let literal=false,locked=false,skipEntry=!packaged;const files=[];
  for(const arg of args){if(typeof arg!=='string')continue;if(!literal&&arg==='--'){literal=true;continue;}if(!literal&&arg==='--inspect-only'){locked=true;continue;}if(!literal&&arg.startsWith('-'))continue;if(skipEntry){skipEntry=false;continue;}if(path.isAbsolute(arg))files.push(arg);}
  return {files:files.slice(0,1000),locked};
}
function reportText(value,format){
  if(!['json','csv'].includes(format))throw Error('Unsupported report format.');
  const text=format==='json'?JSON.stringify(value,null,2):value;
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>24*1024*1024)throw Error('Reports must contain text and be at most 24 MiB. Reduce the selection or omit raw metadata.');
  return format==='csv'?'\ufeff'+text:text;
}
module.exports={SessionPolicy,launchArguments,reportText};
