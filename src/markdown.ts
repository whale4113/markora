import { Marked, Lexer } from 'marked';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import {normalizeLines} from './source-offsets';

const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parser = new Marked({ gfm: true, breaks: false });
export const tokenizeInline = (source,links) => {const lexer=new Lexer(parser.defaults);if(links)lexer.tokens.links=links;return lexer.inlineTokens(source);};
const referenceCache=new Map();
export function referenceLinks(source){
  if(referenceCache.has(source))return referenceCache.get(source);
  const links=parser.lexer(normalizeLines(source).text).links;
  if(referenceCache.size>50)referenceCache.clear();referenceCache.set(source,links);return links;
}
export function tokenizeBlocks(source) {
  const original=source,{text,offsets}=normalizeLines(source);source=text;
  const result=[];let offset=0;
  const meta=/^(---|\+\+\+)[ \t]*\n[\s\S]*?\n\1[ \t]*(?:\n|$)/.exec(source);
  if(meta){result.push({raw:meta[0],kind:'metadata'});offset=meta[0].length;}
  const rest=source.slice(offset);let cursor=0;
  for(const token of parser.lexer(rest)){
    let tokenRaw=token.raw,at=rest.indexOf(tokenRaw,cursor);
    // Marked synthesizes a final newline for an empty GFM task item. Match
    // its real source extent instead of treating that item as an unknown gap.
    if(at<0){
      const candidate=tokenRaw.trimEnd(),found=rest.indexOf(candidate,cursor);
      if(candidate&&found>=0){at=found;let end=at+candidate.length;while(/[ \t]/.test(rest[end]||'\0'))end++;tokenRaw=rest.slice(at,end);}
    }
    if(at<0)continue;
    if(at>cursor)result.push({raw:rest.slice(cursor,at),kind:'definition'});
    result.push({raw:tokenRaw,kind:token.type,token});cursor=at+tokenRaw.length;
  }
  if(cursor<rest.length)result.push({raw:rest.slice(cursor),kind:'definition'});
  let consumed=0;
  for(const block of result){const length=block.raw.length;block.raw=original.slice(offsets[consumed],offsets[consumed+length]);consumed+=length;}
  return result.length?result:[{raw:'',kind:'paragraph'}];
}
parser.use({ extensions: [{
  name:'superscript',level:'inline',start:src=>src.indexOf('^'),
  tokenizer(src){const match=/^\^([^\s^]+)\^/.exec(src);if(match)return {type:'superscript',raw:match[0],text:match[1]};},
  renderer:token=>`<sup>${escapeHTML(token.text)}</sup>`,
}, {
  name:'subscript',level:'inline',start:src=>src.indexOf('~'),
  tokenizer(src){const match=/^~(?!~)([^\s~]+)~(?!~)/.exec(src);if(match)return {type:'subscript',raw:match[0],text:match[1]};},
  renderer:token=>`<sub>${escapeHTML(token.text)}</sub>`,
}, {
  name: 'highlight', level: 'inline', start: src => src.indexOf('=='),
  tokenizer(src) {
    const match = /^==(?=\S)([^\n]+?\S|\S)==/.exec(src);
    if (match) return {type: 'highlight', raw: match[0], tokens: this.lexer.inlineTokens(match[1])};
  },
  renderer(token) {return `<mark>${this.parser.parseInline(token.tokens)}</mark>`;},
}, {
  name: 'tableOfContents', level: 'block',
  start: src => src.search(/^\s*\[(?:toc|TOC)\][ \t]*$/m),
  tokenizer(src) {
    const match = /^ {0,3}\[(toc|TOC)\][ \t]*(?:\n|$)/.exec(src);
    if (match) return {type: 'tableOfContents', raw: match[0], marker: `[${match[1]}]`};
  },
  renderer: token => `<div data-markdown-toc="${token.marker}">${token.marker}</div>\n`,
}, {
  name: 'displayMath', level: 'block',
  start: src => src.indexOf('$$'),
  tokenizer(src) {
    const match = /^\$\$[ \t]*\n([\s\S]*?)\n\$\$[ \t]*(?:\n|$)/.exec(src);
    if (match) return { type: 'displayMath', raw: match[0], text: match[1] };
  },
  renderer: token => `<pre data-language="math"><code class="language-math">${escapeHTML(token.text)}</code></pre>\n`,
}, {
  name: 'inlineMath', level: 'inline',
  start(src) {
    for (let i = 0; i < src.length; i++) {
      if (src[i] !== '$') continue;
      const prev = i > 0 ? src[i - 1] : '';
      const next = src[i + 1] || '';
      if (!/[\\\w$]/.test(prev) && !/[\s\d$]/.test(next)) return i;
    }
    return -1;
  },
  tokenizer(src) {
    const match = /^\$(?![\s\d$])([^$\n]*?[^\s$\n])\$(?![\d$])/.exec(src);
    if (match) return { type: 'inlineMath', raw: match[0], text: match[1] };
  },
  renderer: token => `<span data-inline-math="${escapeHTML(token.text)}">${escapeHTML(token.raw)}</span>`,
}, {
  name: 'footnoteReference', level: 'inline',
  start: src => src.indexOf('[^'),
  tokenizer(src) {
    const match = /^\[\^([\w\u0080-\uffff-]+)\]/.exec(src);
    if (match) return { type: 'footnoteReference', raw: match[0], label: match[1] };
  },
  renderer: token => `<span data-footnote-ref="${escapeHTML(token.label)}">[^${escapeHTML(token.label)}]</span>`,
}], renderer: {
  html({text, block}) {
    if (!block) return text;
    // Keep raw block HTML editable as source; rendering is a separate sanitized view.
    return `<pre data-language="html-block">${escapeHTML(text.replace(/\n$/, ''))}</pre>\n`;
  },
  code({ text, lang }) {
    const language = (lang || '').split(/\s/)[0];
    return `<pre${language ? ` data-language="${escapeHTML(language)}"` : ''}><code${language ? ` class="language-${escapeHTML(language)}"` : ''}>${escapeHTML(text)}</code></pre>\n`;
  },
} });

