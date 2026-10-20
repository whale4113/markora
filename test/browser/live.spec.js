import {test,expect} from '@playwright/test';
import {corpus} from '../corpus.js';
import {readFileSync} from 'node:fs';
const originalProbes=JSON.parse(readFileSync(new URL('../reference-decorations.json',import.meta.url),'utf8'));

test.beforeEach(async({page})=>{
  await page.goto('/');await expect(page.locator('#editor-host wg-content')).toBeVisible();
  await page.evaluate(async()=>{
    const {createLiveEngine}=await import('/src/live-engine.ts');
    const host=document.createElement('div');host.id='live-test';document.body.append(host);
    window.liveChanges=0;window.live=createLiveEngine(host,{markdown:'A **bold** B *italic* C\n\n# Heading\n',onChange:()=>liveChanges++});
  });
});

test('focus reveals only the relevant editable Markdown markers and blur collapses them',async({page})=>{
  const bold=page.locator('#live-test [md-inline=strong]'),italic=page.locator('#live-test [md-inline=em]');
  await expect(bold.locator('.md-meta').first()).toBeHidden();
  await bold.locator('strong').click();
  await expect(bold.locator('.md-meta').first()).toBeVisible();
  await expect(bold.locator('.md-meta').last()).toBeVisible();
  await expect(italic.locator('.md-meta').first()).toBeHidden();
  expect(await page.evaluate(()=>liveChanges)).toBe(0);
  await page.locator('#live-test h1').click();
  await expect(bold.locator('.md-meta').first()).toBeHidden();
  await expect(page.locator('#live-test h1 .md-meta').first()).toBeVisible();
  await page.locator('#input-title').click();
  await expect(page.locator('#live-test h1 .md-meta').first()).toBeHidden();
  expect(await page.evaluate(()=>live.getMarkdown())).toBe('A **bold** B *italic* C\n\n# Heading\n');
  expect(await page.evaluate(()=>live.undo())).toBe(false);
});

test('delimiter edits in the rendered paragraph update formatting and undo restores source',async({page})=>{
  await page.evaluate(()=>{live.focus();live.selectSource(2,4);});
  await page.keyboard.press('Backspace');
  expect(await page.evaluate(()=>live.getMarkdown())).toBe('A bold** B *italic* C\n\n# Heading\n');
  await expect(page.locator('#live-test strong')).toHaveCount(0);
  await page.evaluate(()=>live.undo());
  expect(await page.evaluate(()=>live.getMarkdown())).toBe('A **bold** B *italic* C\n\n# Heading\n');
  await expect(page.locator('#live-test strong')).toHaveText('bold');
});

test('link destination is real editable source, with no modal or textarea',async({page})=>{
  await page.evaluate(()=>live.setMarkdown('Visit [label](https://old.example) and `code`.'));
  await page.locator('#live-test .md-link-label').click();
  await expect(page.locator('#live-test [md-inline=link] .md-meta').last()).toBeVisible();
  await page.evaluate(()=>{const source=live.getMarkdown(),start=source.indexOf('old');live.selectSource(start,start+3);});
  await page.keyboard.type('new');await page.locator('#input-title').click();
  expect(await page.evaluate(()=>live.getMarkdown())).toBe('Visit [label](https://new.example) and `code`.');
  await expect(page.locator('#live-test .md-meta').first()).toBeHidden();
  expect(await page.evaluate(()=>live.getHTML())).toContain('https://new.example');
});

test('typing and removing Markdown changes the view without discarding the delimiters',async({page})=>{
  await page.evaluate(()=>{live.setMarkdown('');live.focus();});
  await page.keyboard.type('**bold**');
  await expect(page.locator('#live-test strong')).toHaveText('bold');
  expect(await page.evaluate(()=>live.getMarkdown())).toBe('**bold**');
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.type('# New heading');
  expect(await page.evaluate(()=>live.getMarkdown())).toBe('**bold**\n\n# New heading');
  await expect(page.locator('#live-test h1')).toContainText('New heading');
});

test('multi-block selection, replacement and source coordinates survive formatting',async({page})=>{
  await page.evaluate(()=>{live.focus();live.selectSource(4,27);});
  expect(await page.evaluate(()=>live.getSourceSelection())).toMatchObject({from:4,to:27});
  await page.keyboard.type('替换');
  expect(await page.evaluate(()=>live.getMarkdown())).toBe('A **替换Heading\n');
  await page.evaluate(()=>live.undo());
  expect(await page.evaluate(()=>live.getMarkdown())).toBe('A **bold** B *italic* C\n\n# Heading\n');
});

