import {Wordgard,Decoration,Widget,keyBindingHelp,menuBar} from 'wordgard/editor';
import {GardState,GardSelection,Transaction} from 'wordgard/state';
import {Plot,Leaf,Node,Elt,Mark} from 'wordgard/doc';
import * as types from 'wordgard/types';
import * as commands from 'wordgard/command';
import {blockDoc} from 'wordgard/schema';
import {history} from 'wordgard/history';
import katex from 'katex';
import DOMPurify from 'dompurify';
import {toHTML,toMarkdown,renderEnhancements,referenceLinks} from './markdown';
import {parseSource,analyzeBlock} from './live-markdown';
import {tables,addRow,addColumn,deleteRow,deleteColumn} from 'wordgard/table';
import {TableLayout,TableAlignment,createSourceTable,sourceTable,tableSpans} from './live-table';
import type {SourceSelection} from './types';
interface ViewFlags {focused: boolean; composing: boolean; dragging: boolean}
interface EngineOptions {markdown?: string; html?: string; onChange?: (html: string) => void; onSelection?: (selection: {from: number; to: number}) => void}

export const MarkdownBlock=Plot.Type.define('MarkdownBlock',{
  validate:'string',defaultParam:'paragraph',inlineContent:[Leaf.Text],group:Node.Group.Content,
  defaultBlock:true,shape:{structure:value=>{
    const [kind,tag='p']=value.split('|'),classes={heading:'heading',paragraph:'paragraph',list:'list',blockquote:'quote',space:'space',code:'special',html:'special',displayMath:'special',metadata:'special',hr:'rule',tableOfContents:'toc'};
    return Elt.mk(tag,{'data-md-kind':kind,mdtype:kind,class:'md-source-block md-'+(classes[kind]||'paragraph')},[0]);
  },atom:false},
});
const viewEffect=Transaction.Effect.define<Partial<ViewFlags>>();
const normalized=Transaction.Annotation.define<boolean>();
const Syntax=Mark.Type.define<{owners: [number, number][]}>('MarkdownSyntax',{rank:100,shape:{element:'span',attributes:()=>({class:'md-meta md-hidden'})}});
const Pair=Mark.Type.define<{kind: string; from: number; to: number}>('MarkdownPair',{rank:5,shape:{element:'span',attributes:value=>({'md-inline':value.kind,class:'md-pair'})}});
const Highlight=Mark.define('MarkdownHighlight',{shape:{element:'mark'}});
const LinkLabel=Mark.define('MarkdownLinkLabel',{shape:{element:'span',attributes:()=>({class:'md-link-label'})}});
const CodeColor=Mark.Type.define<string>('MarkdownCodeColor',{shape:{element:'span',attributes:className=>({class:className})}});
const viewFlags=GardState.Field.define({
  create:()=>({focused:false,composing:false,dragging:false}),
  update(value,tr){for(const effect of tr.effects)if(effect.is(viewEffect))value={...value,...effect.value};return value;},
});
const nodeSource=node=>node.type===types.Table.type?sourceTable(node):node.textContent();
const sourceOf=doc=>doc.content.map(nodeSource).join('');
function entries(doc){let source=0,pos=0;return doc.content.flatMap(node=>{
  const raw=nodeSource(node),entry={node,pos,source,raw,kind:node.tag.param?.split('|')[0]};
  const result=node.type===types.Table.type?tableSpans(node,pos,source):[entry];source+=raw.length;pos+=node.length;return result;
});}
function sourcePosition(doc,pos){
  for(const entry of entries(doc))if(pos<=entry.pos+entry.node.length)return entry.source+Math.max(0,Math.min(entry.raw.length,pos-entry.pos-1));
  return sourceOf(doc).length;
}
function modelPosition(doc,offset,bias=1){
  const list=entries(doc);offset=Math.max(0,Math.min(sourceOf(doc).length,offset));
  for(let i=0;i<list.length;i++){
    const e=list[i],end=e.source+e.raw.length;
    if(offset<end||(offset===end&&(bias<0||i===list.length-1)))return e.pos+1+offset-e.source;
  }
  return list.at(-1).pos+1+list.at(-1).raw.length;
}
function makeContent(raw,kind,offset,links){
    const analysis=analyzeBlock(raw,kind,links),boundaries=[...new Set([0,raw.length,...analysis.ranges.flatMap(r=>[r.from,r.to])])].sort((a,b)=>a-b),content=[];
    const styles={strong:types.Strong,em:types.Emphasis,del:types.Strikethrough,code:types.Code,mark:Highlight,sub:types.Subscript,sup:types.Superscript,u:types.Underline};
    for(let i=1;i<boundaries.length;i++){
      const from=boundaries[i-1],to=boundaries[i];let marks: Mark.Set=[];
      const covering=analysis.ranges.filter(r=>r.from<=from&&r.to>=to);
      for(const range of covering){
        if(styles[range.tag])marks=styles[range.tag].addToSet(marks);
        if(range.inline)marks=Pair.of({kind:range.inline,from:offset+range.ownerFrom,to:offset+range.ownerTo}).addToSet(marks);
      }
      const metadata=covering.filter(r=>r.meta);
      if(metadata.length){
        const ancestors=analysis.ranges.filter(r=>r.inline&&r.from<=from&&r.to>=to);
        marks=Syntax.of({owners:[...metadata,...ancestors].map(r=>[offset+(r.ownerFrom??r.from),offset+(r.ownerTo??r.to)])}).addToSet(marks);
      }
      const label=covering.find(r=>r.className==='md-link-label');
      if(label)marks=LinkLabel.addToSet(marks);
      const color=covering.find(r=>r.className.startsWith('md-code-token-'));if(color)marks=CodeColor.of(color.className).addToSet(marks);
      content.push(Leaf.text(raw.slice(from,to),marks));
    }
    return content;
}
function nodesFor(source){
  let offset=0;const links=referenceLinks(source);
  const blocks=parseSource(source);if(/(?:\r?\n){2}$/.test(source))blocks.push({raw:'',kind:'paragraph'});
  return blocks.map(({raw,kind})=>{
    const node=kind==='table'?createSourceTable(raw,offset,(raw,kind,offset)=>makeContent(raw,kind,offset,links)):MarkdownBlock.of(kind+'|'+analyzeBlock(raw,kind,links).tag).create(makeContent(raw,kind,offset,links));
    offset+=raw.length;return node;
  });
}
function docFor(schema,source){return schema.doc(nodesFor(source));}
function difference(doc,next){
  let prefix=0,suffix=0;
  while(prefix<doc.content.length&&prefix<next.content.length&&doc.content[prefix].eq(next.content[prefix]))prefix++;
  while(suffix<doc.content.length-prefix&&suffix<next.content.length-prefix&&doc.content.at(-1-suffix).eq(next.content.at(-1-suffix)))suffix++;
  if(prefix===doc.content.length&&prefix===next.content.length)return null;
  const from=doc.content.slice(0,prefix).reduce((sum,n)=>sum+n.length,0);
  const to=doc.length-doc.content.slice(doc.content.length-suffix).reduce((sum,n)=>sum+n.length,0);
  return {from,to,insert:next.content.slice(prefix,next.content.length-suffix)};
}
function isActive(range,entry,state){
  if(!state.field(viewFlags).focused||state.readOnly)return false;
  const {anchor,head}=state.selection,from=entry.pos+1+range.ownerFrom,to=entry.pos+1+range.ownerTo;
  return [anchor,head].some(pos=>pos>=from&&pos<=to);
}
function blockActive(entry,state){return isActive({ownerFrom:0,ownerTo:entry.raw.length},entry,state);}
function activeSource(state){
  const flags=state.field(viewFlags),anchor=sourcePosition(state.doc,state.selection.anchor),head=sourcePosition(state.doc,state.selection.head);
  return {enabled:flags.focused&&!state.readOnly,anchor,head};
}
const syntaxMode=GardState.Compartment.define();
const syntaxShapes=Transaction.extender.of(tr=>{
  let flags=tr.startState.field(viewFlags);
  for(const effect of tr.effects)if(effect.is(viewEffect))flags={...flags,...effect.value};
  if(flags.composing||flags.dragging)return null;
  const enabled=flags.focused&&!tr.startState.readOnly,anchor=sourcePosition(tr.newDoc,tr.newSelection.anchor),head=sourcePosition(tr.newDoc,tr.newSelection.head);
  return {effects:syntaxMode.reconfigure([
    Decoration.Mark.shape(Syntax,{element:'span',attributes:(value: {owners: [number, number][]})=>({class:'md-meta '+(enabled&&value.owners.some(([from,to])=>[anchor,head].some(p=>p>=from&&p<=to))?'md-revealed':'md-hidden')})}),
    Decoration.Mark.shape(Pair,{element:'span',attributes:(value: {kind: string; from: number; to: number})=>({'md-inline':value.kind,class:'md-pair'+(enabled&&[anchor,head].some(p=>p>=value.from&&p<=value.to)?' md-expand':'')})}),
  ])};
});