/** Parse author text into sanitized, editable HTML. Math and diagrams remain code. */
export function toHTML(markdown = '') {
  let source = String(markdown).replace(/\r\n?/g, '\n'), metadata = '';
  const frontmatter = /^(---|\+\+\+)[ \t]*\n([\s\S]*?)\n\1[ \t]*(?:\n|$)/.exec(source);
  if (frontmatter) {
    metadata = `<pre data-language="${frontmatter[1] === '---' ? 'yaml-frontmatter' : 'toml-frontmatter'}">${escapeHTML(frontmatter[2])}</pre>\n`;
    source = source.slice(frontmatter[0].length);
  }
  const lines = source.split('\n');
  const body = [], notes = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const boundary = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (boundary) {
      if (!fence) fence = boundary[1];
      else if (boundary[1][0] === fence[0] && boundary[1].length >= fence.length) fence = null;
      body.push(line); continue;
    }
    const definition = !fence && /^\[\^([\w\u0080-\uffff-]+)\]:\s*(.*)$/.exec(line);
    if (definition) {
      let text = definition[2];
      while (i + 1 < lines.length) {
        if (/^(?: {4}|\t)/.test(lines[i + 1])) text += '\n' + lines[++i].replace(/^(?: {4}|\t)/, '');
        else if (lines[i + 1] === '' && /^(?: {4}|\t)/.test(lines[i + 2] || '')) {text += '\n'; i++;}
        else break;
      }
      notes.push({ label: definition[1], text });
    } else body.push(line);
  }
  // Literal footnote markers survive Wordgard's schema even when custom HTML
  // attributes and container elements are discarded during parse/serialization.
  const footnotes = notes.map(note => `<section data-footnote-definition="${escapeHTML(note.label)}">${parser.parse(note.text)}</section>`).join('');
  return DOMPurify.sanitize(metadata + parser.parse(body.join('\n')) + footnotes, {
    USE_PROFILES: { html: true }, ADD_ATTR: ['data-language', 'data-footnote-ref', 'data-footnotes', 'data-footnote-definition', 'data-inline-math'],
  });
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', strongDelimiter: '**' });
turndown.use(gfm);
turndown.addRule('listItem', {filter: 'li', replacement(content, node) {
  const parent = node.parentElement;
  const index = Array.prototype.indexOf.call(parent.children, node);
  const prefix = parent.nodeName === 'OL' ? `${Number(parent.getAttribute('start') || 1) + index}. ` : '- ';
  content = content.trim();
  return prefix + content.replace(/\n/g, '\n' + ' '.repeat(prefix.length)) + '\n';
}});
turndown.addRule('tableOfContents', {filter: node => node.hasAttribute('data-markdown-toc'),
  replacement: (content, node) => `\n\n${node.getAttribute('data-markdown-toc')}\n\n`});
