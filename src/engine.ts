import {Wordgard, menuBar, keyBindingHelp, Decoration, decoratePlots, Widget, Dialog, InputRule} from 'wordgard/editor';
import {GardState} from 'wordgard/state';
import {parse, serialize, Leaf, Mark, Node, Plot} from 'wordgard/doc';
import * as commands from 'wordgard/command';
import * as types from 'wordgard/types';
import {fullSchema, codeBlockLanguage, image} from 'wordgard/schema';
import {history} from 'wordgard/history';
import {tables} from 'wordgard/table';
import {highlightCode, JavaScript, TypeScript, Python, HTML, CSS, JSON as JSONLanguage, Shell} from 'wordgard/highlight-code';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import {toHTML, renderEnhancements} from './markdown';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const Highlight = Mark.define('Highlight', {shape: {element: 'mark'}});
const CellAlignment = Mark.Type.define<string>('CellAlignment', {
  target: [types.Cell,types.HeaderCell], validate: 'string',
  shape: {attribute:'align',value:0},
});
const TableOfContents = Leaf.Type.define<string>('TableOfContents', {
  validate: 'string', group: Node.Group.Content, selectable: true,
  shape: {element: 'div', selector: 'div[data-markdown-toc]',
    attributes: marker => ({'data-markdown-toc': marker}), readElement: el => el.getAttribute('data-markdown-toc')},
  toText: node => String(node.param),
});
const tocWidget = Widget.define<{label: string; level: number; pos: number}[]>({render(headings, view) {
  const nav = document.createElement('nav');nav.className='document-toc';nav.setAttribute('aria-label','目录');
  if (!headings.length) nav.textContent='添加标题后将在这里生成目录';
  for (const {label, level, pos} of headings) {
    const button=document.createElement('button');button.type='button';button.textContent=label;
    button.style.paddingLeft=(level-1)*16+'px';
    button.onclick=()=>{view.dispatch({selection:{anchor:pos+1},scrollIntoView:true});view.focus();};
    nav.append(button);
  }
  return nav;
}, eq:(a,b)=>JSON.stringify(a)===JSON.stringify(b),propagateEvent:false});
const tocDecorations = Decoration.Point.source.of(state => Decoration.Point.set(add => {
  const headings=[], markers=[];
  state.doc.iterate((node,pos)=>{
    if(node.isPlot && node.type===types.Heading)headings.push({label:node.textContent(),level:node.tag.param,pos});
    if(node.type===TableOfContents)markers.push(pos);
  });
  for(const pos of markers)add(Decoration.Point.shape(tocWidget.of(headings)),pos);
}));
const FootnoteDefinition = Plot.Type.define<string>('FootnoteDefinition', {
  validate: 'string', group: Node.Group.Content, blockContent: Node.Group.Content,
  defining: true,
  shape: {element: 'section', selector: 'section[data-footnote-definition]',
    attributes: label => ({'data-footnote-definition': label}),
    readElement: el => el.getAttribute('data-footnote-definition')}
});

// Derived decorations never become saved content. Source remains editable.
const blockPreviewWidget = Widget.define<{language: string; source: string}>({
  render(value) {
    const box = document.createElement('span'); box.className = 'wg-block-preview';
    box.setAttribute('aria-label', value.language === 'mermaid' ? '图表预览' : '公式预览');
    const pre = document.createElement('pre'); pre.dataset.language = value.language; pre.textContent = value.source; box.append(pre);
    renderEnhancements(box).catch(error => {box.textContent = `预览失败：${error.message}`;});
    return box;
  },
  eq: (a, b) => a.language === b.language && a.source === b.source,
  propagateEvent: false,
});
const liveBlocks = decoratePlots({type: types.CodeBlock, points(plot, add) {
  const language = String(plot.marks.find(mark => mark.type === types.CodeBlockLanguage)?.value || '').toLowerCase();
  if (['math', 'latex', 'mermaid', 'html-block'].includes(language)) add(Decoration.Point.widget(
    blockPreviewWidget.of({language, source: plot.textContent()}), {side: 1}), plot.contentLength);
}});