test('IME freezes decoration replacement until composition ends',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(()=>{live.setMarkdown('中文 **文本**');live.focus();live.selectSource(3);});
  const content=page.locator('#live-test wg-content');
  await content.dispatchEvent('compositionstart',{data:''});
  await page.keyboard.insertText('输入');
  expect(await page.evaluate(()=>live.getMarkdown())).toContain('输入');
  await content.dispatchEvent('compositionend',{data:'输入'});
  await page.locator('#input-title').click();
  await expect(page.locator('#live-test strong')).toHaveText('文本');
  expect(errors).toEqual([]);
});

test('all corpus source is retained exactly, including CRLF, through focus and reload',async({page})=>{
  const sources=[...corpus.map(([name,md])=>[name,md]),['crlf','# Heading\r\n\r\n**bold** and `code`\r\n'],['patterns','__bold__ and _italic_ and H~2~O and x^2^\n'],['table-crlf','| A | **B** |\r\n| --- | ---: |\r\n| one | two |\r\n']];
  const result=await page.evaluate(sources=>sources.map(([name,source])=>{
    live.setMarkdown(source);live.focus();live.selectSource(Math.floor(source.length/2));
    const focused=live.getMarkdown();live.setVisible(false);live.setVisible(true);return {name,source,focused,after:live.getMarkdown()};
  }),sources);
  for(const r of result){expect(r.focused,r.name).toBe(r.source);expect(r.after,r.name).toBe(r.source);}
});

test('table cells retain rich rendering and reveal only focused cell syntax',async({page})=>{
  const md='| Header | Name |\n| :--- | ---: |\n| **bold** | *italic* |\n';
  await page.evaluate(md=>live.setMarkdown(md),md);
  const bold=page.locator('#live-test td [md-inline=strong]'),em=page.locator('#live-test td [md-inline=em]');
  await bold.locator('strong').click();
  await expect(bold.locator('.md-meta').first()).toBeVisible();await expect(em.locator('.md-meta').first()).toBeHidden();
  expect(await page.evaluate(()=>live.getMarkdown())).toBe(md);
  await page.evaluate(()=>{const source=live.getMarkdown(),at=source.indexOf('bold');live.selectSource(at,at+4);});
  await page.keyboard.type('修改');await expect(page.locator('#live-test td strong')).toHaveText('修改');
  expect(await page.evaluate(()=>live.getMarkdown())).toBe(md.replace('bold','修改'));
  await page.evaluate(()=>live.undo());expect(await page.evaluate(()=>live.getMarkdown())).toBe(md);
  await page.evaluate(()=>live.command('tableAddRow'));
  await expect(page.locator('#live-test tr')).toHaveCount(3);
  await page.evaluate(()=>live.undo());await expect(page.locator('#live-test tr')).toHaveCount(2);
});

test('list continuation, task toggle, and code newlines preserve source semantics',async({page})=>{
  await page.evaluate(()=>{live.setMarkdown('- [x] done\n- [ ] todo');});
  await page.locator('#live-test input[type=checkbox]').last().click();
  expect(await page.evaluate(()=>live.getMarkdown())).toBe('- [x] done\n- [x] todo');
  await page.evaluate(()=>{live.focus();live.selectSource(live.getMarkdown().length);});
  await page.keyboard.press('Enter');expect(await page.evaluate(()=>live.getMarkdown())).toBe('- [x] done\n- [x] todo\n- [ ] ');
  await page.keyboard.press('Enter');expect(await page.evaluate(()=>live.getMarkdown())).toBe('- [x] done\n- [x] todo\n');
  await page.evaluate(()=>{live.setMarkdown('```text\n- literal\n```');live.focus();live.selectSource(17);});
  await page.keyboard.press('Enter');expect(await page.evaluate(()=>live.getMarkdown())).not.toContain('- literal\n- ');
});