turndown.addRule('nestedTaskCheckbox', {
  filter: node => node instanceof HTMLInputElement && node.type === 'checkbox' && Boolean(node.closest('li')),
  replacement: (content, node) => `${(node as HTMLInputElement).checked ? '[x]' : '[ ]'} `,
});
turndown.addRule('doubleStrikethrough', { filter: node => ['DEL', 'S', 'STRIKE'].includes(node.nodeName), replacement: content => `~~${content}~~` });
turndown.addRule('highlight', {filter: 'mark', replacement: content => `==${content}==`});
for (const tag of ['sub', 'sup', 'u'] as const) turndown.addRule(tag, {filter: tag, replacement: content => `<${tag}>${content}</${tag}>`});
turndown.addRule('thematicBreak', { filter: 'hr', replacement: () => '\n\n---\n\n' });
turndown.addRule('preserveCodeLanguage', {
  filter: node => node.nodeName === 'PRE',
  replacement(content, node) {
    const code = node.querySelector('code') || node;
    const language = code.getAttribute('data-language') || node.getAttribute('data-language') || /(?:^|\s)language-([^\s]+)/.exec(code.className)?.[1] || '';
    const value = code.textContent.replace(/\n$/, '');
    if (language === 'html-block') return `\n\n${value}\n\n`;
    if (language === 'yaml-frontmatter' || language === 'toml-frontmatter') {
      const delimiter = language === 'yaml-frontmatter' ? '---' : '+++';
      return `\n\n${delimiter}\n${value}\n${delimiter}\n\n`;
    }
    if (language === 'math' || language === 'latex') return `\n\n$$\n${value}\n$$\n\n`;
    const longest = Math.max(2, ...Array.from(value.matchAll(/`+/g), match => match[0].length));
    const fence = '`'.repeat(longest + 1);
    return `\n\n${fence}${language}\n${value}\n${fence}\n\n`;
  },
});
turndown.addRule('footnoteRef', {
  filter: node => node.nodeName === 'SPAN' && node.hasAttribute('data-footnote-ref'),
  replacement: (content, node) => `[^${node.getAttribute('data-footnote-ref')}]`,
});
turndown.addRule('inlineMath', {
  filter: node => node.nodeName === 'SPAN' && node.hasAttribute('data-inline-math'),
  replacement: (content, node) => '$' + node.getAttribute('data-inline-math') + '$',
});
turndown.addRule('footnoteDefinition', {
  filter: node => node.hasAttribute('data-footnote-definition'),
  replacement(content, node) {
    const clone = node.cloneNode(true) as HTMLElement;
    if (clone.firstElementChild?.matches('p') && clone.firstElementChild.textContent === `[${node.getAttribute('data-footnote-definition')}]`) clone.firstElementChild.remove();
    const text = turndown.turndown(clone.innerHTML).trim().replace(/\n/g, '\n    ');
    return `\n\n[^${node.getAttribute('data-footnote-definition')}]: ${text}\n\n`;
  },
});
turndown.addRule('footnoteSection', { filter: node => node.hasAttribute('data-footnotes'), replacement: content => `\n\n${content.replace(/^\s*\* \* \*\s*/, '')}\n\n` });

/** Export the editor's HTML, not an enhanced preview, back to GFM Markdown. */
export function toMarkdown(html = '') {
  return turndown.turndown(DOMPurify.sanitize(String(html), { USE_PROFILES: { html: true } }))
    .trim() + '\n';
}

let mermaidPromise;
let diagramId = 0;
/** Only call on a read-only preview; this function replaces code nodes in its target. */
export async function renderEnhancements(container) {
  const headings = [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  headings.forEach((heading, index) => {heading.id = `section-${index + 1}`;});
  for (const toc of container.querySelectorAll('[data-markdown-toc]')) {
    const nav = document.createElement('nav');nav.className = 'document-toc';nav.setAttribute('aria-label','目录');
    for (const heading of headings) {
      const link=document.createElement('a');link.href='#'+heading.id;link.textContent=heading.textContent;
      link.style.paddingLeft=(Number(heading.tagName[1])-1)*16+'px';nav.append(link);
    }
    toc.replaceChildren(nav);
  }
  for (const raw of container.querySelectorAll('pre[data-language="html-block"]')) {
    const rendered = document.createElement('div'); rendered.className = 'html-preview';
    rendered.innerHTML = DOMPurify.sanitize(raw.textContent, {USE_PROFILES: {html: true}});raw.replaceWith(rendered);
  }
  for (const note of container.querySelectorAll('section[data-footnote-definition]')) {
    note.id = `fn-${encodeURIComponent(note.getAttribute('data-footnote-definition'))}`;
    note.classList.add('footnote-definition');
  }
  for (const paragraph of container.querySelectorAll('p')) {
    const definition = /^\[\^([\w\u0080-\uffff-]+)\]:/.exec(paragraph.textContent);
    if (definition) paragraph.id = `fn-${encodeURIComponent(definition[1])}`;
  }
  // Turn native footnote references (span[data-footnote-ref], which the editor
  // keeps for model/undo fidelity) into clickable anchors in read-only output.
  for (const ref of container.querySelectorAll('span[data-footnote-ref]')) {
    const label = ref.getAttribute('data-footnote-ref');
    const link = document.createElement('a');
    link.className = 'footnote-ref';
    link.href = `#fn-${encodeURIComponent(label)}`;
    link.textContent = ref.textContent;
    ref.replaceWith(link);
  }
  // Match both the original HTML and Wordgard's serialized pre[data-language].
  for (const pre of container.querySelectorAll('pre[data-language="math"], pre[data-language="latex"], pre:has(> code.language-math), pre:has(> code.language-latex)')) {
    const code = pre.querySelector('code') || pre;
    const display = document.createElement('div');
    display.className = 'math-preview';
    katex.render(code.textContent, display, { displayMode: true, throwOnError: false, trust: false });
    pre.replaceWith(display);
  }
  // Inline math now arrives as `<span data-inline-math>` (the editor keeps the
  // LaTeX source in the attribute); render each span with KaTeX here.
  for (const math of container.querySelectorAll('span[data-inline-math]')) {
    const source = math.getAttribute('data-inline-math');
    math.classList.add('math-inline');
    math.textContent = '';
    try { katex.render(source, math, { throwOnError: false, trust: false }); }
    catch (e) { math.textContent = '$' + source + '$'; }
  }
  const diagrams = [...container.querySelectorAll('pre[data-language="mermaid"], pre:has(> code.language-mermaid)')];
  if (!diagrams.length) return;
  mermaidPromise ||= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', htmlLabels: false, flowchart: {htmlLabels: false}, suppressErrorRendering: true });
    return mermaid;
  });
  const mermaid = await mermaidPromise;
  for (const pre of diagrams) {
    const code = pre.querySelector('code') || pre;
    try {
      const { svg } = await mermaid.render(`wordgard-diagram-${++diagramId}`, code.textContent);
      if (!container.contains(code)) continue;
      const figure = document.createElement('figure');
      figure.className = 'diagram-preview';
      figure.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
      pre.replaceWith(figure);
    } catch (error) {
      pre.title = `图表暂未渲染：${(error as Error).message}`;
    }
  }
}

export const sampleDocs = [{
  id: 'welcome', title: '欢迎来到纸间',
  markdown: `# 让思绪，自然成文

> 一处安静的写作空间，让文字先于工具被看见。

写下一段想法，接着写下另一段。**纸间**是一份基于 Wordgard 的 Markdown 编辑器演示：你可以像编辑文档一样创作，也可以随时切换到源码，观察文字背后的结构。

从一篇日记到一份技术方案，好的工具应当顺着你的思路。选中文字试试加粗、链接或高亮；用左侧大纲整理章节，让长文也保持清晰。[^design]

## 从这里开始

- [x] 创建第一篇文档
- [ ] 写下今天最值得记录的一件事
- [ ] 导出 Markdown，与朋友分享

## 写作工具箱

| 内容 | 使用方式 |
| --- | --- |
| 标题与列表 | 工具栏插入，或直接输入 Markdown |
| 表格与代码 | 组织信息，记录可运行的想法 |
| 公式与图表 | 在预览中查看清晰的排版 |

## 把想法连接起来

一段简单的表达，也可以承载精确的含义：

$$
E = mc^2
$$

\`\`\`mermaid
flowchart LR
  A[灵感] --> B[写作]
  B --> C[整理]
  C --> D[分享]
\`\`\`

[^design]: 编辑内容保存在本机浏览器。预览负责渲染公式和图表，源码始终可以继续编辑。
`,
}, {
  id: 'project', title: '一个小项目的诞生',
  markdown: `# 一个小项目的诞生

从真实的问题出发，为每天的工作留一点空间。

## 目标

做一款令人愿意打开的写作工具。打开即写、结构清晰、文件可以自由带走，是这次设计的三个重点。

## 本周计划

- [x] 整理写作场景与信息结构
- [x] 实现 Markdown 与富文本切换
- [ ] 评审交互细节
- [ ] 收集第一轮反馈

## 设计备忘

> 界面退后一步，内容向前一步。

| 阶段 | 交付物 | 状态 |
| --- | --- | --- |
| 探索 | 用户场景 | 完成 |
| 原型 | 可交互页面 | 进行中 |
| 验证 | 测试记录 | 待开始 |

## 一段实现

\`\`\`javascript
const draft = { title: '新的想法', saved: true };
console.log(draft.title);
\`\`\`

下一步，给自己留一份简短的复盘：**什么有效，什么需要改变？**
`,
}, {
  id: 'shortcuts', title: '写作小抄',
  markdown: `# 写作小抄

把常用操作放在手边，让注意力留在句子里。

## Markdown 语法

| 想要的效果 | 输入 |
| --- | --- |
| 一级标题 | \`# 标题\` |
| 加粗 | \`**文字**\` |
| 斜体 | \`*文字*\` |
| 删除线 | \`~~文字~~\` |
| 链接 | \`[文字](https://example.com)\` |
| 行内代码 | 使用一对反引号 |

## 便捷操作

- **Ctrl / ⌘ + B**：加粗
- **Ctrl / ⌘ + I**：斜体
- **Ctrl / ⌘ + Z**：撤销
- **Ctrl / ⌘ + S**：保存当前文档

工具栏提供表格、图片、代码和引用入口。源码模式适合精细调整 Markdown；预览模式适合通读与检查公式、流程图。

## 试一试

选中这句话，给它一点**强调**。也可以插入一条分隔线，为下一段想法留白。

---

> 不必一次写得完美。先让想法落在纸上。
`,
}];
