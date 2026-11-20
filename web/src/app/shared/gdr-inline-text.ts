import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

const escapeText = (value: string) => value.replace(/[&<>]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[character]!));
const formats = [
  {marker:'***',open:'<strong><em>',close:'</em></strong>'},
  {marker:'**',open:'<strong>',close:'</strong>'},
  {marker:'__',open:'<u>',close:'</u>'},
  {marker:'*',open:'<em>',close:'</em>'},
];

/** Solo formattazione esplicita e link interni; l’HTML scritto dall’utente resta testo. */
export function formatGdrInlineText(source: string): string {
  let budget = Math.max(1024,source.length * 8);
  const parse = (start: number, closing = '', depth = 0): {html:string;end:number;closed:boolean} => {
    let html = '', index = start;
    while (index < source.length) {
      if (--budget < 0) return {html:html+escapeText(source.slice(index)),end:source.length,closed:false};
      if (closing && index > start && source.startsWith(closing,index) && !/\s/.test(source[index-1])) return {html,end:index+closing.length,closed:true};
      const link = source[index] === '[' ? /^\[([^\[\]\n]{1,80})\]\((\/[a-z0-9\-/]*)\)/i.exec(source.slice(index)) : null;
      if (link && !link[2].startsWith('//')) {
        html += `<a class="editorial-inline-link" href="${link[2]}">${formatGdrInlineText(link[1])}</a>`;
        index += link[0].length;
        continue;
      }
      const format = depth < 20 ? formats.find(format => source.startsWith(format.marker,index)) : undefined;
      if (format && source[index+format.marker.length] && !/\s/.test(source[index+format.marker.length])) {
        const inside = parse(index+format.marker.length,format.marker,depth+1);
        if (inside.closed) { html += format.open+inside.html+format.close;index=inside.end;continue; }
      }
      html += escapeText(source[index++]);
    }
    return {html,end:index,closed:false};
  };
  return parse(0).html.replace(/\n/g,'<br>');
}

export function renderGdrInline(sanitizer: DomSanitizer, source: string): SafeHtml {
  return sanitizer.bypassSecurityTrustHtml(formatGdrInlineText(source));
}
