import {Leaf, Plus, Search, ChevronDown, FileText, History, Trash2, CircleHelp, Upload, LockKeyhole, Undo2, Redo2, Bold, Italic, Strikethrough, Code, List, ListOrdered, ListChecks, Quote, Link, Image, Table2, CirclePlus, AlignCenter, Maximize, PencilLine, PanelLeft, ChevronRight, CodeXml, BookOpen, Sun, Download, X} from 'lucide-react';
import type {CSSProperties, ReactNode} from 'react';
import type {DocumentRecord, ModalField, ToastMessage} from './types';

export function Icon({name}: {name: string}) {
  const icons = {Leaf, Plus, Search, ChevronDown, FileText, History, Trash2, CircleHelp, Upload, LockKeyhole, Undo2, Redo2, Bold, Italic, Strikethrough, Code, List, ListOrdered, ListChecks, Quote, Link, Image, Table2, CirclePlus, AlignCenter, Maximize, PencilLine, PanelLeft, ChevronRight, CodeXml, BookOpen, Sun, Download, X};
  const key = name.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('') as keyof typeof icons;
  const Component = icons[key];
  return Component ? <Component aria-hidden="true" strokeWidth={1.6} /> : null;
}
export function Button({id, icon, label, onClick, active, children}: {id?: string; icon?: string; label: string; onClick?: () => void; active?: boolean; children?: ReactNode}) {
  return <button id={id} className={`icon-button${active ? ' active' : ''}`} title={label} aria-label={label} aria-pressed={active} onClick={onClick}>{icon && <Icon name={icon} />}{children}</button>;
}
export function Sidebar({docs, currentId, query, tab, onQuery, onTab, onOpen, onNew, onImport, onOpenFile, onHistory, onDelete, onHelp, headings, onHeading}: {
  docs: DocumentRecord[]; currentId: string; query: string; tab: string; onQuery: (q: string) => void; onTab: (t: 'files' | 'outline') => void;
  onOpen: (id: string) => void; onNew: () => void; onImport: () => void; onOpenFile: () => void; onHistory: () => void; onDelete: () => void; onHelp: () => void;
  headings: {text: string; level: number}[]; onHeading: (index: number) => void;
}) {
  const filtered = docs.filter(d => !d.deleted && (d.title + ' ' + d.markdown).toLowerCase().includes(query.toLowerCase()));
  return <aside id="sidebar" className="sidebar">
    <a className="brand" href="#" aria-label="纸间首页"><span className="brand-mark"><Icon name="leaf" /></span><span>纸间<span className="brand-en">PAPERSPACE</span></span><span className="demo-badge">DEMO</span></a>
    <div className="library-heading"><span>你的写作空间</span><Button id="new-doc" icon="plus" label="新建文档" onClick={onNew} /></div>
    <div className="search-box"><Icon name="search" /><input id="search-docs" placeholder="搜索文档…" aria-label="搜索文档" value={query} onChange={e => onQuery(e.target.value)} /><kbd>⌘ K</kbd></div>
    <div className="sidebar-tabs"><button id="tab-files" className={tab === 'files' ? 'active' : ''} aria-selected={tab === 'files'} onClick={() => onTab('files')}>文档库</button><button id="tab-outline" className={tab === 'outline' ? 'active' : ''} aria-selected={tab === 'outline'} onClick={() => onTab('outline')}>文档大纲</button></div>
    <div className="library-label"><span>所有文档</span><Icon name="chevron-down" /></div>
    <nav id="doc-list" className="doc-list" aria-label="文档列表" hidden={tab !== 'files'}>{filtered.length ? filtered.map(d => <button key={d.id} className={`doc-item ${d.id === currentId ? 'active' : ''}`} data-doc={d.id} onClick={() => onOpen(d.id)}><Icon name="file-text" /><span className="doc-info"><strong>{d.title || '未命名文档'}</strong><small>{d.markdown.replace(/^#+ .*$/gm, '').replace(/[`#*_>\[\]~]/g, '').trim().slice(0, 42) || '在这里写下第一句话'}</small></span>{d.id === currentId && <span className="doc-active-dot" />}</button>) : <p className="empty-state">没有找到文档</p>}</nav>
    <nav id="outline-list" className="outline-list" aria-label="文档大纲" hidden={tab !== 'outline'}>{headings.length ? headings.map((h, i) => <button key={i} className="outline-item" data-heading={i} style={{'--level': h.level - 1} as CSSProperties} onClick={() => onHeading(i)}><span className="outline-hash">h{h.level}</span>{h.text}</button>) : <p className="empty-state">添加标题后，大纲会显示在这里。</p>}</nav>
    <div className="sidebar-bottom"><div className="document-tools"><button id="history-toggle" title="版本历史" onClick={onHistory}><Icon name="history" />版本历史</button><Button id="delete-doc" icon="trash-2" label="删除当前文档" onClick={onDelete} /><Button id="help-btn" icon="circle-help" label="功能与使用说明" onClick={onHelp} /></div><button className="import-button" onClick={onOpenFile}>打开本机 Markdown</button><button id="import-doc" className="import-button" onClick={onImport}><Icon name="upload" />导入 Markdown<span>↗</span></button><div className="local-note"><span className="status-dot" /><span>只在此刻，也只在本地<small>文档自动保存在你的浏览器中</small></span><Icon name="lock-keyhole" /></div></div>
  </aside>;
}

const formats = [['strong', 'bold', '加粗 · Ctrl B'], ['emphasis', 'italic', '斜体 · Ctrl I'], ['strikethrough', 'strikethrough', '删除线'], ['code', 'code', '行内代码'], ['bulletList', 'list', '无序列表'], ['orderedList', 'list-ordered', '有序列表'], ['task', 'list-checks', '任务列表'], ['blockquote', 'quote', '引用'], ['link', 'link', '插入链接 · Ctrl K'], ['image', 'image', '插入图片'], ['table', 'table-2', '插入表格']];
const inserts = [['codeBlock', '代码块'], ['math', '数学公式'], ['mermaid', 'Mermaid 流程图'], ['horizontalRule', '分隔线'], ['footnote', '脚注'], ['toc', '文内目录'], ['highlight', '高亮'], ['underline', '下划线'], ['superscript', '上标'], ['subscript', '下标']];
export function Toolbar({command, find, typewriter, focus, onTypewriter, onFocus, onAdvanced}: {command: (name: string, value?: string) => void; find: () => void; typewriter: boolean; focus: boolean; onTypewriter: () => void; onFocus: () => void; onAdvanced: () => void}) {
  return <div className="format-bar"><div className="format-left">
    {['undo', 'redo'].map((name, i) => <button key={name} data-command={name} title={i ? '重做' : '撤销'} aria-label={i ? '重做' : '撤销'} onPointerDown={e => e.preventDefault()} onClick={() => command(name)}><Icon name={i ? 'redo-2' : 'undo-2'} /></button>)}<span className="toolbar-divider" />
    <select data-command="heading" id="heading-select" className="heading-button" title="切换标题" aria-label="切换标题" defaultValue="0" onChange={e => command('heading', e.target.value)}>{Array.from({length: 7}, (_, i) => <option key={i} value={i}>{i ? `标题 ${i}` : '正文'}</option>)}</select>
    <select id="font-size" aria-label="字号" defaultValue="18" onChange={e => document.documentElement.style.setProperty('--editor-font-size', e.target.value + 'px')}>{[16, 18, 20, 22].map(n => <option key={n}>{n}</option>)}</select><span className="toolbar-divider" />
    {formats.map(([name, icon, title], i) => <span key={name} className="format-group">{[4, 8].includes(i) && <span className="toolbar-divider" />}<button data-command={name} title={title} aria-label={title.split(' · ')[0]} onPointerDown={e => e.preventDefault()} onClick={() => command(name)}><Icon name={icon} /></button></span>)}
    <details className="insert-wrap"><summary id="insert-menu" title="更多插入选项" aria-label="更多插入选项"><Icon name="circle-plus" /></summary><div className="insert-options dropdown">{inserts.map(([name, label]) => <button key={name} data-command={name} onPointerDown={e => e.preventDefault()} onClick={() => command(name)}>{label}</button>)}<button type="button" onClick={onAdvanced}>完整格式 / 表格行列工具</button></div></details>
  </div><div className="format-right"><Button id="find-toggle" icon="search" label="查找与替换 · Ctrl F" onClick={find} /><Button id="typewriter-toggle" icon="align-center" label="打字机模式" active={typewriter} onClick={onTypewriter} /><Button id="focus-toggle" icon="maximize" label="专注模式" active={focus} onClick={onFocus} /></div></div>;
}

export interface ModalState {title: string; fields?: ModalField[]; submit?: string; content?: ReactNode; resolve?: (value: Record<string, string> | null) => void}
export function ModalContent({value, onClose, onSubmit}: {value: ModalState | null; onClose: () => void; onSubmit: (values: Record<string, string>) => void}) {
  return <form id="modal-form" onSubmit={e => {e.preventDefault();onSubmit(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>);}}><div className="modal-icon"><Icon name="pencil-line" /></div><h2 id="modal-title">{value?.title}</h2><div id="modal-body">{value?.content}{value?.fields?.map(f => <label key={f.name} className="modal-field">{f.label}{f.multiline ? <textarea name={f.name} rows={6} defaultValue={f.value || ''} /> : <input name={f.name} defaultValue={f.value || ''} placeholder={f.placeholder || ''} required={f.required} />}</label>)}</div><div className="modal-actions"><button id="modal-cancel" type="button" onClick={onClose}>取消</button><button id="modal-submit" type="submit" hidden={!value?.fields}>{value?.submit || '插入'}</button></div></form>;
}
export function Toast({value, close}: {value: ToastMessage | null; close: () => void}) {
  return <div id="toast" className={`toast${value ? ' visible' : ''}`} role="status" hidden={!value}>{value?.text}{value?.action && <button onClick={() => {value.action!.run();close();}}>{value.action.label}</button>}</div>;
}
