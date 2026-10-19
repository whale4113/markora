import './style.css';
import 'katex/dist/katex.min.css';
import {createIcons,icons} from 'lucide';
import {createEngine} from './engine.js';
import {toHTML,toMarkdown,renderEnhancements,sampleDocs} from './markdown.js';

const $=id=>document.getElementById(id);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STORE='zhijian-wordgard-v1';
let stored;try{stored=JSON.parse(localStorage.getItem(STORE)||'null')}catch{}
let docs=Array.isArray(stored?.docs)&&stored.docs.length?stored.docs:sampleDocs.map(d=>({...d,created:Date.now(),updated:Date.now(),revisions:[]}));
let currentId=docs.find(d=>d.id===stored?.currentId&&!d.deleted)?.id||docs.find(d=>!d.deleted)?.id;
let engine,sourceMode=false,reading=false,loading=false,saveTimer,toastTimer,modalResolve,lastRevision=0,renderToken=0;
const current=()=>docs.find(d=>d.id===currentId);
const refreshIcons=()=>createIcons({icons,attrs:{'stroke-width':1.6}});
const preview=document.createElement('article');preview.id='reading-preview';preview.className='reading-preview';preview.hidden=true;
$('editor-host').after(preview);
const currentMarkdown=()=>sourceMode?$('source-editor').value:current()?.markdown||'';

