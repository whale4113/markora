import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import katex from 'katex';
import 'katex/dist/katex.min.css';

const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parser = new Marked({ gfm: true, breaks: false });
parser.use({ extensions: [{
  name: 'displayMath', level: 'block',
  start: src => src.indexOf('$$'),
  tokenizer(src) {
    const match = /^\$\$[ \t]*\n([\s\S]*?)\n\$\$[ \t]*(?:\n|$)/.exec(src);
    if (match) return { type: 'displayMath', raw: match[0], text: match[1] };
  },
  renderer: token => `<pre data-language="math"><code class="language-math">${escapeHTML(token.text)}</code></pre>\n`,
}, {
  name: 'footnoteReference', level: 'inline',
  start: src => src.indexOf('[^'),
  tokenizer(src) {
    const match = /^\[\^([\w\u0080-\uffff-]+)\]/.exec(src);
    if (match) return { type: 'footnoteReference', raw: match[0], label: match[1] };
  },
  renderer: token => `<a href="#fn-${encodeURIComponent(token.label)}">[^${escapeHTML(token.label)}]</a>`,
}], renderer: {
  code({ text, lang }) {
    const language = (lang || '').split(/\s/)[0];
    return `<pre${language ? ` data-language="${escapeHTML(language)}"` : ''}><code${language ? ` class="language-${escapeHTML(language)}"` : ''}>${escapeHTML(text)}</code></pre>\n`;
  },
} });

/** Parse author text into sanitized, editable HTML. Math and diagrams remain code. */
export function toHTML(markdown = '') {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
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
      while (i + 1 < lines.length && /^(?: {4}|\t)/.test(lines[i + 1])) text += '\n' + lines[++i].replace(/^(?: {4}|\t)/, '');
      notes.push({ label: definition[1], text });
    } else body.push(line);
  }
  // Literal footnote markers survive Wordgard's schema even when custom HTML
  // attributes and container elements are discarded during parse/serialization.
  const footnotes = notes.map(note => `<p>[^${escapeHTML(note.label)}]: ${parser.parseInline(note.text.replace(/\n/g, ' '))}</p>`).join('');
  return DOMPurify.sanitize(parser.parse(body.join('\n')) + footnotes, {
    USE_PROFILES: { html: true }, ADD_ATTR: ['data-language', 'data-footnote-ref', 'data-footnotes', 'data-footnote-definition'],
  });
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', strongDelimiter: '**' });
turndown.use(gfm);
turndown.addRule('nestedTaskCheckbox', {
  filter: node => node.nodeName === 'INPUT' && node.type === 'checkbox' && Boolean(node.closest('li')),
  replacement: (content, node) => `${node.checked ? '[x]' : '[ ]'} `,
});
turndown.addRule('doubleStrikethrough', { filter: ['del', 's', 'strike'], replacement: content => `~~${content}~~` });
turndown.addRule('preserveCodeLanguage', {
  filter: node => node.nodeName === 'PRE',
  replacement(content, node) {
    const code = node.querySelector('code') || node;
    const language = code.getAttribute('data-language') || node.getAttribute('data-language') || /(?:^|\s)language-([^\s]+)/.exec(code.className)?.[1] || '';
    const value = code.textContent.replace(/\n$/, '');
    if (language === 'math' || language === 'latex') return `\n\n$$\n${value}\n$$\n\n`;
    const longest = Math.max(2, ...Array.from(value.matchAll(/`+/g), match => match[0].length));
    const fence = '`'.repeat(longest + 1);
    return `\n\n${fence}${language}\n${value}\n${fence}\n\n`;
  },
});
turndown.addRule('footnoteRef', {
  filter: node => node.nodeName === 'A' && /^\[\^[\w\u0080-\uffff-]+\]$/.test(node.textContent) && /^#fn-/.test(node.getAttribute('href') || ''),
  replacement: (content, node) => node.textContent,
});
turndown.addRule('footnoteDefinition', {
  filter: node => node.hasAttribute('data-footnote-definition'),
  replacement(content, node) {
    const clone = node.cloneNode(true);
    if (clone.firstElementChild?.matches('p') && clone.firstElementChild.textContent === `[${node.getAttribute('data-footnote-definition')}]`) clone.firstElementChild.remove();
    const text = turndown.turndown(clone.innerHTML).trim().replace(/\n/g, '\n    ');
    return `\n\n[^${node.getAttribute('data-footnote-definition')}]: ${text}\n\n`;
  },
});
turndown.addRule('footnoteSection', { filter: node => node.hasAttribute('data-footnotes'), replacement: content => `\n\n${content.replace(/^\s*\* \* \*\s*/, '')}\n\n` });

/** Export the editor's HTML, not an enhanced preview, back to GFM Markdown. */
export function toMarkdown(html = '') {
  return turndown.turndown(DOMPurify.sanitize(String(html), { USE_PROFILES: { html: true } }))
    .replace(/\\\[\^([\w\u0080-\uffff-]+)\\?\]/g, '[^$1]').trim() + '\n';
}

let mermaidPromise;
let diagramId = 0;
/** Only call on a read-only preview; this function replaces code nodes in its target. */
export async function renderEnhancements(container) {
  for (const paragraph of container.querySelectorAll('p')) {
    const definition = /^\[\^([\w\u0080-\uffff-]+)\]:/.exec(paragraph.textContent);
    if (definition) paragraph.id = `fn-${encodeURIComponent(definition[1])}`;
  }
  // Match both the original HTML and Wordgard's serialized pre[data-language].
  for (const pre of container.querySelectorAll('pre[data-language="math"], pre[data-language="latex"], pre:has(> code.language-math), pre:has(> code.language-latex)')) {
    const code = pre.querySelector('code') || pre;
    const display = document.createElement('div');
    display.className = 'math-preview';
    katex.render(code.textContent, display, { displayMode: true, throwOnError: false, trust: false });
    pre.replaceWith(display);
  }
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    if (!walker.currentNode.parentElement.closest('pre, code, .katex, a, script, style')) textNodes.push(walker.currentNode);
  }
  // Conservative delimiters: no whitespace/numeric opening, no nested dollars,
  // and no immediate digit after closing. Currency such as $20 or $20 $30 stays text.
  const inlineMath = /(?<![\\\w$])\$(?![\s\d$])([^$\n]*?[^\s$\n])\$(?![\d$])/g;
  for (const node of textNodes) {
    const matches = [...node.textContent.matchAll(inlineMath)];
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      fragment.append(node.textContent.slice(offset, match.index));
      const span = document.createElement('span');
      katex.render(match[1], span, { throwOnError: false, trust: false });
      fragment.append(span);
      offset = match.index + match[0].length;
    }
    fragment.append(node.textContent.slice(offset));
    node.replaceWith(fragment);
  }
  const diagrams = [...container.querySelectorAll('pre[data-language="mermaid"], pre:has(> code.language-mermaid)')];
  if (!diagrams.length) return;
  mermaidPromise ||= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', suppressErrorRendering: true });
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
      pre.title = `图表暂未渲染：${error.message}`;
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
