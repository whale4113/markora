import {test,expect} from '@playwright/test';
import {corpus} from '../corpus.js';

test('all corpus entries are stable through the production bridge and Wordgard model',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await expect(page.locator('#editor-host wg-content')).toBeVisible();
  const results=await page.evaluate(async(corpus)=>{
    const {toHTML,toMarkdown}=await import('/src/markdown.ts');
    const {createEngine}=await import('/src/engine.ts');
    return corpus.map(([name,md])=>{
      const host=document.createElement('div');
      const engine=createEngine(host,{html:toHTML(md)});
      const first=toMarkdown(engine.getHTML());
      engine.setHTML(toHTML(first));
      const second=toMarkdown(engine.getHTML());
      engine.destroy();return {name,md,first,second};
    });
  },corpus);
  for(const {name,first,second} of results)expect(second, name).toBe(first);
  const code=results.find(r=>r.name==='literal-code').first;
  expect(code).toContain('-    四空格');expect(code).toContain('1.   三空格');expect(code).toContain('[x]    四空格');expect(code).toContain('\\[^literal]');
  expect(results.find(r=>r.name==='table').first).toMatch(/\|\s*:--\s*\|\s*--:\s*\|/);
  expect(errors).toEqual([]);
});

test('native file save detects external changes and writes the captured document',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {saveMarkdownFile}=await import('/src/files.ts');
    let disk='original',writes=0;
    const handle={getFile:async()=>new File([disk],'test.md'),createWritable:async()=>({
      write:async text=>{disk=text;writes++;},close:async()=>{},abort:async()=>{}
    })};
    const entry=await saveMarkdownFile({entry:{handle,baseline:'original'},markdown:'# saved',title:'Test'});
    disk='external';let conflict;
    try{await saveMarkdownFile({entry,markdown:'overwrite',title:'Test'});}catch(error){conflict=error.message;}
    return {baseline:entry.baseline,disk,writes,conflict};
  });
  expect(result.baseline).toBe('# saved');expect(result.disk).toBe('external');expect(result.writes).toBe(1);
  expect(result.conflict).toContain('其他程序修改');
});

test('TOC updates from the model and HTML source survives editing',async({page})=>{
  await page.goto('/');await expect(page.locator('#editor-host wg-content')).toBeVisible();
  await page.evaluate(async()=>{
    const {createEngine}=await import('/src/engine.ts');const {toHTML}=await import('/src/markdown.ts');
    const host=document.createElement('div');host.id='probe';document.body.append(host);
    window.probe=createEngine(host,{html:toHTML('[TOC]\n\n# 第一节\n\n<details>\n<summary>摘要</summary>\n<p>安全内容</p>\n</details>')});
  });
  await expect(page.locator('#probe .document-toc button')).toHaveText('第一节');
  await expect(page.locator('#probe .html-preview summary')).toHaveText('摘要');
  await page.evaluate(()=>window.probe.setHTML('<div data-markdown-toc="[TOC]"></div><h1>修改标题</h1>',{recordHistory:true}));
  await expect(page.locator('#probe .document-toc button')).toHaveText('修改标题');
  await page.evaluate(()=>window.probe.undo());
  await expect(page.locator('#probe .document-toc button')).toHaveText('第一节');
});

test('typing Markdown applies native marks and task nodes',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await expect(page.locator('#editor-host wg-content')).toBeVisible();
  await page.locator('#new-doc').click();
  const content=page.locator('#editor-host wg-content');await content.click();
  await page.keyboard.type('**bold**');await expect(content.locator('strong')).toHaveText('bold');
  await page.keyboard.press('Enter');await page.keyboard.type('- [ ] ');
  await expect(content.locator('input[type=checkbox]')).toHaveCount(1);
  expect(errors).toEqual([]);
});
