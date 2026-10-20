import type {FileEntry} from './types';
export const fileTypes: FilePickerAcceptType[] = [{description:'Markdown 文档', accept:{'text/markdown':['.md','.markdown','.txt']}}];

export async function openMarkdownFiles() {
  const handles=await window.showOpenFilePicker({multiple:true,types:fileTypes});
  return Promise.all(handles.map(async handle=>{
    const file=await handle.getFile();const markdown=await file.text();
    return {handle,markdown,title:file.name.replace(/\.[^.]+$/,'')};
  }));
}

export async function saveMarkdownFile({entry,markdown,title,saveAs=false}: {entry?: FileEntry; markdown: string; title: string; saveAs?: boolean}): Promise<FileEntry> {
  let handle=saveAs?null:entry?.handle;
  if(handle){
    const disk=await (await handle.getFile()).text();
    if(disk!==entry.baseline)throw Error('磁盘文件已被其他程序修改，请重新打开文件，或选择另存为。');
  }else{
    handle=await window.showSaveFilePicker({suggestedName:(title||'未命名文档').replace(/[\\/:*?"<>|]/g,'-')+'.md',types:fileTypes});
  }
  const writable=await handle.createWritable();
  try{await writable.write(markdown);await writable.close();}
  catch(error){await writable.abort().catch(()=>{});throw error;}
  return {handle,baseline:markdown};
}
