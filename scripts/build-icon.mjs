// Optional asset rebuild. Uses the local code-native SVG; no generated imagery or remote service.
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const mark=await fs.readFile('assets/metadata-mark.svg','utf8');
const paths=mark.replace(/<svg[^>]*>/,'').replace('</svg>','');
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><path fill="#0b0b0f" stroke="#6b6262" d="M18 1h131l10 10v131l-17 17H11L1 149V18Z"/><g transform="translate(32 32)">'+paths+'</g></svg>';
await fs.writeFile('assets/metadata-icon.svg',svg);
const browser=await chromium.launch({headless:true,...(process.env.PW_CHROMIUM_PATH?{executablePath:process.env.PW_CHROMIUM_PATH}:{})});
try {
  const page=await browser.newPage();
  const images=await page.evaluate(async svg=>{
    const source=new Image();source.src='data:image/svg+xml;base64,'+btoa(svg);await source.decode();const images=[];
    for(const size of [16,24,32,48,64,128,256,512]){const canvas=document.createElement('canvas');canvas.width=canvas.height=size;canvas.getContext('2d').drawImage(source,0,0,size,size);images.push({size,data:canvas.toDataURL('image/png').split(',')[1]});}return images;
  },svg);
  await fs.writeFile('assets/metadata-icon.png',Buffer.from(images.find(i=>i.size===512).data,'base64'));
  const icons=images.filter(i=>i.size<=256).map(i=>({...i,bytes:Buffer.from(i.data,'base64')})),header=Buffer.alloc(6+16*icons.length);header.writeUInt16LE(1,2);header.writeUInt16LE(icons.length,4);let offset=header.length;
  icons.forEach((i,n)=>{const pos=6+16*n;header[pos]=header[pos+1]=i.size===256?0:i.size;header.writeUInt16LE(1,pos+4);header.writeUInt16LE(32,pos+6);header.writeUInt32LE(i.bytes.length,pos+8);header.writeUInt32LE(offset,pos+12);offset+=i.bytes.length;});
  await fs.writeFile('assets/metadata-icon.ico',Buffer.concat([header,...icons.map(i=>i.bytes)]));
  console.log('METADATA application icon rebuilt at eight sizes from the bundled SVG.');
}finally{await browser.close();}
