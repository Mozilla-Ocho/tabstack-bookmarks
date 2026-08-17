/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError, isRetryableStatus } from '../httpError';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import { githubBackend, verifyGitHub } from './github';
import type { SavePayload } from './types';

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  apiKey: 'ts_key',
  backend: 'github',
  github: {
    token: 'gh_tok',
    owner: 'me',
    repo: 'notes',
    branch: 'main',
    folder: 'bookmarks',
  },
};

const payload: SavePayload = {
  path: '2026-08-14-post.md',
  content: '---\ntitle: "Post"\n---\n\nBody\n',
  title: 'Post',
  url: 'https://ex.com/post',
  overwrite: false,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('githubBackend.save', () => {
  it('creates a new file under the configured folder', async () => {
    fetchMock
      .mockResolvedValueOnce(json(404, { message: 'Not Found' })) // sha lookup
      .mockResolvedValueOnce(json(201, { content: { html_url: 'https://gh/blob' } }));

    const result = await githubBackend.save(payload, settings);

    const [lookupUrl] = fetchMock.mock.calls[0];
    expect(lookupUrl).toContain('/repos/me/notes/contents/bookmarks/2026-08-14-post.md');
    expect(lookupUrl).toContain('?ref=main');

    const [putUrl, init] = fetchMock.mock.calls[1];
    expect(putUrl).toContain('/contents/bookmarks/2026-08-14-post.md');
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body as string);
    expect(body.branch).toBe('main');
    expect(body.sha).toBeUndefined();
    expect(body.message).toBe('Add bookmark: Post');
    expect(atob(body.content)).toContain('Body');

    expect(result).toEqual({
      location: 'me/notes/bookmarks/2026-08-14-post.md',
      link: 'https://gh/blob',
    });
  });

  it('uniquifies the filename instead of clobbering an existing note', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { sha: 'a', type: 'file' })) // taken
      .mockResolvedValueOnce(json(404, {})) // -1 is free
      .mockResolvedValueOnce(json(201, {}));

    const result = await githubBackend.save(payload, settings);
    expect(result.location).toBe('me/notes/bookmarks/2026-08-14-post-1.md');
    const body = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(body.sha).toBeUndefined();
  });

  it('sends the existing sha when overwriting', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { sha: 'deadbeef', type: 'file' }))
      .mockResolvedValueOnce(json(200, {}));

    await githubBackend.save({ ...payload, overwrite: true }, settings);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(body.sha).toBe('deadbeef');
    expect(body.message).toBe('Update bookmark: Post');
  });

  it('encodes path segments but keeps separators', async () => {
    fetchMock.mockResolvedValueOnce(json(404, {})).mockResolvedValueOnce(json(201, {}));
    await githubBackend.save({ ...payload, path: '2026/08/a b & c.md' }, settings);
    expect(fetchMock.mock.calls[1][0]).toContain('bookmarks/2026/08/a%20b%20%26%20c.md');
  });

  it('explains an unreachable GitHub', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('NetworkError'));
    await expect(githubBackend.save(payload, settings)).rejects.toThrow(
      /Could not reach api\.github\.com/,
    );
  });

  it('explains a rejected token', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { message: 'Bad credentials' }));
    await expect(githubBackend.save(payload, settings)).rejects.toThrow(
      /GitHub rejected the token \(401\)/,
    );
  });

  it('says which of owner, repo and branch to check on a 404 lookup', async () => {
    // A 404 from the *lookup* means "no file yet", so the 404 message can only
    // come from the commit itself.
    fetchMock
      .mockResolvedValueOnce(json(404, {}))
      .mockResolvedValueOnce(json(404, { message: 'Not Found' }));

    await expect(githubBackend.save(payload, settings)).rejects.toThrow(
      /GitHub repo or branch not found \(404\)\. Check owner, repo and branch/,
    );
  });

  it('carries the status so an import can decide what to do', async () => {
    fetchMock.mockResolvedValueOnce(json(403, { message: 'rate limited' }));

    const failure = await githubBackend
      .save(payload, settings)
      .catch((error: unknown) => error);

    // 403 is retryable (GitHub uses it for secondary rate limits), 404 is not.
    expect((failure as HttpError).status).toBe(403);
    expect(isRetryableStatus((failure as HttpError).status)).toBe(true);
  });

  it('reports a lookup that failed for some other reason', async () => {
    fetchMock.mockResolvedValueOnce(json(500, { message: 'server error' }));
    await expect(githubBackend.save(payload, settings)).rejects.toThrow(
      /GitHub lookup failed \(500\)/,
    );
  });

  it('refuses to write over a directory', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { type: 'dir', sha: 'abc' }));
    await expect(
      githubBackend.save({ ...payload, overwrite: true }, settings),
    ).rejects.toThrow('A dir already exists at bookmarks/2026-08-14-post.md.');
  });

  it('gives up rather than guessing forever when every name is taken', async () => {
    // A fresh Response per call: a body can only be read once, so a single
    // shared one would fail the second lookup with a TypeError instead.
    fetchMock.mockImplementation(() => json(200, { type: 'file', sha: 'abc' }));
    await expect(githubBackend.save(payload, settings)).rejects.toThrow(
      /Could not find a free filename near bookmarks\/2026-08-14-post\.md/,
    );
  });

  it('falls back to a blob URL when the response has none', async () => {
    fetchMock.mockResolvedValueOnce(json(404, {})).mockResolvedValueOnce(json(201, {}));
    const result = await githubBackend.save(payload, settings);
    expect(result.link).toBe(
      'https://github.com/me/notes/blob/main/bookmarks/2026-08-14-post.md',
    );
  });
});

describe('verifyGitHub', () => {
  it('rejects a repo the token cannot push to', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        full_name: 'me/notes',
        default_branch: 'main',
        permissions: { push: false },
      }),
    );
    await expect(verifyGitHub(settings.github)).rejects.toThrow(
      /cannot write to me\/notes/,
    );
  });

  it('explains an unreachable GitHub', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('NetworkError'));
    await expect(verifyGitHub(settings.github)).rejects.toThrow(
      /Could not reach api\.github\.com/,
    );
  });

  it('reports the default branch on success', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        full_name: 'me/notes',
        default_branch: 'trunk',
        permissions: { push: true },
      }),
    );
    await expect(verifyGitHub(settings.github)).resolves.toContain('trunk');
  });
});
