/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { i18n } from '#i18n';
import { HttpError, NETWORK_STATUS } from '../httpError';
import { joinPath } from '../markdown';
import type { GitHubSettings, Settings } from '../settings';
import {
  toBase64,
  type SavePayload,
  type SaveResult,
  type StorageBackend,
} from './types';

const API = 'https://api.github.com';

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

/** fetch rejects with a TypeError when the request never reached GitHub. */
function reachError(error: unknown): Error {
  if (error instanceof TypeError) {
    return new HttpError(
      i18n.t('errors.github.unreachable', [error.message]),
      NETWORK_STATUS,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** Which request failed, for the message when the status alone says little. */
type Attempt = 'lookup' | 'commit' | 'check';

function attemptMessage(attempt: Attempt, status: number, detail: string): string {
  // A switch rather than a computed key, so the messages file and this file
  // cannot drift apart without the compiler noticing.
  switch (attempt) {
    case 'lookup':
      return i18n.t('errors.github.lookupFailed', [String(status), detail]);
    case 'commit':
      return i18n.t('errors.github.commitFailed', [String(status), detail]);
    case 'check':
      return i18n.t('errors.github.checkFailed', [String(status), detail]);
  }
}

/**
 * Carries `res.status`, so an import can tell a rate limit from a token that
 * will reject all 5,000 remaining items.
 */
async function errorFrom(res: Response, attempt: Attempt): Promise<HttpError> {
  const message = await res
    .json()
    .then((json) => (json as { message?: string }).message ?? '')
    .catch(() => '');
  if (res.status === 401 || res.status === 403) {
    return new HttpError(
      i18n.t('errors.github.rejectedToken', [String(res.status), message]).trim(),
      res.status,
    );
  }
  if (res.status === 404) {
    return new HttpError(i18n.t('errors.github.notFound', [message]).trim(), res.status);
  }
  return new HttpError(attemptMessage(attempt, res.status, message).trim(), res.status);
}

/** Returns the blob sha of an existing file, or null when it does not exist. */
async function getSha(cfg: GitHubSettings, path: string): Promise<string | null> {
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(cfg.branch)}`;
  const res = await fetch(url, { headers: headers(cfg.token) });
  if (res.status === 404) return null;
  if (!res.ok) throw await errorFrom(res, 'lookup');
  const json = (await res.json()) as { sha?: string; type?: string };
  if (json.type && json.type !== 'file') {
    throw new Error(i18n.t('errors.github.notAFile', [json.type, path]));
  }
  return json.sha ?? null;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Appends -1, -2, ... until the path is free. */
async function freePath(cfg: GitHubSettings, path: string): Promise<string> {
  const dot = path.lastIndexOf('.');
  const stem = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : '';
  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? path : `${stem}-${n}${ext}`;
    if ((await getSha(cfg, candidate)) === null) return candidate;
  }
  throw new Error(i18n.t('errors.noFreeName', [path]));
}

export const githubBackend: StorageBackend = {
  id: 'github',

  async save(payload: SavePayload, settings: Settings): Promise<SaveResult> {
    try {
      return await commit(payload, settings);
    } catch (error) {
      throw reachError(error);
    }
  },
};

async function commit(payload: SavePayload, settings: Settings): Promise<SaveResult> {
  const cfg = settings.github;
  const wanted = joinPath(cfg.folder, payload.path);
  const path = payload.overwrite ? wanted : await freePath(cfg, wanted);
  const sha = payload.overwrite ? await getSha(cfg, path) : null;

  const res = await fetch(
    `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${encodePath(path)}`,
    {
      method: 'PUT',
      headers: headers(cfg.token),
      body: JSON.stringify({
        message: `${sha ? 'Update' : 'Add'} bookmark: ${payload.title || payload.url}`,
        content: toBase64(payload.content),
        branch: cfg.branch,
        ...(sha ? { sha } : {}),
      }),
    },
  );

  if (!res.ok) throw await errorFrom(res, 'commit');

  const json = (await res.json()) as { content?: { html_url?: string } };

  return {
    location: `${cfg.owner}/${cfg.repo}/${path}`,
    link:
      json.content?.html_url ??
      `https://github.com/${cfg.owner}/${cfg.repo}/blob/${cfg.branch}/${path}`,
  };
}

/** Options-page connection check: can we read the repo and is it writable? */
export async function verifyGitHub(cfg: GitHubSettings): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}`, {
      headers: headers(cfg.token),
    });
  } catch (error) {
    throw reachError(error);
  }
  if (!res.ok) throw await errorFrom(res, 'check');
  const repo = (await res.json()) as {
    full_name: string;
    default_branch: string;
    permissions?: { push?: boolean };
  };
  if (repo.permissions && !repo.permissions.push) {
    throw new Error(i18n.t('errors.github.cannotWrite', [repo.full_name]));
  }
  return i18n.t('errors.github.connected', [repo.full_name, repo.default_branch]);
}
