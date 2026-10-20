import {tokenizeInline,tokenizeBlocks,toHTML} from './markdown';
import {normalizeLines} from './source-offsets';
import {StringStream} from '@codemirror/streamparser';
import {JavaScript,TypeScript,Python,JSON as JSONLanguage,CSS,HTML,Shell,YAML,LaTeX} from 'wordgard/highlight-code';
const codeLanguages=[JavaScript,TypeScript,Python,JSONLanguage,CSS,HTML,Shell,YAML,LaTeX];
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// The source string is authoritative. These ranges only describe its view.
// Positions are UTF-16 source offsets, matching Wordgard and browser selections.
const cache=new Map();
export function analyzeBlock(raw: string,kind: string,links = undefined) {
  const key=kind+'\0'+raw+'\0'+JSON.stringify(links||{});if(cache.has(key))return cache.get(key);
  const original=raw,{text,offsets}=normalizeLines(raw);raw=text;
  const ranges=[],previews=[],prefixes=[];
  const add=(from,to,tag='span',className='',extra={})=>{if(to>from)ranges.push({from,to,tag,className,...extra});};
  const meta=(from,to,ownerFrom=from,ownerTo=to,block=false)=>add(from,to,'span','md-meta',{meta:true,ownerFrom,ownerTo,block});
  function inline(text,base=0){
    let offset=0;
    for(const token of tokenizeInline(text,links)){
      const start=base+offset,end=start+token.raw.length;offset+=token.raw.length;
      const paired={strong:'strong',em:'em',del:'del',highlight:'mark',codespan:'code',superscript:'sup',subscript:'sub'};
      if(paired[token.type]){
        let width=token.type==='strong'||token.type==='del'||token.type==='highlight'?2:1;
        if(token.type==='codespan')width=/^`+/.exec(token.raw)?.[0].length||1;
        add(start,end,'span','md-pair',{inline:token.type,ownerFrom:start,ownerTo:end,rank:5});
        meta(start,start+width,start,end);meta(end-width,end,start,end);
        add(start+width,end-width,paired[token.type]);
        if(token.type!=='codespan')inline(token.raw.slice(width,-width),start+width);
      }else if(token.type==='link'||token.type==='image'){
        const open=token.type==='image'?2:1;
        if(token.type==='link'&&token.raw[0]!=='['){
          add(start,end,'span','md-link-label');
          if(token.raw[0]==='<'){meta(start,start+1,start,end);meta(end-1,end,start,end);}continue;
        }
        let close=-1,depth=1;
        for(let at=open;at<token.raw.length;at++){
          if(token.raw[at]==='\\'){at++;continue;}
          if(token.raw[at]==='[')depth++;
          if(token.raw[at]===']'&&--depth===0){close=at;break;}
        }
        if(close<0)continue;
        add(start,end,'span','md-pair',{inline:token.type,ownerFrom:start,ownerTo:end,rank:5});
        meta(start,start+open,start,end);meta(start+close,end,start,end);
        if(token.type==='link'){
          add(start+open,start+close,'span','md-link-label');inline(token.raw.slice(open,close),start+open);
        }else{
          meta(start+open,start+close,start,end);
          previews.push({from:start,to:end,kind:'image',html:`<img src="${escape(token.href)}" alt="${escape(token.text||'')}">`,inline:true});
        }
      }else if(token.type==='inlineMath'){
        meta(start,end,start,end);
        previews.push({from:start,to:end,kind:'math-inline',source:token.text,inline:true});
      }else if(token.type==='footnoteReference'){
        add(start,end,'span','md-pair',{inline:'footnote',ownerFrom:start,ownerTo:end});
        meta(start,start+2,start,end);meta(end-1,end,start,end);add(start+2,end-1,'sup','md-footnote');
      }else if(token.type==='escape'){
        meta(start,start+1,start,end);
      }else if(token.type==='text'){
        for(const entity of token.raw.matchAll(/&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/gi)){
          const from=start+entity.index,to=from+entity[0].length;meta(from,to,from,to);
          previews.push({from,to,kind:'entity',source:entity[0],inline:true});
        }
      }else if(token.type==='html'){
        // Known inline HTML remains source text with the same focus behavior.
        const match=/^<(u|sub|sup)>$/.exec(token.raw);
        if(match){
          const closing=`</${match[1]}>`,tail=text.indexOf(closing,offset);
          if(tail>=0){meta(start,end,start,base+tail+closing.length);meta(base+tail,base+tail+closing.length,start,base+tail+closing.length);add(end,base+tail,match[1]);}
        }
      }else if('tokens' in token && token.tokens)inline(token.raw,start);
    }
  }
  const trimmed=raw.replace(/\n+$/,'');
  const trailing=trimmed.length;
  if(trailing<raw.length)meta(trailing,raw.length,0,raw.length,true);
  let tag='p',className='md-paragraph';
  if(kind==='heading'){
    const atx=/^( {0,3}#{1,6})[ \t]+/.exec(raw),setext=/\n {0,3}(=+|-+)[ \t]*(?:\n|$)/.exec(raw);
    const level=atx?atx[1].trim().length:setext?.[1][0]==='='?1:2;
    tag='h'+level;className='md-heading';
    if(atx){
      meta(0,atx[0].length,0,raw.length,true);prefixes.push([0,atx[0].length]);
      const closing=/[ \t]+#+[ \t]*$/.exec(trimmed),end=closing?closing.index:trimmed.length;
      if(closing)meta(closing.index,trimmed.length,0,raw.length,true);
      inline(trimmed.slice(atx[0].length,end),atx[0].length);
    }
    else if(setext){inline(raw.slice(0,setext.index));meta(setext.index,trailing,0,raw.length,true);}
  }else if(kind==='code'||kind==='displayMath'||kind==='metadata'||kind==='html'){
    tag='pre';className='md-special';
    const lines=raw.split('\n');
    const language=kind==='displayMath'?'math':kind==='html'?'html-block':kind==='metadata'?'metadata':/^ {0,3}(?:`{3,}|~{3,})(.*)$/.exec(lines[0])?.[1].trim()||'';
    if(kind!=='html'&&kind!=='metadata'){
      meta(0,lines[0].length+1,0,raw.length,true);
      const closing=/\n {0,3}(?:`{3,}|~{3,}|\$\$)[ \t]*(?:\n*)$/.exec(raw);
      if(closing)meta(closing.index,raw.length,0,raw.length,true);
    }
    if(['math','latex','mermaid','html-block'].includes(language)){
      meta(0,raw.length,0,raw.length,true);
      previews.push({from:0,to:raw.length,kind:language,html:toHTML(raw),block:true});
    }else if(kind==='code'){
      const lang=codeLanguages.find(lang=>lang.alias.includes(language.toLowerCase()));
      if(lang){
        const parser=lang.parser,state=parser.startState?parser.startState(2):{};let at=lines[0].length+1;
        for(let lineNo=1;lineNo<lines.length;lineNo++){
          const line=lines[lineNo];if(/^ {0,3}(?:`{3,}|~{3,})[ \t]*$/.test(line))break;
          const stream=new StringStream(line,4,2);
          if(!line)parser.blankLine?.(state,2);
          while(!stream.eol()){
            stream.start=stream.pos;const token=parser.token(stream,state);if(stream.pos===stream.start)stream.next();
            if(token)add(at+stream.start,at+stream.pos,'span','md-code-token-'+token.split(/[ .]/)[0]);
          }at+=line.length+1;
        }
      }
    }
  }else if(kind==='hr'){
    className='md-rule';meta(0,raw.length,0,raw.length,true);previews.push({from:0,to:raw.length,kind:'rule',html:'<hr>',block:true});
  }else if(kind==='tableOfContents'){
    className='md-toc';meta(0,raw.length,0,raw.length,true);previews.push({from:0,to:raw.length,kind:'toc',block:true});
  }else if(kind==='table'){
    tag='div';className='md-table-source';
    // Table cells have actual editable source; pipe/alignment rows collapse
    // when the block is inactive and a read-only model-derived table is shown.
    meta(0,raw.length,0,raw.length,true);previews.push({from:0,to:raw.length,kind:'table',html:toHTML(raw),block:true});
  }else if(kind==='definition'){
    tag='div';className='md-definition';let offset=0;
    for(const line of trimmed.split('\n')){
      const definition=/^(\[[^\]]+\])([ \t]*:[ \t]*)/.exec(line);
      if(definition){
        meta(offset,offset+(line[1]==='^'?2:1),offset,offset+line.length,true);
        meta(offset+definition[1].length-1,offset+definition[0].length,offset,offset+line.length,true);
        inline(line.slice(definition[0].length),offset+definition[0].length);
      }else inline(line,offset);
      offset+=line.length+1;
    }
  }else if(kind==='space'){
    tag='div';className='md-space';meta(0,raw.length,0,raw.length,true);
  }else{
    if(kind==='blockquote'){tag='blockquote';className='md-quote';}
    if(kind==='list'){tag='div';className='md-list';}
    let offset=0;
    for(const line of trimmed.split('\n')){
      const prefix=/^(?: {0,3}>[ \t]?)+(?:[ \t]*)|^(\s*)(?:[-+*]|\d+[.)])[ \t]+/.exec(line);
      let from=offset;
      if(prefix){
        meta(offset,offset+prefix[0].length,offset,offset+line.length,true);
        prefixes.push([offset,offset+prefix[0].length]);
        if(kind==='list')previews.push({from:offset,to:offset+prefix[0].length,kind:'bullet',source:prefix[0],inline:true});
        from+=prefix[0].length;
      }
      const task=/^\[([ xX])\][ \t]+/.exec(line.slice(from-offset));
      if(task){
        meta(from,from+task[0].length,offset,offset+line.length,true);
        previews.push({from,to:from+task[0].length,kind:'task',checked:task[1].toLowerCase()==='x',inline:true});from+=task[0].length;
      }
      inline(raw.slice(from,offset+line.length),from);offset+=line.length+1;
    }
  }
  for(const range of ranges){range.from=offsets[range.from];range.to=offsets[range.to];if(range.ownerFrom!==undefined)range.ownerFrom=offsets[range.ownerFrom];if(range.ownerTo!==undefined)range.ownerTo=offsets[range.ownerTo];}
  for(const preview of previews){preview.from=offsets[preview.from];preview.to=offsets[preview.to];}
  const result={raw:original,kind,ranges,previews,tag,className,prefixes};
  if(cache.size>1500)cache.clear();cache.set(key,result);return result;
}

export function parseSource(source) {
  return tokenizeBlocks(source).map(block=>({...block,analysis:analyzeBlock(block.raw,block.kind)}));
}