test('nested focus, original delimiters and cross-format replacement retain meaningful source',async({page})=>{
  const md='__bold *nested*__ and **sibling**';
  await page.evaluate(md=>{live.setMarkdown(md);live.focus();live.selectSource(4);},md);
  await expect(page.locator('#live-test .md-meta').filter({hasText:'*'}).first()).toBeVisible();
  await expect(page.locator('#live-test [md-inline=strong]').last().locator('.md-meta').last()).toBeHidden();
  expect(await page.evaluate(()=>live.getMarkdown())).toBe(md);
  const result=await page.evaluate(()=>{
    live.setMarkdown('hello **world** and hello *world*');
    const count=live.replaceAll('hello world','替换');const after=live.getMarkdown();live.undo();return {count,after,restored:live.getMarkdown()};
  });
  expect(result).toEqual({count:2,after:'替换 and 替换',restored:'hello **world** and hello *world*'});
});

test('clipboard retains original Markdown and rich output without copying view metadata',async({page})=>{
  const result=await page.evaluate(()=>{
    live.setMarkdown('__bold__\n\n');live.focus();live.selectSource(0,8);
    const clipboard=new DataTransfer();live.wg.contentDOM.dispatchEvent(new ClipboardEvent('copy',{clipboardData:clipboard,bubbles:true,cancelable:true}));
    const plain=clipboard.getData('text/plain'),html=clipboard.getData('text/html');
    live.selectSource(live.getMarkdown().length);
    live.wg.contentDOM.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));
    return {plain,html,source:live.getMarkdown()};
  });
  expect(result.plain).toBe('__bold__');expect(result.html).toContain('<strong>bold</strong>');expect(result.html).not.toContain('md-meta');
  expect(result.source).toBe('__bold__\n\n__bold__');
});

test('code highlighting, entities and original CRLF survive real edits',async({page})=>{
  await page.evaluate(()=>{live.setMarkdown('```javascript\nconst x = 1;\n```');});
  await expect(page.locator('#live-test .md-code-token-keyword')).toHaveText('const');
  await page.evaluate(()=>{live.setMarkdown('# 标题\r\n\r\nA **粗体** &amp; B');live.focus();const at=live.getMarkdown().indexOf('粗体');live.selectSource(at,at+2);});
  await page.keyboard.type('修改');
  expect(await page.evaluate(()=>live.getMarkdown())).toBe('# 标题\r\n\r\nA **修改** &amp; B');
  await page.locator('#input-title').click();
  await expect(page.locator('#live-test [data-md-preview=entity]')).toHaveText('&');
});

test('replayed original decorator branches agree on preserved delimiters and styles',async({page})=>{
  const result=await page.evaluate(probes=>probes.results.map(({input,html})=>{
    const raw={strong:()=>input.pattern+input.inner+input.pattern,em:()=>input.pattern+input.inner+input.pattern,code:()=>input.pattern+input.text+input.pattern,
      del:()=>input.pattern+input.inner+input.pattern,highlight:()=>'=='+input.inner+'==',subscript:()=>'~'+input.inner+'~',superscript:()=>'^'+input.inner+'^',
      heading:()=>input.meta_before+input.inner,blockquote:()=>input.pattern+input.inner,def_footnote:()=>'[^'+input.ref+']:'+input.pattern+input.inner}[input.type]();
    live.setMarkdown(raw);const original=document.createElement('div');original.innerHTML=html;
    const reference=[...original.querySelectorAll('.md-meta,.md-blockmeta')].map(e=>e.textContent).join('');
    const actual=[...live.wg.contentDOM.querySelectorAll('.md-meta')].map(e=>e.textContent).join('');
    const tag={strong:'strong',em:'em',code:'code',del:'del,s',highlight:'mark',subscript:'sub',superscript:'sup'}[input.type];
    return {type:input.type,raw,source:live.getMarkdown(),reference,actual,styled:!tag||!!live.wg.contentDOM.querySelector(tag)};
  }),originalProbes);
  for(const r of result){expect(r.source,r.type).toBe(r.raw);expect(r.styled,r.type).toBe(true);if(r.type!=='def_footnote')expect(r.actual,r.type).toContain(r.reference);}
});

test('reference links render and reveal their original reference form',async({page})=>{
  const md='[label][ref]\n\n[ref]: https://example.test/path "title"\n';
  await page.evaluate(md=>live.setMarkdown(md),md);
  const link=page.locator('#live-test .md-link-label').filter({hasText:/^label$/});await expect(link).toHaveText('label');await link.click();
  await expect(page.locator('#live-test [md-inline=link]').first().locator('.md-meta').last()).toBeVisible();
  expect(await page.evaluate(()=>live.getMarkdown())).toBe(md);
  expect(await page.evaluate(()=>live.getHTML())).toContain('href="https://example.test/path"');
});
