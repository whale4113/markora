export interface Revision {at: number; title: string; markdown: string}
export interface DocumentRecord {
  id: string;
  title: string;
  markdown: string;
  created: number;
  updated: number;
  revisions: Revision[];
  deleted?: boolean;
}
export type Theme = 'light' | 'dark';
export type Mode = 'edit' | 'source' | 'reading';
export interface Library {docs: DocumentRecord[]; currentId: string; theme: Theme}
export interface FileEntry {handle: FileSystemFileHandle; baseline: string}
export interface SourceSelection {anchor: number; head: number}
export interface ModalField {name: string; label: string; value?: string; placeholder?: string; multiline?: boolean; required?: boolean}
export type CommandValue = string | number | {rows: number; cols: number};
export interface ToastMessage {text: string; action?: {label: string; run: () => void}}
