import {Wordgard, menuBar} from 'wordgard/editor';
import {GardState} from 'wordgard/state';
import {parse, serialize, Leaf} from 'wordgard/doc';
import * as commands from 'wordgard/command';
import * as types from 'wordgard/types';
import {fullSchema, codeBlockLanguage, image} from 'wordgard/schema';
import {history} from 'wordgard/history';
import {tables} from 'wordgard/table';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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

// All document mutations go through Wordgard transactions. setHTML is reserved
// for switching documents and committing source mode, and creates fresh history.
export function createEngine(host, {html = '<p></p>', onChange = () => {}, onSelection = () => {}} = {}) {
  let wg, readonly = false, disposed = false, visible = true;
  const readMode = GardState.Compartment.define();
  const run = (command, value = null) => !readonly && commands.Command.dispatch(wg, command, value);
  const config = () => [fullSchema(), tables(), GardState.schemaElement.of(TaskCheckbox), history({minDepth: 200}),
    codeBlockLanguage({languages: ['JavaScript','TypeScript','Python','HTML','CSS','JSON','Bash','Math','Mermaid']}),
    menuBar(), Wordgard.label('Markdown 文档编辑器'),
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
        insert: [TaskCheckbox.of(!found.node.param, found.node.marks)]},
        annotations: history.isolate.of(true), userEvent: 'input.task'});
      return true;
    }),
    image.uploader.of(file => new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
    })),
    readMode.of([GardState.readOnly.of(readonly), Wordgard.editable.of(!readonly)]),
    Wordgard.transactionListener.of((transactions, view) => {
      if (disposed) return;
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
    setHTML(source) { mount(source); },
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
    command(name, value) {
      if (readonly) return false;
      const marks = {strong: types.Strong, emphasis: types.Emphasis, strikethrough: types.Strikethrough, code: types.Code, underline: types.Underline};
      if (marks[name]) return run(commands.toggleMark, marks[name]);
      if (name === 'heading') return run(commands.setTextblockType, +value ? types.Heading.of(Math.max(1, Math.min(6, +value))) : types.Paragraph);
      if (name === 'paragraph') return run(commands.setTextblockType, types.Paragraph);
      if (name === 'bulletList') return run(commands.toggleList, types.BulletList);
      if (name === 'orderedList') return run(commands.toggleList, types.OrderedList.of(1));
      if (name === 'blockquote') return run(commands.toggleBlock, types.Blockquote);
      if (name === 'codeBlock') return run(commands.setTextblockType, types.CodeBlock);
      if (name === 'horizontalRule') return insertHTML('<hr><p></p>');
      if (name === 'link') return run(commands.toggleMark, types.Link.of(value));
      if (name === 'image') return insertHTML(`<p><img src="${escapeHTML(value)}" alt="图片"></p>`);
      if (name === 'table') {
        const rows = Math.max(1, Math.min(30, Number(value?.rows) || 3));
        const cols = Math.max(1, Math.min(12, Number(value?.cols) || 3));
        return insertHTML('<table><tbody>' + Array.from({length: rows}, (_, r) => '<tr>' + Array.from({length: cols}, (_, c) => `<${r ? 'td' : 'th'}>${r ? '' : '列 ' + (c + 1)}</${r ? 'td' : 'th'}>`).join('') + '</tr>').join('') + '</tbody></table><p></p>');
      }
      if (name === 'task') return insertHTML('<ul><li><p><input type="checkbox" data-task-checkbox="true"> 待办事项</p></li></ul>');
      if (name === 'footnote') return insertHTML('<p>[^1]</p><p>[^1]: 脚注内容</p>');
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