const previewWidget=Widget.define<{preview: any; pos: number; source: string; toc: string}>({
  render(value,view){
    const {preview,pos,source}=value;
    const element=document.createElement(preview.inline?'span':'div');element.className='md-rendered md-rendered-'+preview.kind;
    element.setAttribute('data-md-preview',preview.kind);
    if(preview.kind==='task'){
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=preview.checked;checkbox.setAttribute('aria-label','切换任务完成状态');
      checkbox.addEventListener('mousedown',event=>event.preventDefault());
      checkbox.addEventListener('click',event=>{
        event.preventDefault();if(view.state.readOnly)return;
        const at=sourcePosition(view.state.doc,pos)+preview.from+1;
        (view as Wordgard & {liveMarkdown: ReturnType<typeof createLiveEngine>}).liveMarkdown.edit(at,at+1,preview.checked?' ':'x','input.task');
      });element.append(checkbox);
    }else if(preview.kind==='bullet'){
      element.textContent=/\d/.test(preview.source)?preview.source.trim():'•';element.style.marginLeft=((/^\s*/.exec(preview.source)?.[0].length||0)*.6)+'em';
    }
    else if(preview.kind==='entity'){const decoder=document.createElement('textarea');decoder.innerHTML=preview.source;element.textContent=decoder.value;}
    else if(preview.kind==='math-inline')katex.render(preview.source,element,{throwOnError:false,trust:false});
    else if(preview.kind==='toc'){
      const nav=document.createElement('nav');nav.className='document-toc';nav.setAttribute('aria-label','目录');
      for(const e of entries(view.state.doc))if(e.kind==='heading'){
        const a=document.createElement('button');a.type='button';a.textContent=e.raw.replace(/^#{1,6}\s+|\n[=-]+\s*$|\n+$/g,'');
        a.onclick=()=>{view.dispatch({selection:{anchor:e.pos+1+(e.raw.match(/^#{1,6}\s+/)?.[0].length||0)},scrollIntoView:true});view.focus();};nav.append(a);
      }element.append(nav);
    }else{
      element.innerHTML=DOMPurify.sanitize(preview.html||'',{USE_PROFILES:{html:true}});
      renderEnhancements(element).catch(error=>{element.textContent=error.message;});
    }
    if(!['task','bullet','toc'].includes(preview.kind))element.addEventListener('mousedown',event=>{
      event.preventDefault();if(view.state.readOnly)return;
      let relative=preview.from;
      if(preview.kind==='image')relative+=2;
      if(preview.kind==='math-inline')relative++;
      if(preview.block&&['math','latex','mermaid'].includes(preview.kind))relative=source.indexOf('\n')+1;
      if(preview.kind==='table'){
        const cell=(event.target as Element).closest('td,th');if(cell){const at=source.indexOf(cell.textContent);if(at>=0)relative=at;}
      }
      view.focus();view.dispatch({selection:{anchor:pos+1+relative},effects:viewEffect.of({focused:true}),scrollIntoView:true});
    });
    return element;
  },
  eq:(a,b)=>a.pos===b.pos&&a.source===b.source&&JSON.stringify(a.preview)===JSON.stringify(b.preview)&&a.toc===b.toc,
  propagateEvent:false,
});
function viewDecorations(state){
  const ranges=[],points=[],links=referenceLinks(sourceOf(state.doc));
  for(const e of entries(state.doc)){
    const analysis=analyzeBlock(e.raw,e.kind,links),active=blockActive(e,state);
    for(const preview of analysis.previews){
      const expanded=isActive({ownerFrom:preview.from,ownerTo:preview.to},e,state);
      if(expanded&&preview.kind!=='task'&&preview.kind!=='bullet')continue;
      if(preview.kind==='bullet'&&active)continue;
      points.push({pos:e.pos+1+preview.from,value:Decoration.Point.widget(previewWidget.of({preview,pos:e.pos,source:e.raw,toc:preview.kind==='toc'?sourceOf(state.doc):''}),{side:-1})});
    }
  }
  ranges.sort((a,b)=>a.from-b.from||b.to-a.to);points.sort((a,b)=>a.pos-b.pos||a.value.side-b.value.side);
  return {ranges:Decoration.Range.set(add=>{for(const r of ranges)add(r.value,r.from,r.to);}),points:Decoration.Point.set(add=>{for(const p of points)add(p.value,p.pos);})};
}
// Freeze decoration replacement while the browser owns an IME composition or
// a drag selection. Map old ranges through text changes instead of rebuilding DOM.
const decorations=GardState.Field.define({
  create:state=>viewDecorations(state),
  update(value,tr){
    const flags=tr.state.field(viewFlags);
    if(flags.composing||flags.dragging)return {ranges:value.ranges.map(tr.changes),points:value.points.map(tr.changes)};
    return viewDecorations(tr.state);
  },
});

export function createLiveEngine(host: HTMLElement,{markdown,html='<p></p>',onChange=()=>{},onSelection=()=>{}}: EngineOptions={}){
  let wg,visible=true,readonly=false,disposed=false,composing=false,activeDocument;
  const sessions=new Map(),readMode=GardState.Compartment.define();
  let currentSource=markdown??toMarkdown(html);
  function dispatchFlags(flags,view=wg){if(view===wg&&!disposed)view.dispatch({effects:viewEffect.of(flags),annotations:Transaction.addToHistory.of(false)});}
  const normalize=Transaction.appender.of((trs,state)=>{
    if(composing||trs.some(tr=>tr.annotation(normalized)))return null;
    if(!trs.some(tr=>tr.docChanged||tr.effects.some(e=>e.is(viewEffect)&&e.value.composing===false)))return null;
    const next=docFor(state.schema,sourceOf(state.doc)),changes=difference(state.doc,next);if(!changes)return null;
    const anchor=sourcePosition(state.doc,state.selection.anchor),head=sourcePosition(state.doc,state.selection.head);
    return {changes,selection:{anchor:modelPosition(next,anchor),head:modelPosition(next,head)},annotations:normalized.of(true),userEvent:'input.normalize'};
  });
  function config(){return [blockDoc(),tables(),menuBar(),GardState.schemaElement.of([MarkdownBlock,TableLayout,TableAlignment,Syntax,Pair,Highlight,LinkLabel,CodeColor,types.Strong,types.Emphasis,types.Strikethrough,types.Code,types.Subscript,types.Superscript,types.Underline]),viewFlags,decorations,syntaxMode.of([]),syntaxShapes,normalize,history({minDepth:300}),keyBindingHelp(),
    Decoration.Tag.attribute(types.Cell,'class','md-cell'),Decoration.Tag.attribute(types.HeaderCell,'class','md-cell'),
    readMode.of([GardState.readOnly.of(readonly),Wordgard.editable.of(!readonly)]),
    Decoration.Range.source.of(state=>state.field(decorations).ranges),Decoration.Point.source.of(state=>state.field(decorations).points),
    Wordgard.label('Markdown 文档编辑器'),
    Wordgard.clipboardTextSerializer.of(slice=>slice.textContent({blockSeparator:''})),
    Wordgard.domEventHandler('keydown',(event,view)=>handleKey(event,view)),
    Wordgard.domEventHandler('beforeinput',event=>{
      if(readonly)return true;
      if(!composing&&!event.isComposing&&event.inputType==='insertText'&&event.data!==null){
        event.preventDefault();const s=api.getSourceSelection();edit(s.from,s.to,event.data,'input.type');return true;
      }
      return false;
    }),
    Wordgard.domEventHandler('paste',(event,view)=>{
      if(readonly)return true;
      const data=event.clipboardData;if(!data)return false;
      if(data.files.length){for(const file of data.files)if(file.type.startsWith('image/'))uploadImage(file);event.preventDefault();return true;}
      const own=data.getData('text/x-zhijian-markdown');
      const text=own||(!(event as ClipboardEvent & {shiftKey?: boolean}).shiftKey&&data.getData('text/html')?toMarkdown(data.getData('text/html')):data.getData('text/plain'));
      if(!text)return false;event.preventDefault();const s=api.getSourceSelection();edit(s.from,s.to,text,'input.paste');return true;
    }),
    ...(['copy','cut'] as const).map(type=>Wordgard.domEventHandler(type,event=>{
      if(!event.clipboardData)return false;
      const s=api.getSourceSelection(),text=api.getMarkdown().slice(s.from,s.to);if(!text)return false;
      event.preventDefault();event.clipboardData.setData('text/plain',text);event.clipboardData.setData('text/x-zhijian-markdown',text);event.clipboardData.setData('text/html',toHTML(text));
      if(type==='cut'&&!readonly)edit(s.from,s.to,'','input.cut');return true;
    })),
    Wordgard.domEventHandler('drop',event=>{
      if(!event.dataTransfer?.files.length)return false;
      const images=[...event.dataTransfer.files].filter(file=>file.type.startsWith('image/'));if(!images.length)return false;
      event.preventDefault();if(!readonly)for(const file of images)uploadImage(file);return true;
    }),
    Wordgard.domEventHandler('compositionstart',()=>{composing=true;queueMicrotask(()=>dispatchFlags({composing:true}));return false;}),
    Wordgard.domEventHandler('compositionend',()=>{setTimeout(()=>{composing=false;dispatchFlags({composing:false});},20);return false;}),
    Wordgard.domEventHandler('mousedown',(event,view)=>{if((event.target as Element).closest('.md-rendered'))return false;dispatchFlags({dragging:true},view);return false;}),
    Wordgard.mouseSelectionStyle.of((view,event)=>{
      if(event.button!==0||(event.target as Element).closest('.md-rendered'))return null;
      // Hit-test the displayed text, not Wordgard's glyph scanner: hidden
      // source leaves have zero-height rectangles and are not click targets.
      const hit=e=>{
        const doc=view.contentDOM.ownerDocument;
        const caret=doc.caretPositionFromPoint?.(e.clientX,e.clientY);
        const range=!caret&&doc.caretRangeFromPoint?.(e.clientX,e.clientY);
        const node=caret?.offsetNode||range?.startContainer;
        const offset=caret?.offset??range?.startOffset;
        return node&&view.contentDOM.contains(node)?(view as Wordgard & {docTile: {posFromDOM(node: globalThis.Node, offset: number): number}}).docTile.posFromDOM(node,offset):null;
      };
      const start=hit(event);if(start==null)return null;
      const anchor=event.shiftKey?view.state.selection.anchor:start;
      const word=pos=>{
        const source=sourcePosition(view.state.doc,pos);
        // Use source coordinates so hidden delimiters retain their positions.
        const raw=sourceOf(view.state.doc);let from=source,to=source;
        while(from>0&&/[\p{L}\p{N}_]/u.test(raw[from-1]))from--;
        while(to<raw.length&&/[\p{L}\p{N}_]/u.test(raw[to]))to++;
        return {from:modelPosition(view.state.doc,from),to:modelPosition(view.state.doc,to)};
      };
      return {update(){},get(e,extend){
        const head=hit(e)??start;
        if(event.detail===2&&!extend){const a=word(start),b=word(head);return GardSelection.range(head<start?a.to:a.from,head<start?b.from:b.to);}
        if(event.detail>=3&&!extend){const a=view.state.doc.resolve(start).parent,b=view.state.doc.resolve(head).parent;return GardSelection.range(head<start?a.end:a.start,head<start?b.start:b.end);}
        return GardSelection.range(extend?anchor:start,head);
      }};
    }),
    Wordgard.transactionListener.of((trs,view)=>{
      if(disposed||view!==wg)return;
      if(trs.some(tr=>tr.docChanged)){const source=sourceOf(view.state.doc);if(source!==currentSource){currentSource=source;onChange(toHTML(currentSource));}}
      onSelection({from:view.state.selection.from,to:view.state.selection.to});
    }),
  ];}
  function mount(source){
    if(wg)wg.dom.remove();
    wg=Wordgard.create({doc:schema=>docFor(schema,source),config:config()});wg.liveMarkdown=api;
    wg.dom.classList.add('demo-wordgard','live-markdown');
    const view=wg;
    view.contentDOM.addEventListener('focus',()=>queueMicrotask(()=>dispatchFlags({focused:true},view)));
    view.contentDOM.addEventListener('blur',()=>queueMicrotask(()=>dispatchFlags({focused:false,dragging:false},view)));
    if(visible)host.append(wg.dom);
    currentSource=source;
  }
  function commit(source,selection,recordHistory=true,userEvent='input.source'){
    if(readonly)return false;
    const next=docFor(wg.state.schema,source),changes=difference(wg.state.doc,next);
    if(!changes){if(selection)api.selectSource(selection.anchor,selection.head);return true;}
    const s=selection||api.getSourceSelection();
    wg.dispatch({changes,selection:{anchor:modelPosition(next,s.anchor??s.from),head:modelPosition(next,s.head??s.to)},
      annotations:[normalized.of(true),...(recordHistory?(userEvent==='input.type'?[]:[history.isolate.of(true)]):[Transaction.addToHistory.of(false)])],scrollIntoView:true,userEvent});
    if(visible&&!composing)wg.flush();return true;
  }
  function edit(from: number,to: number,text: string,userEvent='input.command',selection?: SourceSelection){
    if(readonly)return false;
    const source=api.getMarkdown();
    return commit(source.slice(0,from)+text+source.slice(to),selection||{anchor:from+text.length,head:from+text.length},true,userEvent);
  }
  function wrap(before,after=before){
    const s=api.getSourceSelection(),source=api.getMarkdown(),text=source.slice(s.from,s.to);
    if(source.slice(s.from-before.length,s.from)===before&&source.slice(s.to,s.to+after.length)===after)
      return edit(s.from-before.length,s.to+after.length,text,'input.format',{anchor:s.from-before.length,head:s.to-before.length});
    return edit(s.from,s.to,before+text+after,'input.format',{anchor:s.from+before.length,head:s.to+before.length});
  }
  function searchMatches(query){
    if(!query)return [];
    const found=[],links=referenceLinks(api.getMarkdown());
    for(const e of entries(wg.state.doc)){
      const analysis=analyzeBlock(e.raw,e.kind,links),hidden=analysis.ranges.filter(r=>r.meta),positions=[];let text='';
      for(let i=0;i<e.raw.length;i++)if(!hidden.some(r=>i>=r.from&&i<r.to)){text+=e.raw[i];positions.push(i);}
      let at=0;
      while((at=text.indexOf(query,at))>=0){
        let from=positions[at],to=positions[at+query.length-1]+1;
        for(const pair of analysis.ranges.filter(r=>r.inline).sort((a,b)=>(a.to-a.from)-(b.to-b.from))){
          const markers=hidden.filter(r=>r.ownerFrom===pair.from&&r.ownerTo===pair.to);
          const open=markers.find(r=>r.from===pair.from),close=markers.find(r=>r.to===pair.to);
          if(open&&close&&from<=open.to&&to>=close.from){from=Math.min(from,pair.from);to=Math.max(to,pair.to);}
        }
        found.push({from:e.source+from,to:e.source+to});at+=query.length;
      }
    }
    return found;
  }
  function handleKey(event,view){
    if(view!==wg||event.isComposing||composing)return false;
    const mod=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();
    if(readonly)return ['enter','backspace','delete','tab'].includes(key);
    if(mod&&key==='z'){event.preventDefault();event.stopPropagation();event.shiftKey?api.redo():api.undo();return true;}
    if(mod&&key==='y'){event.preventDefault();event.stopPropagation();api.redo();return true;}
    if(mod&&['b','i'].includes(key)){event.preventDefault();event.stopPropagation();api.command(key==='b'?'strong':'emphasis');return true;}
    const s=api.getSourceSelection(),source=api.getMarkdown();
    const inTable=wg.state.doc.resolve(wg.state.selection.head).matchingParent(p=>p.type===types.Table.type);
    if(inTable&&['enter','tab'].includes(key))return false;
    if(key==='enter'){
      event.preventDefault();
      const start=source.lastIndexOf('\n',s.from-1)+1,line=source.slice(start,s.from);
      let insert=source.includes('\r\n')?'\r\n':'\n';
      const context=entries(wg.state.doc).find(e=>s.from>=e.source&&s.from<=e.source+e.raw.length);
      if(!event.shiftKey&&!['code','displayMath','metadata','html'].includes(context?.kind)){
        const prefix=/^(\s*)([-+*]|\d+[.)])([ \t]+)(\[[ xX]\][ \t]+)?/.exec(line),quote=/^( {0,3}(?:>[ \t]?)+)/.exec(line);
        if(prefix){
          if(line.slice(prefix[0].length).trim()==='')return edit(start,s.to,'','input.enter');
          const marker=/\d/.test(prefix[2])?prefix[2].replace(/\d+/,n=>String(Number(n)+1)):prefix[2];
          insert+=prefix[1]+marker+prefix[3]+(prefix[4]?'[ ] ':'');
        }else if(quote){if(line.slice(quote[0].length).trim()==='')return edit(start,s.to,'','input.enter');insert+=quote[0];}
      }
      return edit(s.from,s.to,insert,'input.enter');
    }
    if(key==='tab'){
      event.preventDefault();const start=source.lastIndexOf('\n',s.from-1)+1;
      if(event.shiftKey){const spaces=/^( {1,4}|\t)/.exec(source.slice(start));if(spaces)return edit(start,start+spaces[0].length,'','input.indent');return true;}
      return edit(start,start,'    ','input.indent');
    }
    // At source block boundaries, native deletion would consume model tokens,
    // not Markdown characters. Handle them explicitly in source coordinates.
    if(s.from===s.to&&['backspace','delete'].includes(key)){
      const pos=wg.state.selection.head,entry=entries(wg.state.doc).find(e=>pos>=e.pos&&pos<=e.pos+e.node.length);
      const boundary=entry&&(key==='backspace'?pos<=entry.pos+1:pos>=entry.pos+entry.node.length-1);
      if(boundary){event.preventDefault();if(key==='backspace'&&s.from>0)return edit(s.from-(/^[\uDC00-\uDFFF]$/.test(source[s.from-1])?2:1),s.to,'','input.delete');
        if(key==='delete'&&s.to<source.length)return edit(s.from,s.to+(/^[\uD800-\uDBFF]$/.test(source[s.to])?2:1),'','input.delete');return true;}
    }
    return false;
  }
  async function uploadImage(file){
    const s=api.getSourceSelection();
    const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
    edit(s.from,s.to,`![${file.name.replace(/[\[\]]/g,'')}](${url})`,'input.image');
  }
  // Wordgard's mouseup listener must finish selecting on the frozen layout
  // before the newly focused token is expanded.
  const releaseDrag=()=>{queueMicrotask(()=>{if(!disposed&&wg)dispatchFlags({dragging:false});});};document.addEventListener('mouseup',releaseDrag);
  const api={
    get wg(){return wg;},getMarkdown:()=>sourceOf(wg.state.doc),getHTML:()=>toHTML(api.getMarkdown()),getJSON:()=>wg.state.doc.toJSON(),
    getText(){const div=document.createElement('div');div.innerHTML=api.getHTML();return div.textContent;},
    getSourceSelection(){const a=sourcePosition(wg.state.doc,wg.state.selection.anchor),h=sourcePosition(wg.state.doc,wg.state.selection.head);return {anchor:a,head:h,from:Math.min(a,h),to:Math.max(a,h)};},
    selectSource(anchor,head=anchor){wg.dispatch({selection:{anchor:modelPosition(wg.state.doc,anchor),head:modelPosition(wg.state.doc,head)},scrollIntoView:true});},
    edit,
    setMarkdown(source: string,{recordHistory=false,selection}: {recordHistory?: boolean; selection?: SourceSelection}={}){if(recordHistory)return commit(source,selection,true);mount(source);},
    setHTML(html,options){return api.setMarkdown(toMarkdown(html),options);},
    openDocument(id,source){
      if(activeDocument)sessions.set(activeDocument,wg);
      wg.dom.remove();activeDocument=id;const cached=sessions.get(id);
      if(cached&&sourceOf(cached.state.doc)===source){wg=cached;currentSource=source;if(visible){host.append(wg.dom);dispatchFlags({focused:true,dragging:false});wg.focus();wg.flush();}api.setReadonly(readonly);}
      else mount(source);
    },
    focus(){dispatchFlags({focused:true,dragging:false});wg.focus();},setVisible(value){visible=!!value;if(visible&&!disposed){if(wg.dom.parentNode!==host)host.append(wg.dom);dispatchFlags({focused:true,dragging:false});wg.flush();}else wg.dom.remove();},
    setReadonly(value){readonly=!!value;wg.dispatch({effects:[readMode.reconfigure([GardState.readOnly.of(readonly),Wordgard.editable.of(!readonly)]),viewEffect.of({focused:!readonly&&document.activeElement===wg.contentDOM})]});},
    undo(){if(readonly)return false;const result=commands.Command.dispatch(wg,commands.undo);if(visible)wg.flush();return result;},redo(){if(readonly)return false;const result=commands.Command.dispatch(wg,commands.redo);if(visible)wg.flush();return result;},
    destroy(){disposed=true;wg.dom.remove();sessions.clear();document.removeEventListener('mouseup',releaseDrag);},
    insertHTML(html){const s=api.getSourceSelection();return edit(s.from,s.to,toMarkdown(html),'input.insert');},
    insertImageDialog(){
      if(readonly)return false;
      const dialog=document.createElement('dialog');dialog.className='wg-img-dialog';
      dialog.innerHTML='<form method="dialog"><h3>插入图片</h3><label>图片地址<input name="url" type="url" placeholder="https://…"></label><label>替代文字<input name="alt"></label><label>本地图片<input name="file" type="file" accept="image/*"></label><button value="cancel">取消</button><button value="insert">插入</button></form>';
      document.body.append(dialog);const selection=api.getSourceSelection();
      dialog.addEventListener('close',()=>{if(dialog.returnValue==='insert'){
        const file=dialog.querySelector<HTMLInputElement>('[name=file]').files[0];api.selectSource(selection.anchor,selection.head);
        if(file)uploadImage(file);else{const url=dialog.querySelector<HTMLInputElement>('[name=url]').value,alt=dialog.querySelector<HTMLInputElement>('[name=alt]').value;if(/^https?:\/\//.test(url))edit(selection.from,selection.to,`![${alt}](${url})`,'input.image');}
      }dialog.remove();api.focus();});dialog.showModal();return true;
    },
    command(name: string,value: any = undefined){
      if(readonly)return false;
      const wrappers={strong:['**'],emphasis:['*'],strikethrough:['~~'],highlight:['=='],code:['`'],underline:['<u>','</u>'],subscript:['~'],superscript:['^']};
      if(wrappers[name])return wrap(wrappers[name][0],wrappers[name][1]);
      if(name==='undo'||name==='redo')return api[name]();
      if(name==='image')return api.insertImageDialog();
      const tableCommands={tableAddRow:addRow,tableAddColumn:addColumn,tableDeleteRow:deleteRow,tableDeleteColumn:deleteColumn};
      if(tableCommands[name])return commands.Command.dispatch(wg,tableCommands[name],value);
      if(name==='link')return wrap('[',`](${value})`);
      const s=api.getSourceSelection(),source=api.getMarkdown(),start=source.lastIndexOf('\n',s.from-1)+1;
      if(name==='heading'||name==='paragraph'){
        const end=source.indexOf('\n',s.to),lineEnd=end<0?source.length:end;
        const level=name==='paragraph'?0:Math.max(0,Math.min(6,Number(value)||0));
        return edit(start,lineEnd,(level?'#'.repeat(level)+' ':'')+source.slice(start,lineEnd).replace(/^#{1,6}\s+/,''),'input.heading');
      }
      if(['bulletList','orderedList','task','blockquote'].includes(name)){
        const text=source.slice(start,s.to),prefix={bulletList:'- ',orderedList:'1. ',task:'- [ ] ',blockquote:'> '}[name];
        return edit(start,s.to,text.split('\n').map((line,i)=>(name==='orderedList'?`${i+1}. `:prefix)+line).join('\n'),'input.list');
      }
      let label=1;while(source.includes(`[^${label}]`))label++;
      const rows=Number(value?.rows)||3,cols=Number(value?.cols)||3;
      const table=Array.from({length:rows+1},(_,r)=>'| '+Array.from({length:cols},(_,c)=>r===0?`列 ${c+1}`:r===1?'---':' ').join(' | ')+' |').join('\n');
      const snippets={horizontalRule:'---',codeBlock:'```javascript\n'+source.slice(s.from,s.to)+'\n```',math:'$$\n'+(value||'E=mc^2')+'\n$$',mermaid:'```mermaid\n'+(value||'graph LR\n A-->B')+'\n```',toc:'[TOC]',footnote:`[^${label}]\n\n[^${label}]: 脚注内容`,table};
      if(name in snippets){const prefix=s.from&&source[s.from-1]!=='\n'?'\n\n':'';return edit(s.from,s.to,prefix+snippets[name]+'\n\n','input.insert');}
      return false;
    },
    find(query,next=true){
      const s=api.getSourceSelection(),found=searchMatches(query);
      if(!found.length)return {count:0,index:-1};
      let index=next?found.findIndex(p=>p.from>=s.to):found.findLastIndex(p=>p.to<=s.from);if(index<0)index=next?0:found.length-1;
      api.selectSource(found[index].from,found[index].to);api.focus();return {count:found.length,index};
    },
    replaceSelection(text,query){const s=api.getSourceSelection();if(query!==undefined&&!searchMatches(query).some(r=>r.from===s.from&&r.to===s.to))return false;return edit(s.from,s.to,text,'input.replace');},
    replaceAll(query,replacement){
      if(readonly||!query)return 0;const found=searchMatches(query);let source=api.getMarkdown();
      for(const {from,to} of [...found].reverse())source=source.slice(0,from)+replacement+source.slice(to);
      if(found.length)commit(source,undefined,true,'input.replace.all');return found.length;
    },
  };
  mount(currentSource);return api;
}
