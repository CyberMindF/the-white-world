import { describe, expect, it } from 'vitest';
import { formatGdrInlineText } from './gdr-inline-text';
import { parseGdrMarkdown } from './gdr-blocks/gdr-markdown.parser';

describe('formattazione del testo GDR', () => {
  it('combina grassetto, corsivo e sottolineato senza inserire righe o interpretare HTML libero', () => {
    expect(formatGdrInlineText('Prima **forte *e piano***, __sotto **entrambi**__.\nDopo.')).toBe('Prima <strong>forte <em>e piano</em></strong>, <u>sotto <strong>entrambi</strong></u>.<br>Dopo.');
    expect(formatGdrInlineText('***Insieme***')).toBe('<strong><em>Insieme</em></strong>');
    expect(formatGdrInlineText('2 * 3 * 4 e **incompleto')).toBe('2 * 3 * 4 e **incompleto');
    expect(formatGdrInlineText('**<img src=x onerror=alert(1)>** & __<script>x</script>__')).toBe('<strong>&lt;img src=x onerror=alert(1)&gt;</strong> &amp; <u>&lt;script&gt;x&lt;/script&gt;</u>');
  });
  it('conserva i link interni e lascia come testo URL esterni e collegamenti a script', () => {
    expect(formatGdrInlineText('[**Avventure**](/tavolo-da-gioco/gdr)')).toBe('<a class="editorial-inline-link" href="/tavolo-da-gioco/gdr"><strong>Avventure</strong></a>');
    for(const source of ['[esterno](//example.com)','[script](javascript:alert(1))','[esterno](https://example.com)']) expect(formatGdrInlineText(source)).not.toContain('<a');
  });
  it('non scambia il grassetto di un intero paragrafo per corsivo', () => {
    expect(parseGdrMarkdown('**In grassetto**').blocks[0].data).toEqual({text:'**In grassetto**'});
    expect(parseGdrMarkdown('*In corsivo*').blocks[0].data).toEqual({text:'In corsivo',emphasis:true});
  });
});
