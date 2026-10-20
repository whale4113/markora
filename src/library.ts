import {sampleDocs} from './markdown';
import type {DocumentRecord, Library} from './types';

export const STORE = 'zhijian-wordgard-v1';
export function newDocument(title = '未命名文档', markdown = ''): DocumentRecord {
  return {id: crypto.randomUUID(), title, markdown, created: Date.now(), updated: Date.now(), revisions: []};
}
export function loadLibrary(): Library {
  let saved: Partial<Library> = {};
  try {saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {};} catch { /* Keep unreadable storage intact until the next save. */ }
  const docs: DocumentRecord[] = Array.isArray(saved.docs) && saved.docs.length
    ? saved.docs.filter(d => d && typeof d.id === 'string' && typeof d.markdown === 'string').map(d => ({...d, revisions: d.revisions || []}))
    : sampleDocs.map(d => ({...d, created: Date.now(), updated: Date.now(), revisions: []}));
  if (!docs.some(d => !d.deleted)) docs.unshift(newDocument());
  return {docs, currentId: docs.find(d => d.id === saved.currentId && !d.deleted)?.id || docs.find(d => !d.deleted)!.id, theme: saved.theme === 'dark' ? 'dark' : 'light'};
}
export function checkpoint(docs: DocumentRecord[], id: string): DocumentRecord[] {
  return docs.map(d => d.id !== id || d.revisions.at(-1)?.markdown === d.markdown ? d : {
    ...d, revisions: [...d.revisions, {at: Date.now(), title: d.title, markdown: d.markdown}].slice(-20),
  });
}
