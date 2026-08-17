/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavePayload } from './backends/types';
import type { SaveRecord } from './messages';

vi.mock('./tabstack', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tabstack')>()),
  extractMarkdown: vi.fn(),
  generateSummary: vi.fn(),
}));
vi.mock('./permissions', () => ({ hasOrigin: vi.fn() }));

import { getBackend } from './backends';
import { hasOrigin } from './permissions';
import { isSaveableUrl, runSave } from './save';
import { setSettings } from './settings';
import { extractMarkdown, generateSummary, TabstackError } from './tabstack';

const extract = vi.mocked(extractMarkdown);
const summarize = vi.mocked(generateSummary);
const originGranted = vi.mocked(hasOrigin);

/** Captures what the backend was handed, without touching the network. */
let saved: SavePayload | undefined;

vi.mock('./backends', () => ({
  getBackend: vi.fn(() => ({
    id: 'download',
    label: 'test',
    shortLabel: 'Test',
    save: vi.fn(async (payload: SavePayload) => {
      saved = payload;
      return { location: `out/${payload.path}`, link: 'https://link' };
    }),
  })),
}));

beforeEach(async () => {
  fakeBrowser.reset();
  vi.clearAllMocks();
  // Filenames and saved_at come from the clock, so pin it.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-14T10:00:00Z'));
  saved = undefined;
  originGranted.mockResolvedValue(true);
  summarize.mockResolvedValue({
    summary: 'A short factual summary.',
    key_points: ['first point', 'second point'],
    tags: ['ai', 'browsers'],
  });
  extract.mockResolvedValue({
    content: '---\ntitle: stale\n---\n\n# Real Title\n\nBody text',
    url: 'https://ex.com/post',
    metadata: { title: 'Real Title', author: 'A. Writer' },
  });
  await setSettings({
    apiKey: 'ts_key',
    backend: 'download',
    filenameTemplate: '{date}-{slug}.md',
    defaultTags: ['inbox'],
  });
});

describe('isSaveableUrl', () => {
  it('accepts http(s) only', () => {
    expect(isSaveableUrl('https://ex.com')).toBe(true);
    expect(isSaveableUrl('http://ex.com')).toBe(true);
    expect(isSaveableUrl('about:blank')).toBe(false);
    expect(isSaveableUrl('file:///tmp/a.html')).toBe(false);
    expect(isSaveableUrl(undefined)).toBe(false);
  });
});

