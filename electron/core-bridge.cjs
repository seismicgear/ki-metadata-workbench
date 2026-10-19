'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
class CoreBridge {
  constructor(binary, env) { this.binary = binary; this.env = env; this.pending = new Map(); this.sequence = 0; this.process = null; this.buffer = ''; this.stderr = ''; }
  start() {
    if (this.process) return;
    if (!fs.existsSync(this.binary)) throw Error('The Rust engine has not been built. Run Launch.cmd, or npm run build:core. Tools and editors need the native engine; this is not a browser-only app.');
    const child = spawn(this.binary, ['serve'], { stdio:['pipe','pipe','pipe'], windowsHide:true, shell:false, env:{...process.env,...this.env} });
    this.process = child; this.buffer = ''; this.stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      this.buffer += data;
      if (this.buffer.length > 32 * 1024 * 1024) { child.kill(); this.fail(Error('Native response exceeded the limit.')); return; }
      let end;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0,end); this.buffer = this.buffer.slice(end+1);
        try {
          const response = JSON.parse(line); const job = this.pending.get(response.id);
          if (!job) continue;
          this.pending.delete(response.id);
          response.error ? job.reject(Error(response.error)) : job.resolve(response.result);
        } catch (error) { this.fail(Error('Invalid native-engine response: '+error.message)); child.kill(); }
      }
    });
    child.stderr.setEncoding('utf8');child.stderr.on('data',data=>{this.stderr=(this.stderr+data).slice(-32768);});
    child.on('error', error=>{this.process=null;this.fail(error);});
    child.on('exit', code=>{this.process=null;this.fail(Error(`Native engine exited (${code}). Inspect the file and history before retrying a save. ${this.stderr.slice(-500)}`));});
  }
  fail(error) { for (const job of this.pending.values()) job.reject(error); this.pending.clear(); }
  call(method, params = {}) {
    try { this.start(); } catch(error) { return Promise.reject(error); }
    const id = ++this.sequence;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{resolve,reject});
      this.process.stdin.write(JSON.stringify({id,method,params})+'\n',error=>{if(error){this.pending.delete(id);reject(error);}});
    });
  }
  close() { if(this.process) this.process.kill(); }
}
module.exports = { CoreBridge };
