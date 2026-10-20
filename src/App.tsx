import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {createLiveEngine} from './live-engine';
import {createSourceEditor} from './source';
import {openMarkdownFiles, saveMarkdownFile} from './files';
import {toHTML, toMarkdown, renderEnhancements} from './markdown';
import {checkpoint, loadLibrary, newDocument, STORE} from './library';
import {Button, Icon, Sidebar, Toolbar, ModalContent, Toast} from './components';
import type {ModalState} from './components';
import type {CommandValue, FileEntry, ModalField, Mode, ToastMessage} from './types';

type Engine = ReturnType<typeof createLiveEngine>;
type SourceEditor = ReturnType<typeof createSourceEditor>;
const escapeHTML = (s: string) => s.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));
function download(name: string, data: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], {type}));
  const a = document.createElement('a');a.href = url;a.download = name;document.body.append(a);a.click();a.remove();setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  const [library, setLibrary] = useState(loadLibrary);
  const [mode, setModeState] = useState<Mode>('edit');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'files' | 'outline'>('files');
  const [saved, setSaved] = useState<'saving' | 'saved' | 'error'>('saved');
  const [cursor, setCursor] = useState('准备就绪');
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [typewriter, setTypewriter] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const editorHost = useRef<HTMLDivElement>(null), sourceHost = useRef<HTMLDivElement>(null), preview = useRef<HTMLElement>(null);
  const engine = useRef<Engine>(null), source = useRef<SourceEditor>(null);
  const titleInput = useRef<HTMLInputElement>(null), importInput = useRef<HTMLInputElement>(null), findInput = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const handles = useRef(new Map<string, FileEntry>());
  const loading = useRef(false);
  const current = library.docs.find(d => d.id === library.currentId)!;
  const latest = useRef({library, mode});latest.current = {library, mode};
  const actions = useRef<{key: (e: KeyboardEvent) => void; drop: (e: DragEvent) => void}>(null);
  const notify = (text: string, action?: ToastMessage['action']) => setToast({text, action});
  const update = (patch: Partial<typeof current>) => {
    const id = latest.current.library.currentId;
    setLibrary(s => ({...s, docs: s.docs.map(d => d.id === id ? {...d, ...patch, updated: Date.now()} : d)}));
  };
  function changed() {
    if (loading.current) return;
    const markdown = latest.current.mode === 'source' ? source.current!.value : engine.current!.getMarkdown();
    update({markdown});setSaved('saving');
  }
  function persist() {
    try {localStorage.setItem(STORE, JSON.stringify(latest.current.library));setSaved('saved');return true;}
    catch {setSaved('error');notify('本机存储空间不足，修改尚未保存，请导出文档。');return false;}
  }
  useLayoutEffect(() => {
    source.current = createSourceEditor(sourceHost.current!, changed);
    engine.current = createLiveEngine(editorHost.current!, {
      markdown: latest.current.library.docs.find(d => d.id === latest.current.library.currentId)!.markdown,
      onChange: changed,
      onSelection: (selection: {from: number; to: number}) => {
        setCursor(`位置 ${selection.from}${selection.to !== selection.from ? ' — ' + selection.to : ''}`);
        if (selection.from === selection.to && document.body.classList.contains('typewriter-mode')) requestAnimationFrame(() => {
          if (!engine.current || latest.current.mode !== 'edit') return;
          const scroll = document.querySelector('.paper-scroll')!;
          const caret = engine.current.wg.coordsAtPos(selection.to), bounds = scroll.getBoundingClientRect();
          scroll.scrollTop += caret.top - bounds.top - bounds.height * .44;
        });
      },
    });
    const key = (e: KeyboardEvent) => actions.current?.key(e);
    const drop = (e: DragEvent) => actions.current?.drop(e);
    const dragover = (e: DragEvent) => {if (e.dataTransfer?.types.includes('Files')) e.preventDefault();};
    const unload = () => {try {localStorage.setItem(STORE, JSON.stringify(latest.current.library));} catch { /* The UI already exposes export as recovery. */ }};
    document.addEventListener('keydown', key);document.addEventListener('drop', drop);document.addEventListener('dragover', dragover);window.addEventListener('beforeunload', unload);
    return () => {document.removeEventListener('keydown', key);document.removeEventListener('drop', drop);document.removeEventListener('dragover', dragover);window.removeEventListener('beforeunload', unload);engine.current?.destroy();source.current?.destroy();engine.current = null;source.current = null;};
  }, []);
  useLayoutEffect(() => {
    loading.current = true;
    engine.current!.openDocument(current.id, current.markdown);source.current!.open(current.id, current.markdown);
    loading.current = false;
  }, [current.id]);
  useLayoutEffect(() => {
    const ed = engine.current!, src = source.current!;
    ed.setReadonly(mode === 'reading');ed.setVisible(mode === 'edit');src.hidden = mode !== 'source';
    if (mode !== 'reading') (mode === 'source' ? src : ed).focus();
  }, [mode, current.id]);
  useEffect(() => {const timer = setTimeout(persist, 450);return () => clearTimeout(timer);}, [library]);
  useEffect(() => {if (!toast) return;const timer = setTimeout(() => setToast(null), 4500);return () => clearTimeout(timer);}, [toast]);
  useEffect(() => {
    document.documentElement.dataset.theme = library.theme;
    for (const [name, enabled] of Object.entries({dark: library.theme === 'dark', 'focus-mode': focus, 'typewriter-mode': typewriter, 'sidebar-collapsed': sidebarCollapsed, 'advanced-tools': advanced, 'reading-mode': mode === 'reading', 'source-mode': mode === 'source'})) document.body.classList.toggle(name, enabled);
  }, [library.theme, focus, typewriter, sidebarCollapsed, advanced, mode]);
  useEffect(() => {
    if (mode !== 'reading') return;
    const target = preview.current!;target.innerHTML = toHTML(current.markdown);
    void renderEnhancements(target).catch(e => notify(`预览失败：${(e as Error).message}`));
  }, [mode, current.id, current.markdown]);
  useEffect(() => {if (modal && !dialog.current!.open) dialog.current!.showModal();else if (!modal && dialog.current!.open) dialog.current!.close();}, [modal]);
  useEffect(() => {if (findOpen) {findInput.current?.focus();findInput.current?.select();}}, [findOpen]);

  const headings = useMemo(() => {
    const box = document.createElement('div');box.innerHTML = toHTML(current.markdown);
    return [...box.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => ({text: h.textContent || '', level: Number(h.tagName.slice(1))}));
  }, [current.markdown]);
  const stats = useMemo(() => {
    const text = current.markdown.replace(/[`#*_>\[\]~]/g, '');
    const count = (text.match(/[\p{Script=Han}]/gu) || []).length + (text.replace(/[\p{Script=Han}]/gu, ' ').match(/[\p{L}\p{N}]+/gu) || []).length;
    return {count, chars: [...current.markdown].length, minutes: Math.max(1, Math.ceil(count / 350))};
  }, [current.markdown]);
  function openDocument(id: string) {setLibrary(s => ({...s, docs: checkpoint(s.docs, s.currentId), currentId: id}));}
  function addDocument(title = '未命名文档', markdown = '') {
    const d = newDocument(title, markdown);
    setLibrary(s => ({...s, docs: [d, ...checkpoint(s.docs, s.currentId)], currentId: d.id}));
    requestAnimationFrame(() => {titleInput.current?.focus();titleInput.current?.select();});return d.id;
  }
  function setMode(next: Mode) {
    if (next === mode) return;
    const ed = engine.current!, src = source.current!;
    if (mode === 'source') {loading.current = true;ed.setMarkdown(src.value, {recordHistory: true, selection: {anchor: src.selectionAnchor, head: src.selectionHead}});loading.current = false;update({markdown: src.value});}
    if (next === 'source') {const selection = ed.getSourceSelection();src.value = ed.getMarkdown();src.setSelectionRange(selection.anchor, selection.head);}
    // Detach only after capturing selection; keep both engines alive for history.
    if (next !== 'edit') ed.setVisible(false);
    latest.current.mode = next;setModeState(next);
  }
  function ask(title: string, fields: ModalField[], submit = '插入') {return new Promise<Record<string, string> | null>(resolve => setModal({title, fields, submit, resolve}));}
  function closeModal(values: Record<string, string> | null = null) {modal?.resolve?.(values);setModal(null);}
  async function saveFile(saveAs = false) {
    setLibrary(s => ({...s, docs: checkpoint(s.docs, s.currentId)}));persist();
    if (!window.showSaveFilePicker) return download((current.title || '未命名文档') + '.md', current.markdown, 'text/markdown;charset=utf-8');
    const id = current.id, markdown = current.markdown;
    try {handles.current.set(id, await saveMarkdownFile({entry: handles.current.get(id), markdown, title: current.title, saveAs}));notify('Markdown 文件已写入磁盘');} catch (e) {if ((e as Error).name !== 'AbortError') notify((e as Error).message);}
  }
  async function openFile() {
    if (!window.showOpenFilePicker) return importInput.current!.click();
    try {for (const file of await openMarkdownFiles()) {const id = addDocument(file.title, file.markdown);handles.current.set(id, {handle: file.handle, baseline: file.markdown});}} catch (e) {if ((e as Error).name !== 'AbortError') notify(`打开文件失败：${(e as Error).message}`);}
  }
  async function importFiles(files: File[]) {
    let count = 0;
    for (const file of files) try {
      const text = await file.text();let title = file.name.replace(/\.[^.]+$/, ''), markdown = /\.html?$/i.test(file.name) ? toMarkdown(text) : text;
      if (/\.json$/i.test(file.name)) {const data = JSON.parse(text);if (typeof data.markdown !== 'string') throw Error('JSON 缺少 markdown 字段');markdown = data.markdown;title = data.title || title;}
      addDocument(title, markdown);count++;
    } catch (e) {notify(`无法导入 ${file.name}：${(e as Error).message}`);}
    if (count) notify(`已导入 ${count} 份文档`);
  }
  async function exportDoc(format: string) {
    const name = (current.title || '未命名').replace(/[\\/:*?"<>|]/g, '-');
    if (format === 'markdown') download(name + '.md', current.markdown, 'text/markdown;charset=utf-8');
    if (format === 'json') download(name + '.json', JSON.stringify({title: current.title, markdown: current.markdown, document: engine.current!.getJSON()}, null, 2), 'application/json');
    if (format === 'html') {const box = document.createElement('article');box.innerHTML = toHTML(current.markdown);await renderEnhancements(box);download(name + '.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHTML(current.title)}</title><style>body{max-width:800px;margin:60px auto;padding:0 28px;font:17px/1.9 Georgia,serif}img,svg{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}</style><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.0/dist/katex.min.css"><body>${box.innerHTML}</body></html>`, 'text/html');}
    if (format === 'print') {setMode('reading');requestAnimationFrame(() => {void renderEnhancements(preview.current!).then(() => window.print());});}
    setExportOpen(false);
  }
  function sourceCommand(name: string, value?: CommandValue) {
    const src = source.current!, from = src.selectionStart, to = src.selectionEnd, text = src.value.slice(from, to), lineStart = src.value.lastIndexOf('\n', from - 1) + 1;
    const wrappers: Record<string, string[]> = {strong: ['**', '**'], emphasis: ['*', '*'], strikethrough: ['~~', '~~'], code: ['`', '`'], underline: ['<u>', '</u>'], highlight: ['==', '=='], subscript: ['<sub>', '</sub>'], superscript: ['<sup>', '</sup>'], link: ['[', `](${value})`], image: [`![${text || '图片'}](`, ')']};
    let start = from, replacement: string;
    if (wrappers[name]) replacement = wrappers[name][0] + (name === 'image' ? String(value) : text || '文字') + wrappers[name][1];
    else if (name === 'heading') {start = lineStart;replacement = '#'.repeat(Number(value) || 0) + (Number(value) ? ' ' : '') + src.value.slice(start, to).replace(/^#{1,6}\s/, '');}
    else {
      let label = 1;while (src.value.includes(`[^${label}]`)) label++;
      const size = typeof value === 'object' ? value : {rows: 3, cols: 3};
      const table = Array.from({length: size.rows + 1}, (_, r) => '| ' + Array.from({length: size.cols}, (_, c) => r === 0 ? `列 ${c + 1}` : r === 1 ? '---' : ' ').join(' | ') + ' |').join('\n');
      const snippets: Record<string, string> = {codeBlock: '\n```javascript\n' + (text || '// 在这里编写代码') + '\n```\n', horizontalRule: '\n\n---\n\n', table: '\n' + table + '\n', math: '\n$$\n' + value + '\n$$\n', mermaid: '\n```mermaid\n' + value + '\n```\n', footnote: `[^${label}]\n\n[^${label}]: 脚注内容`, toc: '\n\n[TOC]\n\n'};
      replacement = snippets[name];
      if (['bulletList', 'orderedList', 'blockquote', 'task'].includes(name)) {start = lineStart;replacement = src.value.slice(start, to).split('\n').map((line, i) => ({bulletList: '- ', orderedList: `${i + 1}. `, blockquote: '> ', task: '- [ ] '}[name]) + line).join('\n');}
    }
    if (replacement !== undefined) {src.setRangeText(replacement, start, to);src.focus();}
  }
  async function command(name: string, value?: CommandValue) {
    if (mode === 'reading') return notify('切换回编辑模式后即可修改文档');
    if (name === 'undo' || name === 'redo') {(mode === 'source' ? source.current! : engine.current!)[name]();return;}
    if (mode === 'edit' && name === 'image') return engine.current!.insertImageDialog();
    if (['link', 'image', 'math', 'mermaid', 'table'].includes(name)) {
      const fields: Record<string, [string, ModalField[]]> = {
        link: ['插入链接', [{name: 'value', label: '链接地址', placeholder: 'https://example.com', required: true}]],
        image: ['插入图片', [{name: 'value', label: '图片 URL 或 data URL', required: true}]],
        math: ['插入公式', [{name: 'value', label: 'LaTeX', value: 'E = mc^2', multiline: true}]],
        mermaid: ['插入流程图', [{name: 'value', label: 'Mermaid', value: 'graph LR\n  A[灵感] --> B[写作]\n  B --> C[发布]', multiline: true}]],
        table: ['插入表格', [{name: 'rows', label: '行数', value: '3'}, {name: 'cols', label: '列数', value: '3'}]],
      };
      const result = await ask(...fields[name]);if (!result) return;
      value = name === 'table' ? {rows: Math.max(2, Math.min(20, Number(result.rows) || 3)), cols: Math.max(2, Math.min(10, Number(result.cols) || 3))} : result.value;
      if (['link', 'image'].includes(name) && !/^https?:\/\//i.test(String(value)) && !(name === 'image' && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(String(value)))) return notify('请输入 http(s) 地址，图片也支持本地 data URL');
    }
    if (mode === 'source') sourceCommand(name, value);else if (engine.current!.command(name, value) === false) notify('请先把光标放在正文中，或选中要修改的内容');
  }
  function findNext() {
    if (!findText) return;
    if (mode === 'source') {const src = source.current!, at = src.value.toLowerCase().indexOf(findText.toLowerCase(), src.selectionEnd), next = at < 0 ? src.value.toLowerCase().indexOf(findText.toLowerCase()) : at;if (next < 0) return notify('没有找到匹配内容');src.focus();src.setSelectionRange(next, next + findText.length);}
    else {const found = engine.current!.find(findText);if (!found.count) notify('没有找到匹配内容');else setCursor(`匹配 ${found.index + 1} / ${found.count}`);}
  }
  function replace(all = false) {
    if (!findText) return;if (mode === 'reading') return notify('阅读模式下不能替换');
    if (mode === 'source') {const src = source.current!;if (all) {src.value = src.value.split(findText).join(replaceText);changed();notify('已替换全部匹配内容');} else if (src.value.slice(src.selectionStart, src.selectionEnd).toLowerCase() === findText.toLowerCase()) {src.setRangeText(replaceText, src.selectionStart, src.selectionEnd);findNext();} else findNext();}
    else if (all) notify(`已替换 ${engine.current!.replaceAll(findText, replaceText)} 处`);else if (engine.current!.replaceSelection(replaceText, findText) === false) findNext();
  }
  function history() {
    const docs = checkpoint(library.docs, current.id), revisions = docs.find(d => d.id === current.id)!.revisions;
    setLibrary(s => ({...s, docs}));setModal({title: '文档版本', content: <><p className="dialog-description">保存在此浏览器的最近 20 个版本。</p><div className="revision-list">{[...revisions].reverse().map((r, i) => <button type="button" key={i} className="revision-item" data-revision={revisions.length - 1 - i} onClick={() => {loading.current = true;engine.current!.setMarkdown(r.markdown, {recordHistory: true});source.current!.value = r.markdown;loading.current = false;update({markdown: r.markdown, title: r.title});setModal(null);notify('已恢复版本');}}><span>{new Date(r.at).toLocaleString('zh-CN')}</span><small>{r.markdown.length} 字符 · 恢复此版本</small></button>)}</div></>});
  }
  actions.current = {
    key(e) {
      if (e.key === 'Escape') {setFindOpen(false);setExportOpen(false);setFocus(false);return;}
      if (!(e.ctrlKey || e.metaKey) || dialog.current?.open) return;
      const key = e.key.toLowerCase(), target = e.target as HTMLElement;
      if (key === 's') {e.preventDefault();if (handles.current.has(current.id) || e.shiftKey) void saveFile(e.shiftKey);else {setLibrary(s => ({...s, docs: checkpoint(s.docs, s.currentId)}));persist();notify('文档已保存至本机');}return;}
      if (target.closest('input,textarea') && !target.closest('.cm-editor')) return;
      if (key === 'f') {e.preventDefault();setFindOpen(v => !v);}
      if (key === 'm' && e.shiftKey) {e.preventDefault();setMode(mode === 'source' ? 'edit' : 'source');}
      if (target.closest('.cm-editor') && ['z', 'y'].includes(key)) return;
      if (['b', 'i', 'k'].includes(key)) {e.preventDefault();void command({b: 'strong', i: 'emphasis', k: 'link'}[key]);}
    },
    drop(e) {const files = [...(e.dataTransfer?.files || [])].filter(f => /\.(md|markdown|txt|html|json)$/i.test(f.name));if (files.length) {e.preventDefault();void importFiles(files);}},
  };
  return <>
    <Sidebar docs={library.docs} currentId={current.id} query={query} tab={tab} onQuery={setQuery} onTab={setTab} onOpen={openDocument} onNew={() => addDocument()} onImport={() => importInput.current!.click()} onOpenFile={() => void openFile()} onHistory={history} onDelete={() => {
      const remaining = library.docs.find(d => !d.deleted && d.id !== current.id), fallback = remaining || newDocument(), id = current.id;
      setLibrary(s => ({...s, docs: [...(remaining ? [] : [fallback]), ...s.docs.map(d => d.id === id ? {...d, deleted: true} : d)], currentId: fallback.id}));
      notify('文档已移出列表', {label: '撤销删除', run: () => setLibrary(s => ({...s, docs: s.docs.map(d => d.id === id ? {...d, deleted: false} : d), currentId: id}))});
    }} onHelp={() => setModal({title: '一张纸，所有灵感', content: <div className="help-content"><p>⌘ / Ctrl + B 加粗，I 斜体，K 链接，Z 撤销，F 查找，S 保存，Shift + M 切换 Markdown 源码。</p><p>正文使用 Wordgard，聚焦时显示 Markdown 语法。支持表格、公式、Mermaid、目录和脚注。</p><p>文档与最近 20 个版本保存在此浏览器；撤销历史在本次会话保留。支持本机 Markdown、HTML / JSON 导入导出，PDF 使用浏览器打印。</p></div>})} headings={headings} onHeading={index => {
      if (mode === 'source') {const match = [...source.current!.value.matchAll(/^#{1,6}\s+.*$/gm)][index];if (match) {source.current!.focus();source.current!.setSelectionRange(match.index!, match.index! + match[0].length);}}
      else (mode === 'reading' ? preview.current! : editorHost.current!).querySelectorAll('h1,h2,h3,h4,h5,h6')[index]?.scrollIntoView({behavior: 'smooth', block: 'start'});
    }} />
    <input ref={importInput} type="file" id="import-file" accept=".md,.markdown,.txt,.html,.json" multiple hidden onChange={e => {void importFiles([...e.target.files!]);e.target.value = '';}} />
    <main className="workspace" onClick={e => {if (!(e.target as HTMLElement).closest('#export-menu,#export-btn')) setExportOpen(false);}}>
      <header className="topbar"><div className="breadcrumb"><Button id="sidebar-toggle" icon="panel-left" label="切换侧栏" onClick={() => setSidebarCollapsed(v => !v)} /><span>我的文档</span><Icon name="chevron-right" /><span className="breadcrumb-current">写作工作台</span></div><div className="top-actions"><span id="save-status" className="save-status" data-state={saved}>{saved === 'saving' ? '正在保存…' : saved === 'error' ? '保存失败，请导出备份' : '已保存至本机'}</span><span className="top-divider" /><button id="save-file" className="text-button" title="保存到本机文件 · Ctrl S（已打开的文件）" onClick={() => void saveFile()}>保存文件</button><button id="source-toggle" className={`text-button${mode === 'source' ? ' active' : ''}`} title="切换 Markdown 源码" aria-pressed={mode === 'source'} onClick={() => setMode(mode === 'source' ? 'edit' : 'source')}><Icon name="code-xml" /><span>源码</span></button><Button id="readonly-toggle" icon="book-open" label="阅读模式" active={mode === 'reading'} onClick={() => setMode(mode === 'reading' ? 'edit' : 'reading')} /><Button id="theme-toggle" icon="sun" label="切换深色主题" onClick={() => setLibrary(s => ({...s, theme: s.theme === 'dark' ? 'light' : 'dark'}))} /><div className="export-wrap"><button id="export-btn" className="export-button" onClick={() => setExportOpen(v => !v)}><Icon name="download" />导出<Icon name="chevron-down" /></button><div id="export-menu" className="dropdown" hidden={!exportOpen}><button onClick={() => void saveFile(true)}>Markdown 另存为</button>{[['markdown', 'Markdown', '.md'], ['html', '网页文档', '.html'], ['json', '完整文档备份', '.json'], ['print', '打印 / 保存为 PDF', '']].map(([format, label, suffix]) => <button key={format} data-export={format} onClick={() => void exportDoc(format)}>{label}<span>{suffix}</span></button>)}</div></div></div></header>
      <Toolbar command={(name, value) => {void command(name, value);}} find={() => setFindOpen(v => !v)} typewriter={typewriter} focus={focus} onTypewriter={() => {setTypewriter(v => !v);notify(typewriter ? '已关闭打字机留白模式' : '已开启打字机留白模式');}} onFocus={() => setFocus(v => !v)} onAdvanced={() => setAdvanced(v => !v)} />
      <section id="find-panel" className="find-panel" hidden={!findOpen}><input ref={findInput} id="find-input" placeholder="查找文本" aria-label="查找文本" value={findText} onChange={e => setFindText(e.target.value)} onKeyDown={e => {if (e.key === 'Enter') {e.preventDefault();findNext();}}} /><input id="replace-input" placeholder="替换为" aria-label="替换文本" value={replaceText} onChange={e => setReplaceText(e.target.value)} /><button id="find-next" onClick={findNext}>下一处</button><button id="replace-one" onClick={() => replace()}>替换</button><button id="replace-all" onClick={() => replace(true)}>全部替换</button><Button id="find-close" icon="x" label="关闭查找" onClick={() => setFindOpen(false)} /></section>
      <div className="paper-scroll"><article className="paper"><div className="document-eyebrow"><span className="eyebrow-line" />写下值得留下的事</div><input ref={titleInput} id="input-title" className="document-title" value={current.title} placeholder="无标题文档" aria-label="文档标题" readOnly={mode === 'reading'} onChange={e => update({title: e.target.value})} /><div className="document-meta"><span><Icon name="file-text" />Markdown 文档</span><span className="meta-dot">·</span><span>自由书写，自然成文</span></div><div className="title-rule" /><div ref={editorHost} id="editor-host" hidden={mode !== 'edit'} /><article ref={preview} id="reading-preview" className="reading-preview" hidden={mode !== 'reading'} /><div ref={sourceHost} hidden={mode !== 'source'} /><div className="paper-end"><span /><Icon name="leaf" /><span /></div></article></div>
      <footer className="statusbar"><div><span className="status-dot" /><span>本地优先</span><span className="footer-divider">/</span><span>Markdown</span></div><div><span id="cursor-status">{cursor}</span><span className="footer-divider">|</span><span><b id="word-count">{stats.count.toLocaleString()}</b> 字</span><span><b id="char-count">{stats.chars.toLocaleString()}</b> 字符</span><span>阅读约 <b id="reading-time">{stats.minutes}</b> 分钟</span><span className="footer-divider">|</span><span>UTF-8</span></div></footer>
    </main>
    <Toast value={toast} close={() => setToast(null)} /><dialog ref={dialog} id="modal" onCancel={() => closeModal()}><ModalContent key={modal?.title || 'closed'} value={modal} onClose={() => closeModal()} onSubmit={closeModal} /></dialog>
  </>;
}