function toast(message,action){
 const target=$('toast');target.hidden=false;target.replaceChildren(document.createTextNode(message));
 if(action){const b=document.createElement('button');b.textContent=action.label;b.onclick=()=>{action.run();target.classList.remove('visible')};target.append(b)}
 target.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>{target.classList.remove('visible');target.hidden=true},4500);
}
function persist(){
 try{localStorage.setItem(STORE,JSON.stringify({docs,currentId,theme:document.documentElement.dataset.theme||'light'}));$('save-status').textContent='已保存至本机';$('save-status').dataset.state='saved';return true}
 catch(e){$('save-status').textContent='保存失败，请导出备份';$('save-status').dataset.state='error';toast('本机存储空间不足，修改尚未保存，请导出文档。');return false}
}
function changed(){
 if(loading||!current())return;
 current().markdown=sourceMode?$('source-editor').value:toMarkdown(engine.getHTML());current().updated=Date.now();
 $('save-status').textContent='正在保存…';$('save-status').dataset.state='saving';clearTimeout(saveTimer);
 saveTimer=setTimeout(()=>{persist();renderDocs();renderOutline()},450);updateStats();
}
function checkpoint(force=false){
 const d=current();if(!d)return;if(sourceMode)d.markdown=$('source-editor').value;
 const revisions=d.revisions||(d.revisions=[]);
 if((force||Date.now()-lastRevision>45000)&&revisions.at(-1)?.markdown!==d.markdown){revisions.push({at:Date.now(),title:d.title,markdown:d.markdown});d.revisions=revisions.slice(-20);lastRevision=Date.now()}
}
function updateStats(){
 const md=currentMarkdown(),text=md.replace(/[`#*_>\[\]~]/g,'').replace(/!\([^)]*\)/g,'');
 const han=(text.match(/[\p{Script=Han}]/gu)||[]).length,words=(text.replace(/[\p{Script=Han}]/gu,' ').match(/[\p{L}\p{N}]+/gu)||[]).length;
 $('word-count').textContent=(han+words).toLocaleString();$('char-count').textContent=[...md].length.toLocaleString();$('reading-time').textContent=Math.max(1,Math.ceil((han+words)/350));
}
function renderDocs(){
 const q=$('search-docs').value.trim().toLowerCase(),list=docs.filter(d=>!d.deleted&&(d.title+' '+d.markdown).toLowerCase().includes(q));
 $('doc-list').innerHTML=list.length?list.map(d=>`<button class="doc-item ${d.id===currentId?'active':''}" data-doc="${escape(d.id)}"><i data-lucide="file-text"></i><span class="doc-info"><strong>${escape(d.title||'未命名文档')}</strong><small>${escape(d.markdown.replace(/^#+ .*$/gm,'').replace(/[`#*_>\[\]~]/g,'').trim().slice(0,42)||'在这里写下第一句话')}</small></span>${d.id===currentId?'<span class="doc-active-dot"></span>':''}</button>`).join(''):'<p class="empty-state">没有找到文档</p>';
 const count=$('document-count');if(count)count.textContent=docs.filter(d=>!d.deleted).length;
 refreshIcons();
}
function renderOutline(){
 const container=document.createElement('div');container.innerHTML=toHTML(currentMarkdown());
 const headings=[...container.querySelectorAll('h1,h2,h3,h4,h5,h6')];
 $('outline-list').innerHTML=headings.length?headings.map((h,i)=>`<button class="outline-item" data-heading="${i}" style="--level:${Number(h.tagName.slice(1))-1}"><span class="outline-hash">${h.tagName.toLowerCase()}</span>${escape(h.textContent)}</button>`).join(''):'<p class="empty-state">添加标题后，大纲会显示在这里。</p>';
}
function selectTab(tab){
 const files=tab==='files';$('doc-list').hidden=!files;$('outline-list').hidden=files;$('tab-files').classList.toggle('active',files);$('tab-outline').classList.toggle('active',!files);$('tab-files').setAttribute('aria-selected',files);$('tab-outline').setAttribute('aria-selected',!files);
}
function openDocument(id){
 if(engine){checkpoint();persist()}
 currentId=id;const d=current();if(!d)return;
 loading=true;$('input-title').value=d.title;$('source-editor').value=d.markdown;
 if(engine)engine.setHTML(toHTML(d.markdown));else engine=createEngine($('editor-host'),{html:toHTML(d.markdown),onChange:()=>changed(),onSelection:sel=>{
  $('cursor-status').textContent=sel?.from!==undefined?`位置 ${sel.from}${sel.to!==sel.from?' — '+sel.to:''}`:'Markdown';
  if(engine&&!sourceMode&&!reading&&sel.from===sel.to&&document.body.classList.contains('typewriter-mode'))requestAnimationFrame(()=>{const scroll=document.querySelector('.paper-scroll'),caret=engine.wg.coordsAtPos(sel.to),bounds=scroll.getBoundingClientRect();scroll.scrollTop+=caret.top-bounds.top-bounds.height*.44});
 }});
 loading=false;lastRevision=Date.now();if(reading)showReading();renderDocs();renderOutline();updateStats();persist();
}
function addDocument(title='未命名文档',markdown=''){
 checkpoint(true);const d={id:crypto.randomUUID(),title,markdown,created:Date.now(),updated:Date.now(),revisions:[]};docs.unshift(d);openDocument(d.id);$('input-title').focus();$('input-title').select();
}
async function showReading(){
 const token=++renderToken;preview.innerHTML=toHTML(currentMarkdown());
 await renderEnhancements(preview);if(token!==renderToken)return;
}
function setReading(value){
 if(value&&sourceMode)setSource(false);reading=value;if(value)engine.setVisible?.(false);$('editor-host').hidden=value;$('source-editor').hidden=true;preview.hidden=!value;
 engine.setReadonly(value);$('input-title').readOnly=value;$('readonly-toggle').classList.toggle('active',value);$('readonly-toggle').setAttribute('aria-pressed',value);
 document.body.classList.toggle('reading-mode',value);if(value)showReading();else{engine.setVisible?.(true);engine.focus()}
}
function setSource(value){
 if(value===sourceMode)return;if(reading)setReading(false);
 if(value){$('source-editor').value=current().markdown;engine.setVisible?.(false);sourceMode=true}else{current().markdown=$('source-editor').value;$('editor-host').hidden=false;loading=true;engine.setHTML(toHTML(current().markdown));loading=false;sourceMode=false;engine.setVisible?.(true);persist()}
 $('editor-host').hidden=value;$('source-editor').hidden=!value;$('source-toggle').classList.toggle('active',value);$('source-toggle').setAttribute('aria-pressed',value);document.body.classList.toggle('source-mode',value);
 renderOutline();updateStats();(value?$('source-editor'):engine).focus();
}
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function exportDoc(format){
 checkpoint(true);persist();const d=current(),name=(d.title||'未命名').replace(/[\\/:*?"<>|]/g,'-');
 if(format==='markdown')download(name+'.md',currentMarkdown(),'text/markdown;charset=utf-8');
 if(format==='json')download(name+'.json',JSON.stringify({title:d.title,markdown:currentMarkdown(),document:engine.getJSON()},null,2),'application/json');
 if(format==='html'){
  const box=document.createElement('article');box.innerHTML=toHTML(currentMarkdown());await renderEnhancements(box);
      download(name+'.html',`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(d.title)}</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.0/dist/katex.min.css"><style>body{max-width:800px;margin:60px auto;padding:0 28px;font:17px/1.9 Georgia,"Noto Serif SC",serif;color:#272925}img,svg{max-width:100%}pre{padding:20px;background:#f4f4f0;overflow:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px}blockquote{border-left:3px solid #849580;margin:20px 0;padding-left:20px;color:#66715f}code{font-size:.9em}</style><body>${box.innerHTML}</body></html>`,'text/html');
 }
 if(format==='print'){setReading(true);await showReading();window.print()}
 $('export-menu').hidden=true;
}
async function modal(title,fields,submit='插入'){
 $('modal-title').textContent=title;$('modal-body').innerHTML=fields.map(f=>`<label class="modal-field">${escape(f.label)}${f.multiline?`<textarea name="${f.name}" rows="6">${escape(f.value||'')}</textarea>`:`<input name="${f.name}" value="${escape(f.value||'')}" placeholder="${escape(f.placeholder||'')}" ${f.required?'required':''}>`}</label>`).join('');$('modal-submit').textContent=submit;$('modal-submit').hidden=false;$('modal').showModal();$('modal-body').querySelector('input,textarea')?.focus();return new Promise(resolve=>modalResolve=resolve);
}
function sourceCommand(name,value){
 const el=$('source-editor'),s=el.selectionStart,e=el.selectionEnd,text=el.value.slice(s,e),lineStart=el.value.lastIndexOf('\n',s-1)+1;
 const wrappers={strong:['**','**'],emphasis:['*','*'],strikethrough:['~~','~~'],code:['`','`'],link:['[',`](${value})`],image:[`![${text||'图片'}](`,')']};
 let replacement,start=s,end=e;
 if(wrappers[name])replacement=wrappers[name][0]+(name==='image'?value:text||'文字')+wrappers[name][1];
 else if(name==='heading'){start=lineStart;const level=Number(value)||0;replacement=(level?'#'.repeat(level)+' ':'')+el.value.slice(start,e).replace(/^#{1,6}\s/,'')}
 else {const snippets={bulletList:'- ',orderedList:'1. ',blockquote:'> ',codeBlock:'\n```javascript\n'+(text||'// 在这里编写代码')+'\n```\n',horizontalRule:'\n\n---\n\n',task:'- [ ] 待办事项',table:'\n| 标题 | 内容 |\n| --- | --- |\n| 第一项 | 在这里填写 |\n',math:'\n$$\n'+value+'\n$$\n',mermaid:'\n```mermaid\n'+value+'\n```\n',footnote:'[^note]\n\n[^note]: 脚注内容'};replacement=snippets[name];if(['bulletList','orderedList','blockquote','task'].includes(name)){start=lineStart;replacement+=el.value.slice(start,e)}}
 if(replacement!==undefined){el.setRangeText(replacement,start,end,'end');el.focus();changed()}
}
async function command(name,value){
 if(reading){toast('切换回编辑模式后即可修改文档');return}
 if(name==='undo'||name==='redo'){if(sourceMode){$('source-editor').focus();document.execCommand(name)}else engine[name]();return}
 if(['link','image','math','mermaid','table'].includes(name)){
  const specs={link:['插入链接',[{name:'value',label:'链接地址',placeholder:'https://example.com',required:true}]],image:['插入图片',[{name:'value',label:'图片 URL 或 data URL',placeholder:'https://…',required:true}]],math:['插入公式',[{name:'value',label:'LaTeX',value:'E = mc^2',multiline:true}]],mermaid:['插入流程图',[{name:'value',label:'Mermaid',value:'graph LR\n  A[灵感] --> B[写作]\n  B --> C[发布]',multiline:true}]],table:['插入表格',[{name:'rows',label:'行数',value:'3'},{name:'cols',label:'列数',value:'3'}]]};
  const result=await modal(...specs[name]);if(!result)return;value=name==='table'?{rows:Math.max(2,Math.min(20,Number(result.rows)||3)),cols:Math.max(2,Math.min(10,Number(result.cols)||3))}:result.value;
  if(['link','image'].includes(name)&&!/^https?:\/\//i.test(value)&&!(name==='image'&&/^data:image\/(png|jpeg|gif|webp);base64,/i.test(value))){toast('请输入 http(s) 地址，图片也支持本地 data URL');return}
 }
 if(sourceMode)sourceCommand(name,value);else{const result=engine.command(name,value);if(result===false)toast('请先把光标放在正文中，或选中要修改的内容')}
}
function toggleFind(){const visible=$('find-panel').hidden;$('find-panel').hidden=!visible;if(visible){$('find-input').focus();$('find-input').select()}}
function findNext(){const q=$('find-input').value;if(!q)return;if(sourceMode){const el=$('source-editor'),at=el.value.toLowerCase().indexOf(q.toLowerCase(),el.selectionEnd);const next=at<0?el.value.toLowerCase().indexOf(q.toLowerCase()):at;if(next<0)return toast('没有找到匹配内容');el.focus();el.setSelectionRange(next,next+q.length)}else{const result=engine.find?.(q,true);if(!result?.count)toast('没有找到匹配内容');else $('cursor-status').textContent=`匹配 ${result.index+1} / ${result.count}`}}
function replace(all=false){const q=$('find-input').value,r=$('replace-input').value;if(!q)return;if(reading)return toast('阅读模式下不能替换');if(sourceMode){const el=$('source-editor');if(all){el.value=el.value.split(q).join(r);changed();toast('已替换全部匹配内容')}else if(el.value.slice(el.selectionStart,el.selectionEnd).toLowerCase()===q.toLowerCase()){el.setRangeText(r,el.selectionStart,el.selectionEnd,'end');changed();findNext()}else findNext()}else{if(all){const n=engine.replaceAll?.(q,r);toast(`已替换 ${n||0} 处`)}else{if(engine.replaceSelection?.(r,q)===false)findNext()}}}
async function importFiles(files){
 let imported=0;
 for(const file of files){try{const content=await file.text();let title=file.name.replace(/\.[^.]+$/,''),md=content;
  if(/\.html?$/i.test(file.name))md=toMarkdown(content);
  if(/\.json$/i.test(file.name)){const data=JSON.parse(content);if(typeof data.markdown!=='string')throw Error('JSON 缺少 markdown 字段');md=data.markdown;title=data.title||title}
  addDocument(title,md);imported++;
 }catch(e){toast(`无法导入 ${file.name}：${e.message}`)}}
 persist();if(imported)toast(`已导入 ${imported} 份文档`);
}
function showHistory(){
 checkpoint(true);persist();const revisions=current().revisions||[];
 $('modal-title').textContent='文档版本';$('modal-body').innerHTML=`<p class="dialog-description">保存在此浏览器的最近 20 个版本。</p><div class="revision-list">${[...revisions].reverse().map((r,i)=>`<button type="button" class="revision-item" data-revision="${revisions.length-1-i}"><span>${escape(new Date(r.at).toLocaleString('zh-CN'))}</span><small>${r.markdown.length} 字符 · 恢复此版本</small></button>`).join('')}</div>`;$('modal-submit').hidden=true;$('modal').showModal();
}
function showHelp(){
 $('modal-title').textContent='一张纸，所有灵感';$('modal-body').innerHTML='<div class="help-content"><p>⌘ / Ctrl + B 加粗，I 斜体，K 链接，Z 撤销，F 查找，S 保存，Shift + M 切换 Markdown 源码。</p><p>标题、列表、引用、行内格式、代码、表格、链接与图片由 Wordgard 编辑。公式与 Mermaid 以可编辑代码块保存，在阅读模式中渲染。表格的行列和合并操作可使用正文上方的原生菜单。</p><p>文档与历史保存在此浏览器。支持 Markdown / HTML / JSON 导入导出，PDF 使用浏览器打印。</p><p>这是浏览器 demo；不提供桌面文件监视、系统词典、Pandoc、云图床或 Typora 私有扩展的逐字节兼容。源码与可视模式转换可能规范化排版，请保留重要原文备份。</p></div>';$('modal-submit').hidden=true;$('modal').showModal();
}

$('modal-form').addEventListener('submit',e=>{e.preventDefault();const values=Object.fromEntries(new FormData($('modal-form')));$('modal').close();modalResolve?.(values);modalResolve=null});
$('modal-cancel').addEventListener('click',()=>{$('modal').close();modalResolve?.(null);modalResolve=null});$('modal').addEventListener('cancel',()=>{modalResolve?.(null);modalResolve=null});
$('modal-body').addEventListener('click',e=>{const b=e.target.closest('[data-revision]');if(b){const rev=current().revisions[Number(b.dataset.revision)];current().markdown=rev.markdown;current().title=rev.title;$('source-editor').value=rev.markdown;$('modal').close();openDocument(currentId);toast('已恢复版本')}});
$('doc-list').addEventListener('click',e=>{const b=e.target.closest('[data-doc]');if(b)openDocument(b.dataset.doc)});
$('outline-list').addEventListener('click',e=>{const b=e.target.closest('[data-heading]');if(!b)return;const index=Number(b.dataset.heading);if(sourceMode){const matches=[...$('source-editor').value.matchAll(/^#{1,6}\s+.*$/gm)];if(matches[index]){$('source-editor').focus();$('source-editor').setSelectionRange(matches[index].index,matches[index].index+matches[index][0].length)}}else{const host=reading?preview:$('editor-host');host.querySelectorAll('h1,h2,h3,h4,h5,h6')[index]?.scrollIntoView({behavior:'smooth',block:'start'})}});
$('tab-files').onclick=()=>selectTab('files');$('tab-outline').onclick=()=>selectTab('outline');$('search-docs').oninput=renderDocs;
$('new-doc').onclick=()=>addDocument();$('import-doc').onclick=()=>$('import-file').click();$('import-file').accept='.md,.markdown,.txt,.html,.json';$('import-file').onchange=e=>{importFiles([...e.target.files]);e.target.value=''};
$('input-title').oninput=()=>{current().title=$('input-title').value;current().updated=Date.now();persist();renderDocs()};
$('source-toggle').onclick=()=>setSource(!sourceMode);$('source-editor').oninput=changed;
$('readonly-toggle').onclick=()=>setReading(!reading);
$('focus-toggle').onclick=()=>{document.body.classList.toggle('focus-mode');$('focus-toggle').classList.toggle('active',document.body.classList.contains('focus-mode'))};
$('typewriter-toggle').onclick=()=>{document.body.classList.toggle('typewriter-mode');$('typewriter-toggle').classList.toggle('active',document.body.classList.contains('typewriter-mode'));toast(document.body.classList.contains('typewriter-mode')?'已开启打字机留白模式':'已关闭打字机留白模式')};
$('theme-toggle').onclick=()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';document.body.classList.toggle('dark',dark);persist()};
$('sidebar-toggle').onclick=()=>document.body.classList.toggle('sidebar-collapsed');
$('font-size').onchange=e=>document.documentElement.style.setProperty('--editor-font-size',e.target.value+'px');
$('export-btn').onclick=()=>$('export-menu').hidden=!$('export-menu').hidden;$('export-menu').onclick=e=>{const b=e.target.closest('[data-export]');if(b)exportDoc(b.dataset.export)};
$('find-toggle').onclick=toggleFind;$('find-close').onclick=()=>$('find-panel').hidden=true;$('find-next').onclick=findNext;$('replace-one').onclick=()=>replace(false);$('replace-all').onclick=()=>replace(true);$('find-input').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();findNext()}};
$('history-toggle').onclick=showHistory;$('help-btn').onclick=showHelp;
$('delete-doc').onclick=()=>{const d=current(),id=d.id;d.deleted=true;const next=docs.find(x=>!x.deleted);if(next)openDocument(next.id);else addDocument();persist();toast('文档已移出列表',{label:'撤销删除',run:()=>{const restored=docs.find(x=>x.id===id);restored.deleted=false;openDocument(id)}})};
document.addEventListener('pointerdown',e=>{if(e.target.closest('button[data-command]'))e.preventDefault()});
document.addEventListener('click',e=>{const b=e.target.closest('button[data-command]');if(b)command(b.dataset.command,b.dataset.value);if(!e.target.closest('#export-menu,#export-btn'))$('export-menu').hidden=true});
document.querySelectorAll('select[data-command]').forEach(el=>el.onchange=()=>command(el.dataset.command,el.value));
document.addEventListener('keydown',e=>{const mod=e.ctrlKey||e.metaKey;if(e.key==='Escape'){$('find-panel').hidden=true;$('export-menu').hidden=true;document.body.classList.remove('focus-mode');$('focus-toggle').classList.remove('active');return}if(!mod||$('modal').open)return;
 if(e.key.toLowerCase()==='s'){e.preventDefault();checkpoint(true);persist();toast('文档已保存至本机')}
 if(e.key.toLowerCase()==='f'){e.preventDefault();toggleFind()}
 if(e.key.toLowerCase()==='m'&&e.shiftKey){e.preventDefault();setSource(!sourceMode)}
 if(['b','i','k'].includes(e.key.toLowerCase())&&document.activeElement!==$('input-title')&&document.activeElement!==$('search-docs')){e.preventDefault();command({b:'strong',i:'emphasis',k:'link'}[e.key.toLowerCase()])}
});
document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault()});document.addEventListener('drop',e=>{const files=[...e.dataTransfer.files].filter(f=>/\.(md|markdown|txt|html|json)$/i.test(f.name));if(files.length){e.preventDefault();importFiles(files)}});
window.addEventListener('beforeunload',()=>{checkpoint();persist()});
document.documentElement.dataset.theme=stored?.theme||'light';document.body.classList.toggle('dark',stored?.theme==='dark');
if(!currentId){const d={id:crypto.randomUUID(),title:'未命名文档',markdown:'',revisions:[]};docs.push(d);currentId=d.id}
openDocument(currentId);selectTab('files');refreshIcons();
const advanced=document.createElement('button');advanced.type='button';advanced.textContent='完整格式 / 表格行列工具';advanced.onclick=()=>{document.body.classList.toggle('advanced-tools');toast('已切换完整格式工具，可在表格中增删行列、合并单元格')};document.querySelector('.insert-options').append(advanced);
$('insert-menu').onclick=()=>document.querySelector('.insert-wrap').classList.toggle('open');
window.addEventListener('error',e=>{console.error(e.error);toast('操作出现错误，请导出当前文档备份')});
