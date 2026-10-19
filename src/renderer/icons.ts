const paths:Record<string,string>={
  compare:'M3 4h7v16H3zM14 4h7v16h-7zM7 8h0M17 8h0M7 12h0M17 12h0',grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',refresh:'M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3',help:'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  add:'M12 5v14M5 12h14',folder:'M3 7V5h6l2 2h10v13H3z',file:'M14 2H5v20h14V7zM14 2v6h5',
  audio:'M9 18V5l11-2v13M9 8l11-2M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM17 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  image:'M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5M16 7h.01',video:'M3 5h13v14H3zM16 10l5-3v10l-5-3',
  search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',shield:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6zM8 12l3 3 5-6',
  history:'M3 12a9 9 0 1 0 3-7M3 3v5h5M12 7v5l3 2',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  save:'M19 21H5a2 2 0 0 1-2-2V3h14l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8',
  arrow:'M5 12h14M13 6l6 6-6 6',close:'M6 6l12 12M6 18 18 6',check:'M5 12l4 4L19 6',
  undo:'M3 8h10a7 7 0 0 1 0 14M3 8l5-5M3 8l5 5',download:'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5',
  code:'M8 5l-6 7 6 7M16 5l6 7-6 7M14 2l-4 20',layers:'M12 2 2 7l10 5 10-5zM2 12l10 5 10-5M2 17l10 5 10-5',
  lock:'M6 10V7a6 6 0 0 1 12 0v3M4 10h16v12H4z',warning:'M12 2 1 21h22zM12 8v5M12 17h.01',
  dots:'M5 12h.01M12 12h.01M19 12h.01',trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  copy:'M9 9h12v12H9zM5 15H3V3h12v2',spark:'M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z'
};
export function icon(name:string,size=18):SVGSVGElement {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width',String(size));svg.setAttribute('height',String(size));
  svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]??paths.file!);svg.append(path);return svg;
}
