/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { BackendId } from '../settings';
import { downloadBackend } from './download';
import { githubBackend } from './github';
import { obsidianBackend } from './obsidian';
import type { StorageBackend } from './types';

export const BACKENDS: Record<BackendId, StorageBackend> = {
  github: githubBackend,
  download: downloadBackend,
  obsidian: obsidianBackend,
};

export const BACKEND_ORDER: BackendId[] = ['download', 'github', 'obsidian'];

export function getBackend(id: BackendId): StorageBackend {
  const backend = BACKENDS[id];
  if (!backend) throw new Error(`Unknown storage backend: ${id}`);
  return backend;
}

export type { SavePayload, SaveResult, StorageBackend } from './types';
