// A self-contained, intentionally read-only interface demonstration.
import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const strip=source=>source.replace(/^import .*?;\s*$/gm,'').replace(/^export /gm,'').replace(/^\/\/# sourceMappingURL=.*$/gm,'').replace(/<\/script/gi,'<\\/script');
let html=read('src/renderer/index.html');
html=html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; media-src data:; font-src data:; connect-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">');
html=html.replace('<link rel="stylesheet" href="./app.css">',()=>'<style>'+read('src/renderer/app.css')+'</style>');
for(const file of ['ArrayDisplay-Regular.woff2','ArrayDisplay-Bold.woff2','ArrayText-Regular.woff2','ArrayText-Medium.woff2'])html=html.replaceAll('../assets/fonts/'+file,'data:font/woff2;base64,'+fs.readFileSync('assets/fonts/'+file).toString('base64'));
let code=['model','analysis','icons','preview-bridge','app'].map(name=>{const code=strip(read('dist/renderer/'+name+'.js'));return name==='preview-bridge'?'(()=>{'+code+'})();':code;}).join('\n');
for(const [file,mime]of [['ki-wordmark.png','image/png'],['ki-icon.png','image/png'],['ki-banner.png','image/png'],['metadata-mark.svg','image/svg+xml'],['array/still-ribbon.webp','image/webp']]){
 const data='data:'+mime+';base64,'+fs.readFileSync('assets/'+file).toString('base64');
 html=html.replaceAll('../assets/'+file,data);code=code.replaceAll('../assets/'+file,data);
}
html=html.replace('<script type="module" src="./app.js"></script>',()=>'<script type="module">'+code+'</script>');
fs.writeFileSync('KI-Metadata-Workbench-Preview.html',html);
console.log('Built read-only interface preview. Desktop code never imports its synthetic bridge.');
