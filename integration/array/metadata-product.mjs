// Product identity for Array's source-defined native adapter. No catalog-supplied executable paths.
export const METADATA_WINDOWS_PRODUCT=Object.freeze({
  id:'metadata',name:'METADATA',nativeId:'industries.kuykendall.metadata',
  win32:{
    kinds:['nsis'],displayName:'KI Metadata Workbench',displayNameOperator:'-ceq',
    productName:'KI Metadata Workbench',executable:'KI Metadata Workbench.exe',pinExecutableName:true,
    processes:[
      {name:'KI Metadata Workbench'},
      {name:'ki-meta',relative:['resources','bin','ki-meta.exe']},
      {name:'ffmpeg',relative:['resources','bin','ffmpeg.exe']},
      {name:'ffprobe',relative:['resources','bin','ffprobe.exe']},
      {name:'exiftool',relative:['resources','bin','exiftool','exiftool.exe']},
    ],installRecord:'uninstall-entry',
  },
  // This release only registers the adapter on Windows.
  darwin:{kinds:[]},linux:{kinds:[]},
});
export function registerMetadataAdapter(adapters,system,createNativeAdapter){
  return system.platform==='win32'?{...adapters,metadata:createNativeAdapter(METADATA_WINDOWS_PRODUCT,system)}:adapters;
}
