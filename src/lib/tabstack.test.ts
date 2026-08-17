/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NETWORK_STATUS } from './httpError';
import {
  extractMarkdown,
  generateSummary,
  TABSTACK_API,
  TabstackError,
} from './tabstack';

let fetchMock: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('extractMarkdown', () => {
  it('posts the URL with metadata and the configured effort and scope', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ content: '# doc', url: 'https://ex.com/a', metadata: { title: 'A' } }),
    );

    const result = await extractMarkdown({
      apiKey: 'ts_key',
      url: 'https://ex.com/a',
      effort: 'max',
      contentScope: 'full',
      nocache: true,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${TABSTACK_API}/extract/markdown`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer ts_key');
    expect(JSON.parse(init.body)).toEqual({
      url: 'https://ex.com/a',
      metadata: true,
      content: 'full',
      effort: 'max',
      nocache: true,
    });
    expect(result.content).toBe('# doc');
  });

  it('defaults effort, scope and cache-busting', async () => {
    fetchMock.mockResolvedValueOnce(json({ content: '', url: 'https://ex.com/a' }));
    await extractMarkdown({ apiKey: 'k', url: 'https://ex.com/a' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      content: 'main',
      effort: 'standard',
      nocache: false,
    });
  });
});

/**
 * These statuses are load-bearing: importQueue decides between backing off,
 * failing one item and stopping the whole run from them.
 */
describe('failure statuses', () => {
  const cases: Array<[number, RegExp]> = [
    [401, /rejected the API key \(401\)/],
    [402, /out of credits \(402\)/],
    [422, /could not fetch this URL \(422\)/],
    [429, /rate limit hit \(429\)/],
    [500, /request failed \(500\)/],
  ];

  it.each(cases)(
    'turns %i into a TabstackError carrying the status',
    async (status, message) => {
      fetchMock.mockResolvedValueOnce(json({ error: 'upstream said no' }, status));

      const failure = await extractMarkdown({
        apiKey: 'k',
        url: 'https://ex.com/a',
      }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(TabstackError);
      expect((failure as TabstackError).status).toBe(status);
      expect((failure as Error).message).toMatch(message);
    },
  );

  it('falls back to the body text when the error is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('gateway exploded', { status: 502 }));
    await expect(
      extractMarkdown({ apiKey: 'k', url: 'https://ex.com/a' }),
    ).rejects.toThrow(/gateway exploded/);
  });

  it('reports an unreachable API as a retryable network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const failure = await extractMarkdown({ apiKey: 'k', url: 'https://ex.com/a' }).catch(
      (error: unknown) => error,
    );

    // Status 0, not undefined: an unattended import must retry this rather than
    // record a permanent failure.
    expect((failure as TabstackError).status).toBe(NETWORK_STATUS);
    expect((failure as Error).message).toMatch(/Could not reach api.tabstack.ai/);
  });
});

describe('generateSummary', () => {
  it('sends a schema and instructions, and trims what comes back', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        summary: '  A page about things.  ',
        key_points: [' first ', '', 'second', 42],
        tags: ['#Rust', ' web ', '', 7],
      }),
    );

    const summary = await generateSummary({ apiKey: 'k', url: 'https://ex.com/a' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toBe(`${TABSTACK_API}/generate/json`);
    expect(body.json_schema.required).toEqual(['summary', 'key_points', 'tags']);
    expect(body.instructions).toMatch(/never invent details/);

    expect(summary).toEqual({
      summary: 'A page about things.',
      key_points: ['first', 'second'],
      // Leading hashes stripped, lowercased, blanks and non-strings dropped.
      tags: ['rust', 'web'],
    });
  });

  it('tolerates a response missing every field', async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    expect(await generateSummary({ apiKey: 'k', url: 'https://ex.com/a' })).toEqual({
      summary: '',
      key_points: [],
      tags: [],
    });
  });
});
