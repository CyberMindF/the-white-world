import {GdrNpcEntry} from '../gdr-blocks/gdr-block.types';
import {serializeGdrBlocks} from '../gdr-blocks/gdr-markdown.serializer';
import {parseNarrative,safeNarrativeImage} from './gdr-turn.parser';
import {findNarrativeCharacter,NarrativeCharacter} from './gdr-writing';

export interface CharacterDraft {
  kind:'dialogo'|'npc'; name:string; characterId?:string; body:string;
  portrait:string; entry?:GdrNpcEntry; layout?:'full';
}
export function readCharacterDraft(source:string):CharacterDraft|null {
  const parsed=parseNarrative(source);
  if(parsed.errors.length||parsed.sections.length!==1)return null;
  const section=parsed.sections[0];
  if(section.kind==='dialogo')return {kind:'dialogo',name:section.speaker,characterId:section.characterId,portrait:section.portrait,body:section.text};
  if(section.kind!=='document'||section.blocks.length!==1||section.blocks[0].type!=='npc_grid')return null;
  const data=section.blocks[0].data as {entries:GdrNpcEntry[];layout?:'full'};
  if(data.entries.length!==1)return null;
  const entry=data.entries[0];
  return {kind:'npc',name:entry.name,characterId:entry.characterId,body:entry.description,portrait:'',entry,layout:data.layout};
}
export function writeCharacterDraft(draft:CharacterDraft,roster:NarrativeCharacter[]):string {
  const character=findNarrativeCharacter(roster,draft.characterId,draft.name);
  const id=character?.id??draft.characterId,name=(character?.name??draft.name).replace(/[|\r\n]/g,' ').trim();
  if(draft.kind==='dialogo'){
    const portrait=id?'':safeNarrativeImage(draft.portrait);
    return `::: dialogo ${name}${portrait||id?' | '+portrait:''}${id?' | '+id:''}\n${draft.body}\n:::`;
  }
  return serializeGdrBlocks([{id:'draft',documentKey:'avventura',position:0,type:'npc_grid',data:{...(draft.layout?{layout:draft.layout}:{}),entries:[{
    image:id?'':draft.entry?.image??'',alt:name,name,description:draft.body,...(id?{characterId:id}:{}),
  }]}}]);
}
