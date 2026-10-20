import {test, expect} from '@playwright/test';

test.beforeEach(async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#editor-host wg-content')).toBeVisible();
});

test('real bridge and Wordgard schema retain extensions and multiline footnotes', async ({page}) => {
  const result = await page.evaluate(async () => {
    const {toHTML,toMarkdown} = await import('/src/markdown.ts');
    const {createEngine} = await import('/src/engine.ts');
    const host=document.createElement('div'); document.body.append(host);
    const md='---\ntitle: 文档\ntags: [one, two]\n---\n\n# 标题\n\n==高亮== H<sub>2</sub>O x<sup>2</sup> <u>线</u>\n\n参考[^long]\n\n[^long]: 第一段 **粗体**\n\n    第二段\n\n    - 子列表\n';
    const engine=createEngine(host,{html:toHTML(md)});
    const output=toMarkdown(engine.getHTML());
    const again=toMarkdown(toHTML(output));
    engine.destroy();host.remove();return {output,again};
  });
  expect(result.output).toContain('title: 文档');
  expect(result.output).toContain('==高亮==');
  expect(result.output).toContain('<sub>2</sub>');
  expect(result.output).toContain('<sup>2</sup>');
  expect(result.output).toContain('<u>线</u>');
  expect(result.output).toContain('[^long]: 第一段 **粗体**');
  expect(result.output).toContain('    第二段');
  expect(result.output).toContain('    - 子列表');
  expect(result.again).toBe(result.output);
});

test('source commits are undoable and no-op switches retain history', async ({page}) => {
  await page.locator('#new-doc').click();
  await page.locator('#source-toggle').click();
  const source=page.locator('#markdown-source .cm-content');
  await source.fill('# 新标题\n\n原始正文');
  await page.locator('#source-toggle').click();
  await expect(page.locator('#editor-host h1')).toContainText('新标题');
  await page.locator('[data-command="undo"]').first().click();
  await expect(page.locator('#editor-host wg-content')).not.toContainText('新标题');
  await page.locator('[data-command="redo"]').first().click();
  await page.locator('#source-toggle').click();
  await page.locator('#source-toggle').click();
  await page.locator('[data-command="undo"]').first().click();
  await expect(page.locator('#editor-host wg-content')).not.toContainText('新标题');
});

test('source history and visual history survive document switching', async ({page}) => {
  await page.locator('#new-doc').click();
  await page.locator('#input-title').fill('历史测试');
  await page.locator('#source-toggle').click();
  await page.locator('#markdown-source .cm-content').fill('历史正文');
  await page.locator('#source-toggle').click();
  await page.locator('#new-doc').click();
  await page.locator('.doc-item').filter({hasText:'历史测试'}).click();
  await page.locator('[data-command="undo"]').first().click();
  await expect(page.locator('#editor-host wg-content')).not.toContainText('历史正文');
});

test('display math and Mermaid render in editable mode without polluting serialization', async ({page}) => {
  await page.evaluate(async () => {
    const {createEngine}=await import('/src/engine.ts');
    const {toHTML}=await import('/src/markdown.ts');
    const host=document.createElement('div');host.id='probe';document.body.append(host);
    window.probe=createEngine(host,{html:toHTML('$$\nx^2\n$$\n\n```mermaid\ngraph LR\n A-->B\n```')});
  });
  await expect(page.locator('#probe .wg-block-preview .katex')).toBeVisible();
  await expect(page.locator('#probe .wg-block-preview svg')).toBeVisible();
  const html=await page.evaluate(()=>window.probe.getHTML());
  expect(html).toContain('x^2'); expect(html).toContain('A-->B');
  expect(html).not.toContain('wg-block-preview'); expect(html).not.toContain('<svg');
});

test('footnote insertion produces unique labels and supports undo', async ({page}) => {
  await page.evaluate(async () => {
    const {createEngine}=await import('/src/engine.ts');
    const host=document.createElement('div');host.id='notes';document.body.append(host);
    window.probe=createEngine(host);window.probe.command('footnote');window.probe.command('footnote');
  });
  await expect(page.locator('#notes section[data-footnote-definition="1"]')).toHaveCount(1);
  await expect(page.locator('#notes section[data-footnote-definition="2"]')).toHaveCount(1);
  await page.evaluate(()=>window.probe.undo());
  await expect(page.locator('#notes section[data-footnote-definition="2"]')).toHaveCount(0);
});

test('source editor exposes line numbers, formatting and its own undo', async ({page}) => {
  await page.locator('#new-doc').click();await page.locator('#source-toggle').click();
  const source=page.locator('#markdown-source .cm-content');
  await source.fill('第一行\n第二行');await source.press('Control+End');
  await source.press('Enter');await page.keyboard.type('第三行');
  await expect(page.locator('#markdown-source .cm-lineNumbers')).toBeVisible();
  await page.locator('[data-command="undo"]').first().click();
  await expect(source).not.toContainText('第三行');
});

test('tasks, tables, cross-mark replacement and readonly use model history',async({page})=>{
  await page.evaluate(async()=>{
    const {createEngine}=await import('/src/engine.ts');
    const {toHTML}=await import('/src/markdown.ts');
    const host=document.createElement('div');host.id='operations';document.body.append(host);
    window.probe=createEngine(host,{html:toHTML('- [ ] 待办\n\nhello **world**')});
  });
  await page.locator('#operations input[type=checkbox]').click();
  await expect(page.locator('#operations input[type=checkbox]')).toBeChecked();
  await page.evaluate(()=>window.probe.undo());
  await expect(page.locator('#operations input[type=checkbox]')).not.toBeChecked();
  const result=await page.evaluate(()=>{
    const e=window.probe, count=e.replaceAll('hello world','替换正文');const replaced=e.getText();
    e.undo();const restored=e.getText();e.command('table',{rows:3,cols:2});const table=e.getHTML();
    e.undo();const tableUndone=e.getHTML();e.setReadonly(true);const before=e.getHTML();
    const blocked=e.command('table',{rows:2,cols:2});return {count,replaced,restored,table,tableUndone,before,blocked,after:e.getHTML()};
  });
  expect(result.count).toBe(1);expect(result.replaced).toContain('替换正文');expect(result.restored).toContain('hello world');
  expect(result.table.match(/<tr>/g)).toHaveLength(3);expect(result.table.match(/<t[hd]>/g)).toHaveLength(6);
  expect(result.tableUndone).not.toContain('<table');expect(result.blocked).toBe(false);expect(result.after).toBe(result.before);
});

test('source content persists across reloads and exports as Markdown',async({page})=>{
  await page.locator('#new-doc').click();await page.locator('#source-toggle').click();
  await page.locator('#markdown-source .cm-content').fill('---\ntitle: 保留\n---\n\n# 中文正文\n\n```text\n-    空格\n```');
  await expect(page.locator('#save-status')).toHaveText('已保存至本机');
  await page.reload();await page.locator('#source-toggle').click();
  await expect(page.locator('#markdown-source .cm-content')).toContainText('-    空格');
  await page.locator('#export-btn').click();
  const downloadPromise=page.waitForEvent('download');await page.locator('[data-export=markdown]').click();
  const download=await downloadPromise;expect(download.suggestedFilename()).toMatch(/\.md$/);
  const {readFile}=await import('node:fs/promises');const output=await readFile(await download.path(),'utf8');
  expect(output).toContain('title: 保留');expect(output).toContain('-    空格');
});
