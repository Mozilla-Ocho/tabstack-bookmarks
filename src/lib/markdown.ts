/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { PageMetadata } from './tabstack';

export function slugify(input: string, max = 60): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['"’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, max).replace(/-+$/, '') || 'bookmark';
}

/** Slug source: title, else the URL's last path segment, else the host. */
export function slugForPage(title: string | undefined, url: string): string {
  if (title?.trim()) return slugify(title);
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop();
    return slugify(last ?? parsed.hostname);
  } catch {
    return 'bookmark';
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Strips path separators and characters that break Windows/macOS filenames. */
function sanitizeSegment(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface FilenameVars {
  title: string;
  url: string;
  date: Date;
}

/**
 * Renders a filename template. `/` in the template is kept as a folder
 * separator; tokens themselves can never introduce one.
 */
export function renderFilename(template: string, vars: FilenameVars): string {
  const yyyy = String(vars.date.getFullYear());
  const mm = String(vars.date.getMonth() + 1).padStart(2, '0');
  const dd = String(vars.date.getDate()).padStart(2, '0');
  const tokens: Record<string, string> = {
    yyyy,
    mm,
    dd,
    date: `${yyyy}-${mm}-${dd}`,
    slug: slugForPage(vars.title, vars.url),
    title: sanitizeSegment(vars.title || slugForPage(vars.title, vars.url)),
    host: sanitizeSegment(hostOf(vars.url)),
  };

  const rendered = template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in tokens ? sanitizeSegment(tokens[key]) : match,
  );

  const path = rendered
    .split('/')
    .map((segment) => segment.trim())
    // Token values cannot contain a separator, but the template is free text, so
    // `../../{slug}` is something a user can type. Dropping dot segments keeps a
    // template from writing outside the destination folder.
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .join('/');

  return path.endsWith('.md') ? path : `${path}.md`;
}

export function joinPath(folder: string, filename: string): string {
  const clean = folder.replace(/^\/+|\/+$/g, '');
  return clean ? `${clean}/${filename}` : filename;
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s+/g, ' ').trim()}"`;
}

/** Removes a leading YAML frontmatter block so ours is the only one. */
export function stripFrontmatter(markdown: string): string {
  const match = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  return match ? markdown.slice(match[0].length).replace(/^\s+/, '') : markdown;
}

export interface FrontmatterInput {
  title: string;
  url: string;
  savedAt: Date;
  tags: string[];
  note?: string;
  /** AI summary from /generate/json, when enabled. */
  summary?: string;
  metadata?: PageMetadata;
}

export function buildFrontmatter(input: FrontmatterInput): string {
  const meta = input.metadata ?? {};
  const lines: string[] = ['---'];

  lines.push(`title: ${yamlString(input.title)}`);
  lines.push(`url: ${yamlString(input.url)}`);
  lines.push(`saved_at: ${yamlString(input.savedAt.toISOString())}`);

  const optional: Array<[string, unknown]> = [
    ['description', meta.description],
    ['author', meta.author],
    ['publisher', meta.publisher],
    ['site_name', meta.site_name],
    ['image', meta.image],
    ['type', meta.type],
  ];
  for (const [key, value] of optional) {
    if (typeof value === 'string' && value.trim()) {
      lines.push(`${key}: ${yamlString(value)}`);
    }
  }

  const tags = [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))];
  if (tags.length) {
    lines.push('tags:');
    for (const tag of tags) lines.push(`  - ${yamlString(tag)}`);
  }

  if (input.note?.trim()) lines.push(`note: ${yamlString(input.note)}`);
  if (input.summary?.trim()) lines.push(`summary: ${yamlString(input.summary)}`);

  lines.push('source: tabstack');
  lines.push('---');
  return lines.join('\n');
}

export function composeDocument(
  frontmatter: string,
  markdown: string,
  note?: string,
  keyPoints?: string[],
): string {
  const body = stripFrontmatter(markdown).trimEnd();
  const noteBlock = note?.trim() ? `\n> ${note.trim().replace(/\n/g, '\n> ')}\n` : '';
  const points = (keyPoints ?? []).map((point) => point.trim()).filter(Boolean);
  const pointsBlock = points.length
    ? `\n## Key points\n\n${points.map((point) => `- ${point}`).join('\n')}\n`
    : '';
  return `${frontmatter}\n${noteBlock}${pointsBlock}\n${body}\n`;
}

export function parseTags(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean);
}
