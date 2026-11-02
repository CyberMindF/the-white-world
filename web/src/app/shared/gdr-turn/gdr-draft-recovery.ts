import {GdrBlockRow} from '../gdr-blocks/gdr-block.types';
import {serializeGdrBlocks} from '../gdr-blocks/gdr-markdown.serializer';
import {parseNarrative} from './gdr-turn.parser';

/** Recupera solo modifiche delimitate da blocchi invariati, senza pubblicare la copia intera.
 * I PNG sono esclusi: le foto della vecchia copia possono essere avatar derivati. */
export function recoverStoryDraft(blocks:GdrBlockRow[],draft:string):{id:string;source:string}[] {
 const parsed=parseNarrative(draft);
 if(parsed.errors.length || draft.length>100000) return [];
 const original=blocks.slice().sort((a,b)=>a.position-b.position);
 const chunks=parsed.sections.flatMap(section=>section.kind==='document'?section.ranges.map(range=>({start:range.start,end:range.end})): [{start:section.start,end:section.end}]);
 if(original.length>500 || chunks.length>500) return [];
 const normalize=(source:string)=>source.replace(/\r\n?/g,'\n').trim();
 const left=original.map(block=>normalize(serializeGdrBlocks([block])));
 const right=chunks.map(chunk=>normalize(draft.slice(chunk.start,chunk.end)));
 const lengths=Array.from({length:left.length+1},()=>new Uint16Array(right.length+1));
 for(let i=left.length-1;i>=0;i--)for(let j=right.length-1;j>=0;j--)lengths[i][j]=left[i]===right[j]?lengths[i+1][j+1]+1:Math.max(lengths[i+1][j],lengths[i][j+1]);
 const matches:[number,number][]=[[-1,-1]];
 let i=0,j=0;
 while(i<left.length && j<right.length){
  if(left[i]===right[j]){matches.push([i++,j++]);}
  else if(lengths[i+1][j]>=lengths[i][j+1])i++;
  else j++;
 }
 matches.push([left.length,right.length]);
 const recovered:{id:string;source:string}[]=[];
 for(let m=1;m<matches.length;m++){
  const [beforeLeft,beforeRight]=matches[m-1], [afterLeft,afterRight]=matches[m];
  if(afterLeft-beforeLeft!==2 || afterRight-beforeRight<2)continue;
  const index=beforeLeft+1, block=original[index];
  if(block.type==='npc_grid' || left.filter(text=>text===left[index]).length!==1)continue;
  const source=draft.slice(chunks[beforeRight+1].start,chunks[afterRight-1].end);
  if(normalize(source)!==left[index] && source.length<=18000) recovered.push({id:block.id,source});
 }
 return recovered;
}
