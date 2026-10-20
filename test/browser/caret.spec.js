import {test,expect} from '@playwright/test';

test('workbench cursor is drawn at the clicked glyph with zero content padding and after scrolling',async({page})=>{
  await page.goto('/');
  const paragraph=page.locator('#editor-host p').first();
  await expect(paragraph).toBeVisible();
  for(const scroll of [false,true]){
    if(scroll){await page.locator('.paper-scroll').evaluate(el=>{el.style.scrollBehavior='auto';el.scrollTop=180;});}
    const point=await paragraph.evaluate(el=>{
      const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;
      while(node=walker.nextNode())if(node.textContent.length>8&&!node.parentElement.closest('.md-meta'))break;
      const range=document.createRange();range.setStart(node,8);range.collapse(true);
      const rect=range.getBoundingClientRect();return {x:rect.x,y:rect.y+rect.height/2};
    });
    await page.mouse.click(point.x,point.y);
    await expect.poll(()=>page.evaluate(()=>{
      const wg=document.querySelector('#editor-host wordgard-editor').wg;
      const actual=wg.dom.querySelector('wg-cursor')?.getBoundingClientRect();
      if(!actual)return 1000;
      const expected=wg.coordsAtPos(wg.state.selection.head,wg.state.selection.headSide);
      return Math.max(Math.abs(actual.top-expected.top),Math.abs(actual.left-expected.left));
    })).toBeLessThan(2);
  }
});

test('clicking rendered text inserts at the clicked character before and after marker expansion',async({page})=>{
  await page.goto('/');
  await page.evaluate(async()=>{
    const {createLiveEngine}=await import('/src/live-engine.ts');
    const host=document.createElement('div');host.id='caret-test';document.body.prepend(host);
    window.live=createLiveEngine(host,{markdown:'A **bold** B *italic* C\n\n# Heading\n'});
  });
  for(const [selector,offset,expected] of [['strong',2,6],['em',3,17],['h1',3,30]]){
    const point=await page.locator('#caret-test '+selector).evaluate((element,offset)=>{
      const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
      let node;while(node=walker.nextNode())if(node.parentElement.getBoundingClientRect().height&& !node.parentElement.closest('.md-meta'))break;
      const range=document.createRange();range.setStart(node,offset);range.setEnd(node,offset);
      const rect=range.getBoundingClientRect();return {x:rect.x,y:rect.y+rect.height/2};
    },offset);
    await page.mouse.click(point.x,point.y);
    await expect.poll(()=>page.evaluate(()=>live.getSourceSelection().head)).toBe(expected);
  }
  await page.keyboard.type('X');
  expect(await page.evaluate(()=>live.getMarkdown())).toBe('A **bold** B *italic* C\n\n# HeaXding\n');
});

test('wrapped text, blank line-end space, double click and drag keep source positions',async({page})=>{
  await page.goto('/');
  await page.evaluate(async()=>{
    const {createLiveEngine}=await import('/src/live-engine.ts');
    const host=document.createElement('div');host.id='caret-test';host.style.width='260px';document.body.prepend(host);
    window.live=createLiveEngine(host,{markdown:'**bold** plain text with enough words to wrap onto another line.\n\nEnd'});
  });
  const point=async(text,offset)=>page.locator('#caret-test').evaluate((element,{text,offset})=>{
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node;
    while(node=walker.nextNode())if(node.textContent.includes(text))break;
    const range=document.createRange();range.setStart(node,offset);range.collapse(true);
    const rect=range.getBoundingClientRect();return {x:rect.x,y:rect.y+rect.height/2};
  },{text,offset});
  const p=await point('plain',44);
  await page.mouse.click(p.x,p.y);
  await expect.poll(()=>page.evaluate(()=>live.getSourceSelection().head)).toBe(52);
  await page.locator('#caret-test strong').dblclick();
  expect(await page.evaluate(()=>{const s=live.getSourceSelection();return live.getMarkdown().slice(s.from,s.to);})).toBe('bold');
  const a=await point('plain',2),b=await point('plain',12);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>live.getSourceSelection())).toMatchObject({from:10,to:20});
  await expect(page.locator('#caret-test strong').first()).toBeVisible();
  await expect(page.locator('#caret-test .md-meta').first()).toBeHidden();
  const shiftedStart=await point('plain',2);
  await page.mouse.click(shiftedStart.x,shiftedStart.y);
  await expect.poll(()=>page.evaluate(()=>live.getSourceSelection().head)).toBe(10);
  const shiftedEnd=await point('plain',12);
  await page.keyboard.down('Shift');await page.mouse.click(shiftedEnd.x,shiftedEnd.y);await page.keyboard.up('Shift');
  await expect.poll(()=>page.evaluate(()=>live.getSourceSelection())).toMatchObject({anchor:10,head:20});
  await page.locator('#caret-test strong').click({clickCount:3});
  await expect.poll(()=>page.evaluate(()=>live.getSourceSelection())).toMatchObject({from:0,to:64});
  const rect=await page.locator('#caret-test .md-paragraph').first().boundingBox();
  await page.mouse.click(rect.x+rect.width-2,rect.y+rect.height-10);
  await expect.poll(()=>page.evaluate(()=>live.getSourceSelection().head)).toBe(64);
});
