/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ContentScope, Effort } from './settings';

export const TABSTACK_API = 'https://api.tabstack.ai/v1';

export interface PageMetadata {
  title?: string;
  description?: string;
  author?: string;
  publisher?: string;
  image?: string;
  site_name?: string;
  url?: string;
  type?: string;
  [key: string]: unknown;
}

export interface ExtractMarkdownResponse {
  content: string;
  url: string;
  metadata?: PageMetadata;
}

export interface ExtractOptions {
  apiKey: string;
  url: string;
  effort?: Effort;
  contentScope?: ContentScope;
  nocache?: boolean;
}

/** Human-readable messages for the documented failure codes. */
function statusMessage(status: number, body: string): string {
  switch (status) {
    case 401:
      return 'Tabstack rejected the API key (401). Check it in the extension options.';
    case 402:
      return 'Tabstack organization is out of credits (402).';
    case 422:
      return `Tabstack could not fetch this URL (422). ${body}`.trim();
    case 429:
      return 'Tabstack rate limit hit (429). Try again in a moment.';
    default:
      return `Tabstack request failed (${status}). ${body}`.trim();
  }
}

/** Turns a failed response into an Error carrying the API's own message. */
async function apiError(res: Response): Promise<TabstackError> {
  let detail: string;
  try {
    const json = (await res.json()) as { error?: string };
    detail = json.error ?? '';
  } catch {
    // Not JSON — the body text is the next best thing.
    detail = await res.text().catch(() => '');
  }
  return new TabstackError(statusMessage(res.status, detail), res.status);
}

/** Carries the HTTP status so callers can back off or abort on 429/402. */
export class TabstackError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TabstackError';
    this.status = status;
  }
}

/** POST /extract/markdown — fetches the URL and returns clean markdown. */
export async function extractMarkdown(
  opts: ExtractOptions,
): Promise<ExtractMarkdownResponse> {
  const res = await fetch(`${TABSTACK_API}/extract/markdown`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: opts.url,
      // Ask for metadata separately so we can build our own frontmatter.
      metadata: true,
      content: opts.contentScope ?? 'main',
      effort: opts.effort ?? 'standard',
      nocache: opts.nocache ?? false,
    }),
  });

  if (!res.ok) throw await apiError(res);

  return (await res.json()) as ExtractMarkdownResponse;
}

export interface PageSummary {
  summary: string;
  key_points: string[];
  tags: string[];
}

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description:
        'Two or three sentences describing what this page is and why it is worth keeping.',
    },
    key_points: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Three to five short bullets with the concrete specifics worth remembering.',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Three to six topic tags, lowercase, single word or hyphenated, no leading hash.',
    },
  },
  required: ['summary', 'key_points', 'tags'],
} as const;

const SUMMARY_INSTRUCTIONS = [
  'You are annotating a bookmark for later recall.',
  'Write a factual summary of this page, list the specifics worth remembering, and suggest topic tags.',
  'Describe only what the page actually says; never invent details.',
  'Keep the tone plain and skip marketing language.',
].join(' ');

export interface SummaryOptions {
  apiKey: string;
  url: string;
  effort?: Effort;
  nocache?: boolean;
}

/** POST /generate/json — AI summary, key points and suggested tags for a page. */
export async function generateSummary(opts: SummaryOptions): Promise<PageSummary> {
  const res = await fetch(`${TABSTACK_API}/generate/json`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: opts.url,
      json_schema: SUMMARY_SCHEMA,
      instructions: SUMMARY_INSTRUCTIONS,
      effort: opts.effort ?? 'standard',
      nocache: opts.nocache ?? false,
    }),
  });

  if (!res.ok) throw await apiError(res);

  const json = (await res.json()) as Partial<PageSummary>;
  return {
    summary: typeof json.summary === 'string' ? json.summary.trim() : '',
    key_points: (Array.isArray(json.key_points) ? json.key_points : [])
      .filter(
        (point): point is string => typeof point === 'string' && point.trim() !== '',
      )
      .map((point) => point.trim()),
    tags: (Array.isArray(json.tags) ? json.tags : [])
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim().replace(/^#/, '').toLowerCase())
      .filter(Boolean),
  };
}
