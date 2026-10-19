'use strict';
const {app,BrowserWindow,ipcMain,dialog,Menu,shell,protocol,net,session} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {randomUUID} = require('node:crypto');
const {CoreBridge} = require('./core-bridge.cjs');
const {SessionPolicy,launchArguments,reportText}=require('./session-policy.cjs');
const {SUPPORTED,IMAGE,supported,safeName,validatePreset,validatePresetPack,validateSave} = require('./security.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'ki-media',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let window, core, dirty=false, writing=false, config={}, userDir;
const launch=launchArguments(process.argv,app.isPackaged);
const mode=new SessionPolicy(launch.locked||process.env.KI_READ_ONLY==='1');
let pendingLaunchFiles=[...launch.files],launchReady=false;
let pendingInspectionLock=false;
function lockInspection(){if(writing){pendingInspectionLock=true;return;}pendingInspectionLock=false;mode.lock();window?.webContents.send('ki:session',mode.state());}
function finishWrite(){writing=false;if(pendingInspectionLock)lockInspection();}
async function deliverLaunchFiles(files){if(!launchReady){pendingLaunchFiles.push(...files);return;}const result=await collect(files);if(window&&!window.isDestroyed())window.webContents.send('ki:openFiles',result);}
app.on('open-file',(event,file)=>{event.preventDefault();void deliverLaunchFiles([file]);});
const singleInstance=app.requestSingleInstanceLock();
if(!singleInstance)app.quit();
app.on('second-instance',(_event,argv)=>{const next=launchArguments(argv,app.isPackaged);if(next.locked)lockInspection();void deliverLaunchFiles(next.files);if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
const approved = new Set(), artworkPaths = new Set(), mediaTokens = new Map(), historyTokens = new Set(), exportFolders = new Map();
const builtinTeam = {id:'builtin-ki-team',name:'KI · Media credit',policy:'keep',builtin:true,fields:{label:'Kuykendall Industries'}};
const builtinDocument = {id:'builtin-ki-document',name:'KI · Document properties',policy:'keep',builtin:true,fields:{company:'Kuykendall Industries'}};
const builtin = {id:'builtin-ki-release',name:'Kuykendall Industries · Release',policy:'keep',builtin:true,
  fields:{artist:'Montgomery Kuykendall',album_artist:'Montgomery Kuykendall',label:'Kuykendall Industries'}};
const builtinImagePrivacy = {id:'builtin-image-privacy',name:'Private sharing · Strip image metadata',policy:'strip_metadata',builtin:true,fields:{}};
const renderer = pathToFileURL(path.join(__dirname,'../dist/renderer/index.html')).href;
function validateSender(event) {if(!window || event.sender!==window.webContents || event.senderFrame!==window.webContents.mainFrame || event.senderFrame.url.split('#')[0]!==renderer)throw Error('Untrusted IPC sender.');}
function handle(name,fn){ipcMain.handle('ki:'+name,(event,...args)=>{validateSender(event);return fn(...args);});}
async function selected(file){if(typeof file!=='string'||!approved.has(file))throw Error('Choose this file with the file picker or drag it into the app first.');return file;}
async function approve(file,art=false){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Only regular files are supported.');const real=await fs.realpath(file);if(art){if(!IMAGE.has(path.extname(real).toLowerCase()))throw Error('Artwork must be JPEG or PNG.');artworkPaths.add(real);}else if(!supported(real))throw Error('This file cannot be opened.');approved.add(real);return real;}
async function collect(paths){const result={paths:[],warnings:[]};let visited=0;
  const walk=async(file)=>{if(result.paths.length>=1000||visited++>=10000){if(!result.warnings.includes('Import limit reached (1,000 files / 10,000 directory entries).'))result.warnings.push('Import limit reached (1,000 files / 10,000 directory entries).');return;}
    try{const stat=await fs.lstat(file);if(stat.isSymbolicLink()){result.warnings.push('Skipped link: '+path.basename(file));return;}
      if(stat.isDirectory()){if(path.basename(file).startsWith('.'))return;for(const entry of await fs.readdir(file))await walk(path.join(file,entry));}
      else if(supported(file))result.paths.push(await approve(file));else result.warnings.push('Unsupported: '+path.basename(file));
    }catch(error){result.warnings.push(path.basename(file)+': '+error.message);}};
  for(const file of paths.slice(0,1000))if(typeof file==='string')await walk(file);
  result.paths=[...new Set(result.paths)];result.warnings=result.warnings.slice(0,100);return result;
}
async function atomicJson(file,value){const temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2),{flag:'wx'});await fs.rename(temp,file);}
async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return fallback;}}
async function customPresets(){const rows=await readJson(path.join(userDir,'presets.json'),[]);return Array.isArray(rows)?rows.filter(p=>p&&typeof p.name==='string').map(p=>{try{return validatePreset(p);}catch{return null;}}).filter(Boolean):[];}
function enginePath(name) {
  const filename=name+(process.platform==='win32'?'.exe':'');
  const bundled=path.join(process.resourcesPath||'', 'bin', name==='exiftool'?'exiftool':'', filename);
  const dev=path.join(__dirname,'../vendor',process.platform==='win32'?'win32-x64':'local',name==='exiftool'?'exiftool':'',filename);
  return config[name] || (require('node:fs').existsSync(bundled)?bundled:require('node:fs').existsSync(dev)?dev:'');
}
function createCore(){const binary=app.isPackaged?path.join(process.resourcesPath,'bin','ki-meta'+(process.platform==='win32'?'.exe':'')):path.join(__dirname,'../native/target/release','ki-meta'+(process.platform==='win32'?'.exe':''));return new CoreBridge(binary,{KI_DATA_DIR:userDir,KI_FFMPEG:enginePath('ffmpeg'),KI_FFPROBE:enginePath('ffprobe'),KI_EXIFTOOL:enginePath('exiftool')});}
async function copyDestination(folder,source,privateCopy,neutral,index) {
  const ext=path.extname(source);const base=neutral?'KI-share-'+String(index).padStart(3,'0'):safeName(path.basename(source,ext)+(privateCopy?' private':' KI'),'KI-file');
  for(let n=0;n<10000;n++){const file=path.join(folder,base+(n?' ('+n+')':'')+ext);try{await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return file;throw e;}}
  throw Error('Too many files with that name in the export folder.');
}