// A real model node, rather than a DOM-only checkbox: checked state participates
// in serialization, selection mapping and undo history alongside the document.
const TaskCheckbox = Leaf.Type.define('TaskCheckbox', {
  inline: true, validate: 'boolean', defaultParam: false,
  shape: {element: 'input', selector: 'input[type=checkbox]', readElement: element => element.hasAttribute('checked'), attributes: checked => ({type: 'checkbox',
    'data-task-checkbox': 'true', 'aria-label': '切换任务完成状态',
    ...(checked ? {checked: ''} : {})})},
  parseRules: [{selector: 'input[type=checkbox]', precedence: 1, readElement: element => element.hasAttribute('checked')}],
  toText: node => node.param ? '[x]' : '[ ]'
});

// Native footnote reference: a real inline mark whose parameter is the
// footnote label. Renders as a superscripted `[^label]` and participates in
// the document model, undo history and serialization like links do, instead of
// being plain text or an ad-hoc `<a href="#fn-…">` link.
const Footnote = Mark.Type.define<string>('Footnote', {
  rank: 24,
  validate: 'string',
  inclusive: false,
  shape: {
    element: 'span',
    selector: 'span[data-footnote-ref]',
    attributes: label => ({'data-footnote-ref': label, class: 'wg-footnote-ref'}),
    readElement: dom => dom.getAttribute('data-footnote-ref')
  }
});

// Conservative inline-math delimiters, matching the read-only preview: no
// whitespace/digit right after the opening `$`, no nested dollars, no digit
// right after the closing `$`. Keeps currency like `$20` or `$20 $30` as text.
const inlineMathPattern = /(?<![\\\w$])\$(?![\s\d$])([^$\n]*?[^\s$\n])\$(?![\d$])/g;

// Highlight fallback text ranges; parsing and input rules normally convert
// recognized pairs into InlineMath atoms with KaTeX widgets below.
const inlineMathHighlight = decoratePlots({
  type: Node.Group.Textblock,
  ranges: (plot, add) => {
    if (plot.type === types.CodeBlock.type) return;
    let text = '', positions = [];
    plot.iterate((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < String(child.param).length; i++) positions.push(offset + i);
        text += child.param;
      } else if (child.isLeaf) {
        positions.push(offset);
        text += '\ufffc';
      }
    });
    for (const m of text.matchAll(inlineMathPattern)) {
      add(Decoration.Range.attribute('class', 'wg-inline-math'), positions[m.index], positions[m.index + m[0].length - 1] + 1);
    }
  }
});

// Inline math as a real atomic node: the LaTeX source is the parameter, the
// rendered KaTeX is a widget shape, and the node participates in the document
// model, undo history and markdown serialization (via `toText` and the
// `<span data-inline-math>` shape).
const InlineMath = Leaf.Type.define<string>('InlineMath', {
  inline: true,
  validate: 'string',
  selectable: true,
  shape: {
    element: 'span',
    selector: 'span[data-inline-math]',
    attributes: src => ({'data-inline-math': src}),
    readElement: el => el.getAttribute('data-inline-math')
  },
  toText: node => '$' + node.param + '$'
});

