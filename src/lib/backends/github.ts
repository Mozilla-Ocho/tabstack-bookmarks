import { joinPath } from '../markdown';
import type { GitHubSettings, Settings } from '../settings';
import { toBase64, type SavePayload, type SaveResult, type StorageBackend } from './types';

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
    return new Error(
      `Could not reach api.github.com. Check your connection, and that the extension has ` +
        `permission to reach it. (${error.message})`,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function errorFrom(res: Response, fallback: string): Promise<Error> {
  let message = '';
  try {
    const json = (await res.json()) as { message?: string };
    message = json.message ?? '';
  } catch {
    message = '';
  }
  if (res.status === 401 || res.status === 403) {
    return new Error(
      `GitHub rejected the token (${res.status}). It needs "Contents: read and write" on this repo. ${message}`.trim(),
    );
  }
  if (res.status === 404) {
    return new Error(
      `GitHub repo or branch not found (404). Check owner, repo and branch. ${message}`.trim(),
    );
  }
  return new Error(`${fallback} (${res.status}). ${message}`.trim());
}

/** Returns the blob sha of an existing file, or null when it does not exist. */
async function getSha(
  cfg: GitHubSettings,
  path: string,
): Promise<string | null> {
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(cfg.branch)}`;
  const res = await fetch(url, { headers: headers(cfg.token) });
  if (res.status === 404) return null;
  if (!res.ok) throw await errorFrom(res, 'GitHub lookup failed');
  const json = (await res.json()) as { sha?: string; type?: string };
  if (json.type && json.type !== 'file') {
    throw new Error(`A ${json.type} already exists at ${path}.`);
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
  throw new Error(`Could not find a free filename near ${path}.`);
}

export const githubBackend: StorageBackend = {
  id: 'github',
  label: 'GitHub repo',
  shortLabel: 'GitHub',

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

  if (!res.ok) throw await errorFrom(res, 'GitHub commit failed');

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
  if (!res.ok) throw await errorFrom(res, 'GitHub check failed');
  const repo = (await res.json()) as {
    full_name: string;
    default_branch: string;
    permissions?: { push?: boolean };
  };
  if (repo.permissions && !repo.permissions.push) {
    throw new Error(`Token cannot write to ${repo.full_name}.`);
  }
  return `Connected to ${repo.full_name} (default branch: ${repo.default_branch}).`;
}
