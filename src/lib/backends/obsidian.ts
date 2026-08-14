/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { joinPath } from '../markdown';
import type { ObsidianSettings, Settings } from '../settings';
import type { SavePayload, SaveResult, StorageBackend } from './types';

/** Obsidian Local REST API plugin: https://coddingtonbear.github.io/obsidian-local-rest-api/ */
function base(cfg: ObsidianSettings): string {
  return cfg.baseUrl.trim().replace(/\/+$/, '');
}

function vaultUrl(cfg: ObsidianSettings, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${base(cfg)}/vault/${encoded}`;
}

function reachError(error: unknown, cfg: ObsidianSettings): Error {
  const https = base(cfg).startsWith('https:');
  return new Error(
    `Could not reach Obsidian at ${base(cfg)}. Make sure Obsidian is running with the ` +
      `Local REST API plugin enabled.${
        https
          ? " The plugin's HTTPS port uses a self-signed certificate that extensions reject — enable its HTTP port (default 27123) instead."
          : ''
      }` +
      ` (${error instanceof Error ? error.message : String(error)})`,
  );
}

async function statusError(res: Response): Promise<Error> {
  const detail = await res
    .json()
    .then((json) => (json as { message?: string }).message ?? '')
    .catch(() => '');
  if (res.status === 401) {
    return new Error(
      'Obsidian rejected the API key (401). Copy it from the plugin settings.',
    );
  }
  return new Error(`Obsidian write failed (${res.status}). ${detail}`.trim());
}

async function exists(cfg: ObsidianSettings, path: string): Promise<boolean> {
  const res = await fetch(vaultUrl(cfg, path), {
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
  });
  if (res.status === 404) return false;
  if (res.status === 401) throw await statusError(res);
  return res.ok;
}

export const obsidianBackend: StorageBackend = {
  id: 'obsidian',
  label: 'Obsidian vault (Local REST API)',
  shortLabel: 'Obsidian',

  async save(payload: SavePayload, settings: Settings): Promise<SaveResult> {
    const cfg = settings.obsidian;
    let path = joinPath(cfg.folder, payload.path);

    try {
      if (!payload.overwrite) {
        const dot = path.lastIndexOf('.');
        const stem = dot > 0 ? path.slice(0, dot) : path;
        const ext = dot > 0 ? path.slice(dot) : '';
        for (let n = 1; n < 50 && (await exists(cfg, path)); n++) {
          path = `${stem}-${n}${ext}`;
        }
      }

      // PUT replaces the note at this path; the plugin creates folders as needed.
      const res = await fetch(vaultUrl(cfg, path), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          'Content-Type': 'text/markdown',
        },
        body: payload.content,
      });
      if (!res.ok) throw await statusError(res);

      return {
        location: path,
        link: `obsidian://open?file=${encodeURIComponent(path)}`,
      };
    } catch (error) {
      if (error instanceof TypeError) throw reachError(error, cfg);
      throw error;
    }
  },
};

/** Options-page connection check. */
export async function verifyObsidian(cfg: ObsidianSettings): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${base(cfg)}/`, {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
    });
  } catch (error) {
    throw reachError(error, cfg);
  }
  if (!res.ok) throw await statusError(res);
  const json = (await res.json()) as {
    authenticated?: boolean;
    service?: string;
    versions?: { obsidian?: string };
  };
  if (json.authenticated === false) {
    throw new Error('Obsidian is reachable but the API key was not accepted.');
  }
  return `Connected to ${json.service ?? 'Obsidian'}${
    json.versions?.obsidian ? ` ${json.versions.obsidian}` : ''
  }.`;
}
