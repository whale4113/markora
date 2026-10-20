import {Mark,Plot} from 'wordgard/doc';
import * as types from 'wordgard/types';

export const TableLayout=Mark.Type.define('MarkdownTableLayout',{
  target:types.Table,shape:{attribute:'data-markdown-table',value:()=>''},
});
export const TableAlignment=Mark.Type.define<string>('MarkdownTableAlignment',{target:[types.Cell,types.HeaderCell],validate:'string',shape:{attribute:'align',value:0}});
function splitLine(line){
  const eol=/\r?\n$/.exec(line)?.[0]||'',text=eol?line.slice(0,-eol.length):line;
  const prefix=/^\s*\|/.exec(text)?.[0]||'',suffix=/\|\s*$/.exec(text)?.[0]||'';
  const start=prefix.length,end=text.length-suffix.length,cells=[];let from=start,ticks=0;
  for(let at=start;at<end;at++){
    if(text[at]==='\\'){at++;continue;}
    if(text[at]==='`'){let size=1;while(text[at+size]==='`')size++;ticks=ticks===size?0:ticks||size;at+=size-1;continue;}
    if(text[at]==='|'&&!ticks){cells.push({raw:text.slice(from,at),offset:from});from=at+1;}
  }
  cells.push({raw:text.slice(from,end),offset:from});return {prefix,suffix,eol,cells};
}
export function createSourceTable(raw,sourceOffset,makeContent){
  const lines=raw.match(/[^\n]*(?:\n|$)/g).filter(Boolean);
  let tail='';while(lines.length>2&&/^\s*$/.test(lines.at(-1)))tail=lines.pop()+tail;
  const layout={alignment:lines[1]||'',rows:[],align:[],tail};
  if(lines.length<2)return null;
  const align=splitLine(lines[1]);layout.align=align.cells.map(c=>/^\s*:.*:\s*$/.test(c.raw)?'center':/:\s*$/.test(c.raw)?'right':/^\s*:/.test(c.raw)?'left':'');
  let offset=0;const rows=[];
  for(let i=0;i<lines.length;i++){
    if(i===1){offset+=lines[i].length;continue;}
    const parsed=splitLine(lines[i]);
    layout.rows.push({prefix:parsed.prefix,suffix:parsed.suffix,eol:parsed.eol});
    rows.push(types.TableRow.create(parsed.cells.map((cell,c)=>{
      let tag=i===0?types.HeaderCell:types.Cell;
      if(layout.align[c])tag=tag.withMarks([TableAlignment.of(layout.align[c])]);
      return tag.create(makeContent(cell.raw,'cell',sourceOffset+offset+cell.offset));
    })));offset+=lines[i].length;
  }
  return types.Table.withMarks([TableLayout.of(layout)]).create(rows);
}
export function tableLayout(node){return node.marks.find(mark=>mark.type===TableLayout)?.value;}
export function sourceTable(node){
  const layout=tableLayout(node)||{rows:[],alignment:'',align:[]};
  let text='';
  for(let r=0;r<node.content.length;r++){
    const row=node.content[r],format=layout.rows[r]||{prefix:'|',suffix:'|',eol:'\n'};
    text+=format.prefix+row.content.map(cell=>cell.textContent()).join('|')+format.suffix+(format.eol||(r<node.content.length-1?'\n':''));
    if(r===0){
      const oldCount=splitLine(layout.alignment||'').cells.length;
      text+=layout.alignment&&oldCount===row.content.length?layout.alignment:'| '+row.content.map((_,c)=>layout.align[c]==='right'?'---:':layout.align[c]==='center'?':---:':layout.align[c]==='left'?':---':'---').join(' | ')+' |\n';
    }
  }
  return text+(layout.tail||'');
}
export function tableSpans(node,pos,source){
  const layout=tableLayout(node)||{rows:[],alignment:''},spans=[];
  let model=pos+1,offset=source;
  for(let r=0;r<node.content.length;r++){
    const row=node.content[r],format=layout.rows[r]||{prefix:'|',suffix:'|',eol:'\n'};
    offset+=format.prefix.length;let cellPos=model+1;
    for(let c=0;c<row.content.length;c++){
      const cell=row.content[c],raw=cell.textContent();spans.push({node:cell,pos:cellPos,source:offset,raw,kind:'cell'});
      offset+=raw.length+(c<row.content.length-1?1:0);cellPos+=cell.length;
    }
    offset+=format.suffix.length+format.eol.length;
    if(r===0){const header=sourceTable(node).split('\n')[1]||'';offset+=header.length+1;}
    model+=row.length;
  }
  return spans;
}
