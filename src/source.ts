import {EditorState} from '@codemirror/state';
import {EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection} from '@codemirror/view';
import {history, historyKeymap, defaultKeymap, indentWithTab, undo, redo} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {syntaxHighlighting, defaultHighlightStyle, bracketMatching} from '@codemirror/language';
import {searchKeymap, highlightSelectionMatches} from '@codemirror/search';
import {normalizeLines} from './source-offsets';

// Each document retains its own source history and selection for this session.
export function createSourceEditor(container: HTMLElement, onChange: () => void) {
  const host = document.createElement('div'); host.id = 'markdown-source'; host.hidden = true;
  container.append(host);
  const sessions = new Map<string, {state: EditorState; eol: string}>(); let active: string, silent = false, eol = '\n';
  const sourceOffset = (offset: number) => normalizeLines(api.value).offsets[offset];
  const editorOffset = (offset: number) => normalizeLines(api.value.slice(0, offset)).text.length;
  const extensions = [lineNumbers(), highlightActiveLine(), drawSelection(),
    history(), markdown(), bracketMatching(), syntaxHighlighting(defaultHighlightStyle),
    highlightSelectionMatches(), EditorView.lineWrapping,
    EditorView.contentAttributes.of({'aria-label': 'Markdown 源码', spellcheck: 'false'}),
    keymap.of([...historyKeymap, ...defaultKeymap, ...searchKeymap, indentWithTab]),
    EditorView.updateListener.of(update => {if (update.docChanged && !silent) onChange();})];
  const view = new EditorView({parent: host, extensions});
  const api = {
    view,
    get value(): string {return view.state.doc.toString().replace(/\n/g, eol);},
    set value(value: string) {
      if (value === api.value) return;
      eol = value.includes('\r\n') ? '\r\n' : '\n';
      silent = true;
      try {view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: normalizeLines(value).text}});} finally {silent = false;}
    },
    open(id: string, value: string) {
      if (active) sessions.set(active, {state: view.state, eol});
      active = id;
      const cached = sessions.get(id), normalized = normalizeLines(value).text;
      eol = value.includes('\r\n') ? '\r\n' : '\n';
      view.setState(cached?.state.doc.toString() === normalized ? cached.state : EditorState.create({doc: normalized, extensions}));
    },
    get selectionStart() {return sourceOffset(view.state.selection.main.from);},
    get selectionEnd() {return sourceOffset(view.state.selection.main.to);},
    get selectionAnchor() {return sourceOffset(view.state.selection.main.anchor);},
    get selectionHead() {return sourceOffset(view.state.selection.main.head);},
    setSelectionRange(from: number, to: number) {view.dispatch({selection: {anchor: editorOffset(from), head: editorOffset(to)}, scrollIntoView: true});},
    setRangeText(text: string, from: number, to: number) {
      const start = editorOffset(from), insert = normalizeLines(text).text;
      view.dispatch({changes: {from: start, to: editorOffset(to), insert}, selection: {anchor: start + insert.length}, scrollIntoView: true});
    },
    get hidden() {return host.hidden;}, set hidden(value) {host.hidden = value; if (!value) view.requestMeasure();},
    focus() {view.focus();}, undo() {undo(view);}, redo() {redo(view);},
    destroy() {view.destroy();host.remove();sessions.clear();},
  };
  return api;
}
