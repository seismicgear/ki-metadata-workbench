'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const invoke = (name,...args) => ipcRenderer.invoke('ki:'+name,...args);
contextBridge.exposeInMainWorld('ki', {
  sessionState:()=>invoke('sessionState'),setReadOnly:value=>invoke('setReadOnly',value),launchFiles:()=>invoke('launchFiles'),
  onOpenFiles:callback=>ipcRenderer.on('ki:openFiles',(_event,result)=>callback(result)),
  onSession:callback=>ipcRenderer.on('ki:session',(_event,state)=>callback(state)),
  pickFiles: folder=>invoke('pickFiles',!!folder),
  dropped: files=>invoke('dropped',Array.from(files).map(file=>webUtils.getPathForFile(file)).filter(Boolean)),
  inspect: path=>invoke('inspect',path), save: request=>invoke('save',request), preview:path=>invoke('preview',path),
  pickArtwork:()=>invoke('pickArtwork'), exportArtwork:(path,index)=>invoke('exportArtwork',path,index),
  chooseExportFolder:options=>invoke('chooseExportFolder',options),releaseExportFolder:token=>invoke('releaseExportFolder',token),
  importPresets:()=>invoke('importPresets'),exportPresets:()=>invoke('exportPresets'),
  exportJson:(data,suggested)=>invoke('exportJson',data,suggested),
  exportReport:(data,format,suggested)=>invoke('exportReport',data,format,suggested),
  presets:()=>invoke('presets'),savePreset:p=>invoke('savePreset',p),deletePreset:id=>invoke('deletePreset',id),
  doctor:()=>invoke('doctor'),chooseTool:tool=>invoke('chooseTool',tool),reveal:path=>invoke('reveal',path),
  history:()=>invoke('history'),restore:journal=>invoke('restore',journal),
  setDirty:dirty=>ipcRenderer.send('ki:dirty',!!dirty),
  onMenu:callback=>ipcRenderer.on('ki:menu',(_event,action)=>callback(action))
});
