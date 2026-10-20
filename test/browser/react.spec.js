import {test, expect} from '@playwright/test';

test('React library updates titles, search, delete and undo without remounting the active editor', async ({page}) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await page.locator('#new-doc').click();
  await page.locator('#input-title').fill('React 文档');
  await page.evaluate(()=>window.activeEditor=document.querySelector('#editor-host wordgard-editor'));
  await page.locator('#source-toggle').click();
  await page.locator('#markdown-source .cm-content').fill('# 章节\n\nReact **正文**');
  await page.locator('#source-toggle').click();
  await page.locator('#search-docs').fill('React 文档');
  await expect(page.locator('.doc-item')).toHaveCount(1);
  expect(await page.evaluate(()=>window.activeEditor===document.querySelector('#editor-host wordgard-editor'))).toBe(true);
  await page.locator('#search-docs').fill('');
  await page.locator('#tab-outline').click();
  await expect(page.locator('#outline-list')).toContainText('章节');
  await page.locator('#tab-files').click();
  await page.locator('#delete-doc').click();
  await expect(page.locator('#input-title')).not.toHaveValue('React 文档');
  await page.locator('#toast button').click();
  await expect(page.locator('#input-title')).toHaveValue('React 文档');
  await expect(page.locator('#editor-host strong')).toContainText('正文');
  expect(errors).toEqual([]);
});

test('existing local drafts keep their source and theme through React modes and reload', async ({page}) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const markdown='# 已有文档\r\n\r\n保留 __原始语法__ 与 [链接](https://example.com)\r\n';
  await page.addInitScript(markdown=>{if(!localStorage.getItem('zhijian-wordgard-v1'))localStorage.setItem('zhijian-wordgard-v1',JSON.stringify({docs:[{id:'existing',title:'已有草稿',markdown,created:1,updated:1,revisions:[]}],currentId:'existing',theme:'dark'}));},markdown);
  await page.goto('/');
  await expect(page.locator('#input-title')).toHaveValue('已有草稿');
  await expect(page.locator('body')).toHaveClass(/dark/);
  await page.locator('#readonly-toggle').click();
  await expect(page.locator('#reading-preview strong')).toHaveText('原始语法');
  await page.locator('#readonly-toggle').click();
  await page.locator('#source-toggle').click();await page.locator('#source-toggle').click();
  expect(await page.evaluate(()=>document.querySelector('#editor-host wordgard-editor').wg.liveMarkdown.getMarkdown())).toBe(markdown);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('zhijian-wordgard-v1')).docs[0].markdown.includes('__原始语法__'));
  await page.reload();
  await expect(page.locator('#editor-host strong')).toHaveText('原始语法');
  expect(errors).toEqual([]);
});

test('React dialogs insert a link and restore a revision while reading and theme toggles retain the editor', async ({page}) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.locator('#new-doc').click();
  await page.locator('#editor-host wg-content').click();
  await page.keyboard.type('label');
  await page.evaluate(()=>document.querySelector('#editor-host wordgard-editor').wg.liveMarkdown.selectSource(0,5));
  await page.locator('[data-command=link]').click();
  await page.locator('#modal input[name=value]').fill('https://example.com');
  await page.locator('#modal-submit').click();
  await expect(page.locator('#editor-host .md-link-label')).toHaveText('label');
  await page.locator('#history-toggle').click();
  await expect(page.locator('.revision-item')).toHaveCount(1);
  await page.locator('#modal-cancel').click();
  await page.locator('#source-toggle').click();await page.locator('#markdown-source .cm-content').fill('replacement');await page.locator('#source-toggle').click();
  await page.locator('#history-toggle').click();await page.locator('.revision-item').last().click();
  await expect(page.locator('#editor-host .md-link-label')).toHaveText('label');
  await page.locator('#theme-toggle').click();await expect(page.locator('body')).toHaveClass(/dark/);
  await page.locator('#readonly-toggle').click();await expect(page.locator('#reading-preview a')).toHaveAttribute('href','https://example.com');
  expect(errors).toEqual([]);
});
