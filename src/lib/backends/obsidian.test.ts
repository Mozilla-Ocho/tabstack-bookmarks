/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HttpError,
  isFatalStatus,
  isRetryableStatus,
  NETWORK_STATUS,
} from '../httpError';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import { obsidianBackend, verifyObsidian } from './obsidian';
import type { SavePayload } from './types';

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  apiKey: 'k',
  backend: 'obsidian',
  obsidian: { baseUrl: 'http://127.0.0.1:27123/', token: 'obs_tok', folder: 'Bookmarks' },
};

const payload: SavePayload = {
  path: 'my note.md',
  content: '# doc',
  title: 'My Note',
  url: 'https://ex.com',
  overwrite: false,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('obsidianBackend.save', () => {
  it('PUTs markdown into the configured vault folder', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 404 })) // existence check
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await obsidianBackend.save(payload, settings);

    const [putUrl, init] = fetchMock.mock.calls[1];
    // Trailing slash on baseUrl must not double up, and segments are encoded.
    expect(putUrl).toBe('http://127.0.0.1:27123/vault/Bookmarks/my%20note.md');
    expect(init.method).toBe('PUT');
    expect(init.headers['Content-Type']).toBe('text/markdown');
    expect(init.headers.Authorization).toBe('Bearer obs_tok');
    expect(init.body).toBe('# doc');
    expect(result.location).toBe('Bookmarks/my note.md');
    expect(result.link).toContain('obsidian://open?file=');
  });

  it('skips the existence check when overwriting', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await obsidianBackend.save({ ...payload, overwrite: true }, settings);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT');
  });

  it('uniquifies when a note already exists', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 200 })) // taken
      .mockResolvedValueOnce(new Response('', { status: 404 })) // -1 free
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await obsidianBackend.save(payload, settings);
    expect(result.location).toBe('Bookmarks/my note-1.md');
  });

  it('refuses rather than overwriting when every candidate name is taken', async () => {
    // PUT replaces a note outright, so running out of suffixes must fail loudly
    // instead of clobbering something the user wrote.
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await expect(obsidianBackend.save(payload, settings)).rejects.toThrow(
      /Could not find a free filename/,
    );
    expect(
      fetchMock.mock.calls.every(([, init]) => (init?.method ?? 'GET') !== 'PUT'),
    ).toBe(true);
  });

  it('reports a write the plugin refused, with its own message', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'vault is read-only' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await expect(obsidianBackend.save(payload, settings)).rejects.toThrow(
      'Obsidian write failed (405). vault is read-only',
    );
  });

  it('stops the run when the existence check is unauthorized', async () => {
    // Not a per-item failure: the same key will reject every remaining bookmark.
    fetchMock.mockResolvedValueOnce(
      new Response('{}', {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const failure = await obsidianBackend
      .save(payload, settings)
      .catch((error: unknown) => error);

    expect((failure as HttpError).status).toBe(401);
    expect(isFatalStatus((failure as HttpError).status)).toBe(true);
  });

  it('reports an unreachable plugin as retryable, not as a bad note', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const failure = await obsidianBackend
      .save(payload, settings)
      .catch((error: unknown) => error);

    expect((failure as HttpError).status).toBe(NETWORK_STATUS);
    expect(isRetryableStatus((failure as HttpError).status)).toBe(true);
  });

  it('explains a rejected API key', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(obsidianBackend.save(payload, settings)).rejects.toThrow(
      /rejected the API key \(401\)/,
    );
  });

  it('explains an unreachable plugin', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(obsidianBackend.save(payload, settings)).rejects.toThrow(
      /Could not reach Obsidian at http:\/\/127.0.0.1:27123/,
    );
  });

  it('calls out the self-signed HTTPS port when that is what is configured', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(
      obsidianBackend.save(payload, {
        ...settings,
        obsidian: { ...settings.obsidian, baseUrl: 'https://127.0.0.1:27124' },
      }),
    ).rejects.toThrow(/self-signed certificate/);
  });
});

describe('verifyObsidian', () => {
  it('rejects when the plugin says we are not authenticated', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(verifyObsidian(settings.obsidian)).rejects.toThrow(/not accepted/);
  });

  it('reports the Obsidian version on success', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          authenticated: true,
          service: 'Obsidian Local REST API',
          versions: { obsidian: '1.9.0' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(verifyObsidian(settings.obsidian)).resolves.toContain('1.9.0');
  });
});