describe('runSave', () => {
  it('strips tracking parameters before doing anything with the URL', async () => {
    const record = await runSave(
      {
        type: 'save',
        url: 'https://ex.com/post?utm_source=newsletter&utm_medium=email&id=7',
        title: 'A Post',
      },
      () => {},
    );

    // The record, and therefore the index key and the library row.
    expect(record.url).toBe('https://ex.com/post?id=7');
    // The URL sent for extraction: no reason to hand a campaign to the API, and
    // a cached extraction is shared across everyone who was sent the link.
    expect(vi.mocked(extractMarkdown).mock.calls[0]![0].url).toBe(
      'https://ex.com/post?id=7',
    );
  });

  it('extracts, composes and stores, reporting each state', async () => {
    const states: SaveRecord[] = [];
    const result = await runSave(
      { type: 'save', url: 'https://ex.com/post', title: '', tags: ['research'] },
      (r) => states.push({ ...r }),
    );

    expect(states.map((s) => s.status)).toEqual(['extracting', 'storing', 'done']);
    expect(result.status).toBe('done');
    expect(result.location).toBe('out/2026-08-14-real-title.md');
    expect(result.link).toBe('https://link');

    expect(extract).toHaveBeenCalledWith({
      apiKey: 'ts_key',
      url: 'https://ex.com/post',
      effort: 'standard',
      contentScope: 'main',
      nocache: false,
    });

    // Title comes from metadata when the tab had none.
    expect(saved!.title).toBe('Real Title');
    expect(saved!.overwrite).toBe(false);
    // Default tags merge ahead of per-save tags, and the stale frontmatter is gone.
    expect(saved!.content).toContain('  - "inbox"\n  - "research"');
    expect(saved!.content).toContain('author: "A. Writer"');
    expect(saved!.content).not.toContain('stale');
    expect(saved!.content.match(/^---$/gm)).toHaveLength(2);
    expect(result.bytes).toBe(new TextEncoder().encode(saved!.content).length);
  });

  it('reuses the previous path and overwrites when re-saving', async () => {
    const result = await runSave(
      {
        type: 'save',
        url: 'https://ex.com/post',
        title: 'Edited',
        overwritePath: 'kept/name.md',
      },
      () => {},
    );

    expect(saved!.path).toBe('kept/name.md');
    expect(saved!.overwrite).toBe(true);
    expect(saved!.content).toContain('title: "Edited"');
    expect(result.status).toBe('done');
  });

  it('adds the note as frontmatter and a blockquote', async () => {
    await runSave(
      { type: 'save', url: 'https://ex.com/post', title: 't', note: 'why I kept this' },
      () => {},
    );
    expect(saved!.content).toContain('note: "why I kept this"');
    expect(saved!.content).toContain('> why I kept this');
  });

  it('refuses non-http URLs before calling the API', async () => {
    const result = await runSave(
      { type: 'save', url: 'about:config', title: '' },
      () => {},
    );
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/Only http\(s\)/);
    expect(extract).not.toHaveBeenCalled();
  });

  it('reports missing configuration instead of calling the API', async () => {
    await setSettings({ apiKey: '' });
    const result = await runSave(
      { type: 'save', url: 'https://ex.com', title: '' },
      () => {},
    );
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/API key is missing.*options/);
    expect(extract).not.toHaveBeenCalled();
  });

  it('stops when the destination origin has not been granted', async () => {
    await setSettings({
      backend: 'obsidian',
      obsidian: { baseUrl: 'http://vault.lan:27123', token: 'obs', folder: 'B' },
    });
    originGranted.mockResolvedValue(false);

    const result = await runSave(
      { type: 'save', url: 'https://ex.com', title: '' },
      () => {},
    );
    expect(originGranted).toHaveBeenCalledWith('http://vault.lan:27123/*');
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/not allowed to talk to http:\/\/vault.lan:27123\/\*/);
    expect(extract).not.toHaveBeenCalled();
  });

  it('surfaces API errors on the record', async () => {
    extract.mockRejectedValue(new Error('Tabstack rate limit hit (429).'));
    const result = await runSave(
      { type: 'save', url: 'https://ex.com', title: '' },
      () => {},
    );
    expect(result.status).toBe('error');
    expect(result.error).toBe('Tabstack rate limit hit (429).');
    expect(getBackend).not.toHaveBeenCalled();
  });

  it('leaves the summary API alone when summaries are off', async () => {
    await runSave({ type: 'save', url: 'https://ex.com/post', title: 't' }, () => {});
    expect(summarize).not.toHaveBeenCalled();
    expect(saved!.content).not.toContain('summary:');
  });

  it('adds summary, key points and suggested tags when asked', async () => {
    const result = await runSave(
      {
        type: 'save',
        url: 'https://ex.com/post',
        title: 't',
        tags: ['mine'],
        summarize: true,
      },
      () => {},
    );

    expect(summarize).toHaveBeenCalledWith({
      apiKey: 'ts_key',
      url: 'https://ex.com/post',
      effort: 'standard',
      nocache: false,
    });
    expect(saved!.content).toContain('summary: "A short factual summary."');
    expect(saved!.content).toContain('## Key points\n\n- first point\n- second point');
    expect(saved!.content).toContain('  - "inbox"\n  - "mine"\n  - "ai"\n  - "browsers"');
    expect(result.summary).toBe('A short factual summary.');
  });

  it('honours the setting when the request does not override it', async () => {
    await setSettings({ summarize: true });
    await runSave({ type: 'save', url: 'https://ex.com/post', title: 't' }, () => {});
    expect(summarize).toHaveBeenCalledOnce();
  });

  it('keeps suggested tags out when useSuggestedTags is off', async () => {
    await setSettings({ summarize: true, useSuggestedTags: false });
    await runSave({ type: 'save', url: 'https://ex.com/post', title: 't' }, () => {});
    expect(saved!.content).toContain('summary: "A short factual summary."');
    expect(saved!.content).not.toContain('- "ai"');
  });

  it('still saves the markdown when the summary call fails', async () => {
    summarize.mockRejectedValue(new TabstackError('Tabstack rate limit hit (429).', 429));
    const result = await runSave(
      { type: 'save', url: 'https://ex.com/post', title: 't', summarize: true },
      () => {},
    );

    expect(result.status).toBe('done');
    expect(result.summaryError).toMatch(/429/);
    expect(saved!.content).not.toContain('summary:');
  });

  it('records the API status so the importer can back off', async () => {
    extract.mockRejectedValue(new TabstackError('Tabstack rate limit hit (429).', 429));
    const result = await runSave(
      { type: 'save', url: 'https://ex.com', title: '' },
      () => {},
    );
    expect(result.errorStatus).toBe(429);
  });

  it('surfaces storage errors on the record', async () => {
    vi.mocked(getBackend).mockReturnValueOnce({
      id: 'download',
      save: vi.fn(async () => {
        throw new Error('Download failed: FILE_ACCESS_DENIED');
      }),
    });
    const result = await runSave(
      { type: 'save', url: 'https://ex.com', title: '' },
      () => {},
    );
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/FILE_ACCESS_DENIED/);
  });
});