const rulePatterns: [RegExp, Mark][] = [
  [/\*\*(\S(?:[^\n]*?\S)?)\*\*$/, types.Strong],
  [/(?<![\w*])\*([^*\s](?:[^*\n]*?[^*\s])?)\*$/, types.Emphasis],
  [/~~(\S(?:[^\n]*?\S)?)~~$/, types.Strikethrough],
  [/==(\S(?:[^\n]*?\S)?)==$/, Highlight],
  [/`([^`\n]+)`$/, types.Code],
];
const inlineRules = rulePatterns.map(([expr, mark]) => InputRule.define({expr, apply(state, match) {
  const {from,to}=match[0], text=match[1].text;
  if (from.pos && state.doc.textContent({from:from.pos-1,to:from.pos}) === '\\') return null;
  return {changes:{from:from.pos,to:to.pos,insert:[Leaf.text(text,[...from.marks(to),mark])]},
    selection:{anchor:from.pos+text.length},annotations:history.isolate.of(true),userEvent:'input.markdown'};
}}));
const taskInputRule = InputRule.define({expr:/^\[([ xX])\] $/,apply(state,match) {
  const {from,to}=match[0];
  if(!from.matchingParent(p=>p.type===types.ListItem.type))return null;
  return {changes:{from:from.pos,to:to.pos,insert:[TaskCheckbox.of(match[1].text.toLowerCase()==='x'),Leaf.text(' ')]},
    selection:{anchor:from.pos+2},annotations:history.isolate.of(true),userEvent:'input.task'};
}});

const inlineMathWidget = Widget.define<string>({
  render(src) {
    const span = document.createElement('span');
    span.className = 'wg-inline-math-render';
    span.setAttribute('data-inline-math', src);
    try { katex.render(src, span, {throwOnError: false, trust: false}); }
    catch (e) { span.textContent = '$' + src + '$'; }
    return span;
  },
  eq: (a, b) => a === b
});
const inlineMathShape = Decoration.Tag.shape(InlineMath, tag => inlineMathWidget.of(tag.param));

// Typing a closing `$` after `$…` converts the pair into an inline-math atom,
// so math entered directly in the editable view also renders live (like it does
// when parsed from Markdown). Conservative: no whitespace/digit after the
// opening `$`, no digit after the closing `$`, not preceded by a word char.
const inlineMathInputRule = InputRule.define({
  expr: /(?<![\w\\$])\$(?![\s\d$])([^$\n]*?[^\s$\n])\$$/,
  apply: (state, match) => {
    const {from, to} = match[0];
    const tex = match[1] && match[1].text;
    if (!tex) return null;
    return {
      changes: {from: from.pos, to: to.pos, insert: [InlineMath.of(tex)]},
      selection: {anchor: from.pos + 1},
      annotations: history.isolate.of(true),
      userEvent: 'input.math'
    };
  }
});

// Clicking a rendered inline-math atom opens a small dialog to edit its LaTeX
// source; submitting replaces the atom's parameter in a single undoable step.
function editInlineMath(view, node) {
  const pos = node.pos, source = node.node.param;
  if (Dialog.get(view, editInlineMath)) return true;
  Dialog.show(view, {
    key: editInlineMath,
    label: 'LaTeX 公式',
    input: {type: 'text', name: 'tex', value: source},
    submitLabel: '更新',
    class: 'wg-math-dialog',
    focus: true,
    tooltip: {pos}
  }).result.then(form => {
    view.focus();
    const tex = form && (form.elements.namedItem('tex') as HTMLInputElement)?.value;
    if (tex !== undefined && tex !== source)
      view.dispatch({changes: {from: pos, to: pos + 1, insert: [InlineMath.of(tex)]}, userEvent: 'input.math'});
  });
  return true;
}

// User edits go through Wordgard transactions. Loading a different document
// mounts or restores its session; committing source replaces content in history.
export function createEngine(host: HTMLElement, {html = '<p></p>', onChange = (_html: string) => {}, onSelection = (_selection: {from: number; to: number}) => {}} = {}) {
  let wg, readonly = false, disposed = false, visible = true;
  const sessions = new Map(); let activeDocument;
  const readMode = GardState.Compartment.define();
  const run = (command, value = null) => !readonly && commands.Command.dispatch(wg, command, value);
  const config = () => [fullSchema(), tables(), GardState.schemaElement.of([TaskCheckbox, Footnote, FootnoteDefinition, InlineMath, Highlight, TableOfContents, CellAlignment]), history({minDepth: 200}),
    codeBlockLanguage({languages: ['JavaScript','TypeScript','Python','HTML','CSS','JSON','Shell','Math','Mermaid']}),
    highlightCode({languages: [JavaScript, TypeScript, Python, HTML, CSS, JSONLanguage, Shell]}),
    inlineMathHighlight, inlineMathShape, inlineMathInputRule, inlineRules, taskInputRule, liveBlocks, tocDecorations,
    Wordgard.clipboardTextParser.of((text, state) => {
      if (state.doc.resolve(state.selection.head).matchingParent(p => p.type === types.CodeBlock.type)) return null;
      if (!/(^|\n)(?:#{1,6} |[-*+] |\d+\. |> |```|~~~|\$\$)|\*\*[^*]+\*\*|\[[^\]]+\]\(/.test(text)) return null;
      const template = document.createElement('template'); template.innerHTML = toHTML(text);
      return parse.slice(state.schema, template.content);
    }),
    menuBar(), keyBindingHelp(), Wordgard.label('Markdown 文档编辑器'),
    Wordgard.domEventHandler('mousedown', event => {
      if (event.target instanceof Element && event.target.matches('input[type=checkbox]')) {
        event.preventDefault(); return true;
      }
    }),
    Wordgard.domEventHandler('click', (event, view) => {
      if (!(event.target instanceof Element) || !event.target.matches('input[type=checkbox]')) return false;
      event.preventDefault();
      if (view.state.readOnly) return true;
      const found = view.nodeFromDOM(event.target);
      if (!found || found.node.type !== TaskCheckbox) return false;
      view.dispatch({changes: {from: found.pos, to: found.pos + 1,
        insert: [TaskCheckbox.of(!(found.node as Leaf).param, found.node.marks)]},
        annotations: history.isolate.of(true), userEvent: 'input.task'});
      return true;
    }),
    Wordgard.domEventHandler('click', (event, view) => {
      if (!(event.target instanceof Element)) return false;
      const found = view.nodeFromDOM(event.target);
      if (!found || found.node.type !== InlineMath) return false;
      event.preventDefault();
      if (view.state.readOnly) return true;
      editInlineMath(view, found);
      return true;
    }),
    image.uploader.of(file => new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
    })),
    readMode.of([GardState.readOnly.of(readonly), Wordgard.editable.of(!readonly)]),
    Wordgard.transactionListener.of((transactions, view) => {
      if (disposed || view !== wg) return;
      if (transactions.some(tr => tr.docChanged)) onChange(serialize(view.state.doc).toHTML());
      const {from, to} = view.state.selection; onSelection({from, to});
    })];
  function mount(source) {
    if (wg) wg.dom.remove();
    wg = Wordgard.create({doc: source || '<p></p>', config: config()});
    wg.dom.classList.add('demo-wordgard');
    if (visible) host.append(wg.dom);
    // Wordgard schedules its initial layout itself. A forced flush while the
    // host is hidden (source/preview mode) cannot measure cursor line geometry.
  }
  function insertHTML(source) {
    if (readonly) return false;
    const template = document.createElement('template'); template.innerHTML = source;
    const insert = parse.slice(wg.state.schema, template.content);
    const {from, to} = wg.state.selection.replacementRange;
    wg.dispatch({changes: {from, to, insert, fit: true}, scrollIntoView: true,
      annotations: history.isolate.of(true), userEvent: 'input.insert'});
    wg.focus(); return true;
  }
  function matches(query) {
    if (!query) return [];
    const result = [];
    // Search each textblock as one string, including across inline mark splits.
    wg.state.doc.iterate((node, pos) => {
      if (!node.isTextblock) return;
      let text = '', positions = [];
      node.iterate((child, offset) => {
        if (child.isText) {
          for (let i = 0; i < child.param.length; i++) positions.push(pos + 1 + offset + i);
          text += child.param;
        } else if (child.isLeaf) { positions.push(pos + 1 + offset); text += '\ufffc'; }
      });
      let at = 0;
      while ((at = text.indexOf(query, at)) !== -1) {
        result.push({from: positions[at], to: positions[at + query.length - 1] + 1}); at += query.length;
      }
      return false;
    });
    return result;
  }
  const api = {
    get wg() { return wg; },
    getHTML: () => serialize(wg.state.doc).toHTML(),
    getJSON: () => wg.state.doc.toJSON(),
    getText: () => wg.state.doc.textContent(),
    setHTML(source, {recordHistory = false} = {}) {
      if (!recordHistory) return mount(source);
      const template = document.createElement('template'); template.innerHTML = source || '<p></p>';
      const doc = parse(wg.state.schema, template.content);
      if (serialize(doc).toHTML() === api.getHTML()) return;
      wg.dispatch({changes: {from: 0, to: wg.state.doc.length, insert: doc.content},
        selection: {anchor: 1}, annotations: history.isolate.of(true), userEvent: 'input.source'});
    },
    openDocument(id, source) {
      if (activeDocument) sessions.set(activeDocument, wg);
      wg.dom.remove(); activeDocument = id;
      const cached = sessions.get(id);
      const template = document.createElement('template'); template.innerHTML = source;
      if (cached && serialize(cached.state.doc).toHTML() === serialize(parse(cached.state.schema, template.content)).toHTML()) wg = cached;
      else mount(source);
      if (visible && wg.dom.parentNode !== host) host.append(wg.dom);
      api.setReadonly(readonly);
    },
    focus() { wg.focus(); },
    setVisible(value) {
      visible = !!value;
      // The Wordgard custom element owns its observer/plugin lifecycle.
      // Detaching pauses layout while retaining the exact state and history.
      if (visible && !disposed && wg.dom.parentNode !== host) host.append(wg.dom);
      else if (!visible) wg.dom.remove();
    },
    undo: () => run(commands.undo), redo: () => run(commands.redo),
    setReadonly(value) {
      readonly = !!value;
      wg.dispatch({effects: readMode.reconfigure([GardState.readOnly.of(readonly), Wordgard.editable.of(!readonly)])});
    },
    destroy() { disposed = true; wg.dom.remove(); },
    insertHTML,
    // Open Wordgard's native image dialog, which supports source URL, file
    // upload (via image.uploader), alt text, inline/figure alignment, caption
    // and width resizing — richer than a URL-only modal.
    insertImageDialog() { if (readonly) return false; return image.insert(wg, null); },
    command(name: string, value: any = undefined) {
      if (readonly) return false;
      const marks = {strong: types.Strong, emphasis: types.Emphasis, strikethrough: types.Strikethrough, code: types.Code, underline: types.Underline, highlight: Highlight, subscript: types.Subscript, superscript: types.Superscript};
      if (marks[name]) return run(commands.toggleMark, marks[name]);
      if (name === 'heading') return run(commands.setTextblockType, +value ? types.Heading.of(Math.max(1, Math.min(6, +value))) : types.Paragraph);
      if (name === 'paragraph') return run(commands.setTextblockType, types.Paragraph);
      if (name === 'bulletList') return run(commands.toggleList, types.BulletList);
      if (name === 'orderedList') return run(commands.toggleList, types.OrderedList.of(1));
      if (name === 'blockquote') return run(commands.toggleBlock, types.Blockquote);
      if (name === 'codeBlock') return run(commands.setTextblockType, types.CodeBlock);
      if (name === 'horizontalRule') return insertHTML('<hr><p></p>');
      if (name === 'toc') return insertHTML('<div data-markdown-toc="[TOC]">[TOC]</div><p></p>');
      if (name === 'link') return run(commands.toggleMark, types.Link.of(value));
      if (name === 'image') return insertHTML(`<p><img src="${escapeHTML(value)}" alt="图片"></p>`);
      if (name === 'table') {
        const rows = Math.max(1, Math.min(30, Number(value?.rows) || 3));
        const cols = Math.max(1, Math.min(12, Number(value?.cols) || 3));
        return insertHTML('<table><tbody>' + Array.from({length: rows}, (_, r) => '<tr>' + Array.from({length: cols}, (_, c) => `<${r ? 'td' : 'th'}>${r ? '' : '列 ' + (c + 1)}</${r ? 'td' : 'th'}>`).join('') + '</tr>').join('') + '</tbody></table><p></p>');
      }
      if (name === 'task') return insertHTML('<ul><li><p><input type="checkbox" data-task-checkbox="true"> 待办事项</p></li></ul>');
      if (name === 'footnote') {
        let label = 1; const html = api.getHTML();
        while (html.includes(`data-footnote-ref="${label}"`) || html.includes(`data-footnote-definition="${label}"`)) label++;
        return insertHTML(`<p><span data-footnote-ref="${label}">[^${label}]</span></p><section data-footnote-definition="${label}"><p>脚注内容</p></section>`);
      }
      if (name === 'math' || name === 'mermaid') return insertHTML(`<pre data-language="${name}">${escapeHTML(value || (name === 'math' ? 'E = mc^2' : 'graph LR\n  A[开始] --> B[完成]'))}</pre><p></p>`);
      if (name === 'undo') return api.undo();
      if (name === 'redo') return api.redo();
      return false;
    },
    find(query, next = true) {
      const found = matches(query);
      if (!found.length) return {count: 0, index: -1};
      const selection = wg.state.selection;
      let index = next ? found.findIndex(m => m.from >= selection.to) : found.findLastIndex(m => m.to <= selection.from);
      if (index < 0) index = next ? 0 : found.length - 1;
      const match = found[index];
      wg.dispatch({selection: {anchor: match.from, head: match.to}, scrollIntoView: true});
      wg.focus(); return {count: found.length, index, ...match};
    },
    replaceSelection(text, query) {
      const {from, to} = wg.state.selection.replacementRange;
      if (query !== undefined && (!query || wg.state.doc.textContent({from, to, blockSeparator: '\n'}) !== String(query))) return false;
      return run(commands.insertText, {from, to, insert: String(text), userEvent: 'input.replace'});
    },
    replaceAll(query, replacement) {
      if (readonly) return 0;
      const found = matches(query); if (!found.length) return 0;
      wg.dispatch({changes: found.map(({from,to}) => ({from,to,insert: replacement ? [Leaf.text(String(replacement), wg.state.doc.resolve(from).marks(wg.state.doc.resolve(to)))] : [], fit: true})),
        annotations: history.isolate.of(true), userEvent: 'input.replace.all'});
      return found.length;
    }
  };
  mount(html);
  return api;
}
