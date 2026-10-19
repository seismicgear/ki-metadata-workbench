'use strict';
// Release tooling for a verified prepackaged directory. This does not run a Windows application.
const fs=require('node:fs'),path=require('node:path');
const {build,Platform,Arch}=require('electron-builder');
const project=path.resolve(__dirname,'..'),pkg=JSON.parse(fs.readFileSync(path.join(project,'package.json'),'utf8'));
const [runtime,electronArchive,cache]=process.argv.slice(2);
if(!runtime||!electronArchive||!cache)throw Error('Usage: node scripts/package-prebuilt-windows.cjs <win-unpacked> <official-Electron.zip> <builder-cache>');
const out=path.join(project,pkg.build.directories.output),setup=path.join(out,`KI-Metadata-Workbench-${pkg.version}-Windows-x64-Setup.exe`);
if(process.platform!=='win32'){
  // electron-builder already supplies a native reader for generating an uninstaller
  // without running the temporary installer (used in its macOS build route).
  // Select that same reader on Linux, restricted to this exact build artifact.
  const {WineVmManager}=require('app-builder-lib/out/vm/WineVm');
  const {UninstallerReader}=require('app-builder-lib/out/targets/nsis/nsisUtil');
  WineVmManager.prototype.exec=async function(file,args,options){
    if(path.resolve(file)!==setup||args.length||options?.env?.__COMPAT_LAYER!=='RunAsInvoker')throw Error('Unexpected Windows program execution requested during packaging.');
    const destination=path.join(out,path.basename(file,'exe')+'__uninstaller.exe');
    await UninstallerReader.exec(file,destination);
    const bytes=fs.readFileSync(destination);if(bytes.length<1024||bytes.subarray(0,2).toString()!=='MZ')throw Error('Generated uninstaller is invalid.');
    console.log('Generated the NSIS uninstaller with electron-builder’s native reader; no Windows process was executed.');
    return '';
  };
}
process.env.ELECTRON_BUILDER_CACHE=path.resolve(cache);process.env.CSC_IDENTITY_AUTO_DISCOVERY='false';
build({projectDir:project,prepackaged:path.resolve(runtime),targets:Platform.WINDOWS.createTarget(['portable','nsis'],Arch.x64),config:{npmRebuild:false,electronVersion:'44.9.0',electronDist:path.resolve(electronArchive),win:{signAndEditExecutable:false},toolsets:{nsis:'1.2.1'}}}).catch(error=>{console.error(error);process.exitCode=1;});
