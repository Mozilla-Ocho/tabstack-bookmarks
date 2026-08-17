/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ImportJob, ImportOptions } from './importQueue';
import type { BackendId } from './settings';

export type SaveStatus = 'extracting' | 'storing' | 'done' | 'error';

export interface SaveRecord {
  url: string;
  title: string;
  status: SaveStatus;
  tags: string[];
  note?: string;
  /** Path relative to the backend folder, e.g. "2026-08-14-some-post.md". */
  path?: string;
  /** Human-readable final location. */
  location?: string;
  /** Which backend stored it. */
  backend?: BackendId;
  /** Rebuilt from the durable index, not from this session's history. */
  indexed?: boolean;
  link?: string;
  error?: string;
  /** HTTP status when the failure came from the Tabstack API. */
  errorStatus?: number;
  /** Epoch ms of the next automatic attempt, when one is queued. */
  retryAt?: number;
  /** Set by the downloads backend, so a notification can reveal the file. */
  downloadId?: number;
  bytes?: number;
  /** AI summary, when summaries are on. */
  summary?: string;
  /** Set when the summary failed but the markdown was still saved. */
  summaryError?: string;
  startedAt: number;
  updatedAt: number;
}

export interface SaveRequest {
  type: 'save';
  url: string;
  title: string;
  tags?: string[];
  note?: string;
  /** Set to rewrite a previous save in place. */
  overwritePath?: string;
  /** Overrides the summarize setting for this one save. */
  summarize?: boolean;
}

export interface GetStateRequest {
  type: 'getState';
  url: string;
}

export interface ClearStateRequest {
  type: 'clearState';
  url: string;
}

export interface ListFoldersRequest {
  type: 'listFolders';
}

/** Search the durable saved index, for the library page. */
export interface SearchSavedRequest {
  type: 'searchSaved';
  query?: string;
  limit?: number;
}

export interface PlanImportRequest {
  type: 'planImport';
  options: ImportOptions;
}

export interface StartImportRequest {
  type: 'startImport';
  options: ImportOptions;
}

export interface ImportControlRequest {
  type: 'cancelImport' | 'getImport' | 'clearImport';
}

export type Message =
  | SaveRequest
  | GetStateRequest
  | ClearStateRequest
  | ListFoldersRequest
  | SearchSavedRequest
  | PlanImportRequest
  | StartImportRequest
  | ImportControlRequest;

/**
 * What the background replies with when a handler rejects. Callers must check
 * for this before treating a reply as their expected shape — otherwise the UI
 * renders a record with no status and shows an empty box.
 */
export interface ErrorReply {
  error: string;
}

export function isErrorReply(reply: unknown): reply is ErrorReply {
  return (
    typeof reply === 'object' &&
    reply !== null &&
    typeof (reply as ErrorReply).error === 'string' &&
    !('status' in reply)
  );
}

/** Broadcast from the background whenever a record changes. */
export interface SaveUpdate {
  type: 'saveUpdate';
  record: SaveRecord;
}

/** The queue without its item list, which is too big to broadcast. */
export type ImportProgress = Omit<ImportJob, 'items'> & { currentTitle?: string };

export interface ImportUpdate {
  type: 'importUpdate';
  progress: ImportProgress;
}