async function register(){
  handle('sessionState',()=>mode.state());
  handle('setReadOnly',value=>mode.set(value,writing));
  handle('launchFiles',async()=>{launchReady=true;const files=pendingLaunchFiles;pendingLaunchFiles=[];return collect(files);});
  handle('pickFiles',async folder=>{const pick=await dialog.showOpenDialog(window,{title:folder?'Add a folder':'Open files',properties:folder?['openDirectory']:['openFile','multiSelections'],filters:folder?undefined:[{name:'All files',extensions:['*']},{name:'Editable formats',extensions:[...SUPPORTED].map(e=>e.slice(1))}]});return pick.canceled?{paths:[],warnings:[]}:collect(pick.filePaths);});
  handle('dropped',paths=>{if(!Array.isArray(paths))throw Error('Invalid drop.');return collect(paths);});
  handle('inspect',async file=>{const result=await core.call('inventory',{path:await selected(file)});approved.add(result.path);return result;});
  handle('preview',async file=>{await selected(file);const token=randomUUID();mediaTokens.set(token,file);return 'ki-media://file/'+token;});
  handle('pickArtwork',async()=>{const pick=await dialog.showOpenDialog(window,{title:'Choose front cover',properties:['openFile'],filters:[{name:'Cover image',extensions:['png','jpg','jpeg']}]});return pick.canceled?null:approve(pick.filePaths[0],true);});
  handle('chooseExportFolder',async options=>{
    if(writing)throw Error('Wait for the current save to finish.');
    if(options!==undefined && (typeof options!=='object'||typeof options.neutral_names!=='boolean'))throw Error('Invalid export options.');
    const pick=await dialog.showOpenDialog(window,{title:'Choose one folder for the batch',properties:['openDirectory','createDirectory']});if(pick.canceled)return null;
    const folder=await fs.realpath(pick.filePaths[0]);const token=randomUUID();
    if(exportFolders.size>=16)exportFolders.delete(exportFolders.keys().next().value);
    exportFolders.set(token,{folder,neutral:options?.neutral_names===true,index:0});return token;
  });
  handle('releaseExportFolder',token=>{exportFolders.delete(token);});
  handle('save',async value=>{
    mode.assertWritable();if(writing)throw Error('Another write is in progress.');const req=validateSave(value);writing=true;
    try {
      await selected(req.path);
      if(req.patch.artwork?.action==='replace'&&!artworkPaths.has(req.patch.artwork.path))throw Error('Choose replacement artwork with the artwork picker.');
      const batch=req.batch_token?exportFolders.get(req.batch_token):null;
      if(req.batch_token&&!batch)throw Error('Choose the export folder again.');delete req.batch_token;
      if(req.replace_original){const answer=await dialog.showMessageBox(window,{type:'warning',title:'Replace original?',message:'Replace '+path.basename(req.path)+'?',detail:'A verified backup will be saved beside the original in .ki-backups. The app will stop if verification fails.',buttons:['Cancel','Replace with backup'],defaultId:0,cancelId:0});if(answer.response!==1)return null;}
      else if(batch){req.output=await copyDestination(batch.folder,req.path,req.patch.policy!=='keep',batch.neutral,++batch.index);}
      else{const ext=path.extname(req.path);const privacy=req.patch.policy!=='keep';const pick=await dialog.showSaveDialog(window,{title:privacy?'Save a cleaned copy':'Save a metadata-edited copy',defaultPath:path.join(path.dirname(req.path),path.basename(req.path,ext)+(privacy?' private':' KI')+ext),filters:ext?[{name:'Same format',extensions:[ext.slice(1)]}]:undefined});if(pick.canceled||!pick.filePath)return null;req.output=pick.filePath;}
      const result=await core.call('save',req);approved.add(result.output);if(result.journal)historyTokens.add(result.journal);return result;
    }finally{finishWrite();}
  });
  handle('exportArtwork',async(file,index)=>{await selected(file);if(!Number.isInteger(index)||index<0)throw Error('Invalid artwork index.');const info=await core.call('inspect',{path:file});const artwork=info.artwork[index];if(!artwork)throw Error('Artwork no longer exists.');const ext=artwork.mime==='image/png'?'png':artwork.mime==='image/jpeg'?'jpg':'bin';const pick=await dialog.showSaveDialog(window,{title:'Extract embedded artwork',defaultPath:path.join(path.dirname(file),'cover.'+ext)});if(pick.canceled||!pick.filePath)return null;await core.call('export_artwork',{path:file,index,output:pick.filePath});return pick.filePath;});
  handle('exportJson',async(value,suggested)=>{const text=JSON.stringify(value,null,2);if(text.length>24*1024*1024)throw Error('JSON export exceeds 24 MiB.');const pick=await dialog.showSaveDialog(window,{title:'Export metadata snapshot',defaultPath:safeName(suggested),filters:[{name:'JSON',extensions:['json']}]});if(pick.canceled||!pick.filePath)return null;await fs.writeFile(pick.filePath,text,{flag:'wx'});return pick.filePath;});
  handle('exportReport',async(value,format,suggested)=>{const text=reportText(value,format);const pick=await dialog.showSaveDialog(window,{title:'Export workspace report',defaultPath:safeName(suggested),filters:[{name:format.toUpperCase(),extensions:[format]}]});if(pick.canceled||!pick.filePath)return null;await fs.writeFile(pick.filePath,text,{flag:'wx'});return pick.filePath;});
  handle('presets',async()=>[builtinTeam,builtinDocument,builtin,builtinImagePrivacy,...await customPresets()]);
  handle('savePreset',async value=>{const preset=validatePreset(value);const old=await customPresets();const next=[...old.filter(p=>p.id!==preset.id),preset];await atomicJson(path.join(userDir,'presets.json'),next);return [builtinTeam,builtinDocument,builtin,builtinImagePrivacy,...next];});
  handle('deletePreset',async id=>{if(typeof id!=='string'||id.startsWith('builtin-'))throw Error('The built-in preset cannot be deleted.');const next=(await customPresets()).filter(p=>p.id!==id);await atomicJson(path.join(userDir,'presets.json'),next);return [builtinTeam,builtinDocument,builtin,builtinImagePrivacy,...next];});
  handle('exportPresets',async()=>{
    const rows=await customPresets();if(!rows.length)throw Error('Save a custom preset before exporting a team pack.');
    const pick=await dialog.showSaveDialog(window,{title:'Export team presets',defaultPath:'KI-Team-Presets.json',filters:[{name:'KI preset pack',extensions:['json']}]});if(pick.canceled||!pick.filePath)return null;
    await fs.writeFile(pick.filePath,JSON.stringify({application:'KI Metadata Workbench',schema_version:1,presets:rows},null,2),{flag:'wx'});return pick.filePath;
  });
  handle('importPresets',async()=>{
    const pick=await dialog.showOpenDialog(window,{title:'Import team presets',properties:['openFile'],filters:[{name:'KI preset pack',extensions:['json']}]});if(pick.canceled)return null;
    const stat=await fs.lstat(pick.filePaths[0]);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error('Choose a preset JSON file under 8 MiB.');
    const rows=validatePresetPack(JSON.parse(await fs.readFile(pick.filePaths[0],'utf8')));const next=[...await customPresets(),...rows];if(next.length>500)throw Error('The preset collection is limited to 500 templates.');
    await atomicJson(path.join(userDir,'presets.json'),next);return [builtinTeam,builtinDocument,builtin,builtinImagePrivacy,...next];
  });
  handle('doctor',()=>core.call('doctor'));
  handle('chooseTool',async name=>{if(!['ffmpeg','ffprobe','exiftool'].includes(name))throw Error('Unknown tool.');if(writing||core.pending.size)throw Error('Wait for the current operation to finish before changing tools.');const pick=await dialog.showOpenDialog(window,{title:'Choose trusted '+name+' executable',properties:['openFile'],filters:process.platform==='win32'?[{name:'Executable',extensions:['exe']}]:undefined});if(pick.canceled)return null;config[name]=await fs.realpath(pick.filePaths[0]);await atomicJson(path.join(userDir,'tools.json'),config);core.close();core=createCore();return core.call('doctor');});
  handle('reveal',async file=>{await selected(file);shell.showItemInFolder(file);});
  handle('history',async()=>{const rows=await core.call('history');for(const row of rows){if(row.journal)historyTokens.add(row.journal);approved.add(row.output);}return rows;});
  handle('restore',async journal=>{mode.assertWritable();if(!historyTokens.has(journal))throw Error('Select a journal from History.');if(writing)throw Error('Another write is in progress.');writing=true;try{const answer=await dialog.showMessageBox(window,{type:'warning',message:'Restore the complete original from its backup?',detail:'Newer changes block restoration. The current version receives another recovery backup.',buttons:['Cancel','Restore original'],defaultId:0,cancelId:0});if(answer.response!==1)return null;const result=await core.call('restore',{journal});approved.add(result.path);return result;}finally{finishWrite();}});
  ipcMain.on('ki:dirty',(event,value)=>{validateSender(event);dirty=!!value;});
}
if(singleInstance)app.whenReady().then(async()=>{
  if(process.platform==='win32')app.setAppUserModelId('industries.kuykendall.metadata');
  userDir=app.getPath('userData');await fs.mkdir(userDir,{recursive:true});config=await readJson(path.join(userDir,'tools.json'),{});core=createCore();
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_details,callback)=>callback({cancel:true}));
  session.defaultSession.on('will-download',(event)=>event.preventDefault());
  protocol.handle('ki-media',request=>{const url=new URL(request.url);const file=mediaTokens.get(url.pathname.slice(1));if(url.hostname!=='file'||!file||!approved.has(file))return new Response('Not allowed',{status:403});return net.fetch(pathToFileURL(file).href,{headers:request.headers});});
  window=new BrowserWindow({width:1540,height:980,minWidth:980,minHeight:700,backgroundColor:'#050506',title:'METADATA · Kuykendall Industries',icon:path.join(__dirname,'../assets/metadata-icon.png'),show:false,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(event)=>event.preventDefault());
  window.on('close',event=>{if(writing){event.preventDefault();dialog.showMessageBoxSync(window,{type:'info',message:'A write is in progress. Close after it finishes.',buttons:['OK']});return;}
    if(dirty&&dialog.showMessageBoxSync(window,{type:'question',message:'Discard unsaved metadata changes?',buttons:['Keep editing','Discard and close'],defaultId:0,cancelId:0})===0)event.preventDefault();});
  const send=action=>window.webContents.send('ki:menu',action);
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'File',submenu:[{label:'Add files…',accelerator:'CmdOrCtrl+O',click:()=>send('open')},{label:'Add folder…',click:()=>send('folder')},{type:'separator'},{label:'Save copy…',accelerator:'CmdOrCtrl+Shift+S',click:()=>send('save')},{label:'Replace original…',accelerator:'CmdOrCtrl+S',click:()=>send('replace')},{type:'separator'},{role:'quit'}]},{label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'View',submenu:[{label:'Command menu…',accelerator:'CmdOrCtrl+K',click:()=>send('commands')},{label:'History',click:()=>send('history')},{label:'Tools',click:()=>send('tools')},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}]));
  await register();await window.loadURL(renderer);window.show();
}).catch(error=>{dialog.showErrorBox('KI Metadata Workbench',error.stack||error.message);app.quit();});
app.on('window-all-closed',()=>app.quit());app.on('before-quit',()=>{if(!writing)core?.close();});
