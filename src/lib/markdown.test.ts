/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import {
  buildFrontmatter,
  composeDocument,
  joinPath,
  parseTags,
  renderFilename,
  slugForPage,
  slugify,
  stripFrontmatter,
} from './markdown';

const DATE = new Date('2026-08-14T10:30:00Z');

describe('slugify', () => {
  it('folds accents, punctuation and repeats', () => {
    expect(slugify('Héllo, World! A “Post”')).toBe('hello-world-a-post');
    expect(slugify('---weird___name---')).toBe('weird-name');
  });

  it('never returns an empty slug', () => {
    expect(slugify('!!!')).toBe('bookmark');
  });

  it('truncates without a trailing dash', () => {
    expect(slugify('a'.repeat(40) + ' ' + 'b'.repeat(40), 41)).toBe('a'.repeat(40));
  });
});

describe('slugForPage', () => {
  it('falls back to the last path segment, then the host', () => {
    expect(slugForPage('', 'https://ex.com/blog/my-post')).toBe('my-post');
    expect(slugForPage(undefined, 'https://ex.com/')).toBe('ex-com');
    expect(slugForPage('', 'not a url')).toBe('bookmark');
  });
});

describe('renderFilename', () => {
  it('expands tokens and appends .md', () => {
    expect(
      renderFilename('{date}-{slug}', {
        title: 'My Post',
        url: 'https://ex.com',
        date: DATE,
      }),
    ).toBe('2026-08-14-my-post.md');
  });

  it('keeps template slashes as folders', () => {
    expect(
      renderFilename('{yyyy}/{mm}/{host}/{slug}.md', {
        title: '',
        url: 'https://www.example.com/blog/attention?x=1',
        date: DATE,
      }),
    ).toBe('2026/08/example.com/attention.md');
  });

  it('strips path separators coming from token values', () => {
    expect(
      renderFilename('{title}.md', {
        title: 'a/b:c*d?e"f<g>h|i',
        url: 'https://x.com',
        date: DATE,
      }),
    ).toBe('a-b-c-d-e-f-g-h-i.md');
  });

  it('drops dot segments from the template itself', () => {
    // The template is free text in the options page. Tokens are sanitised, but
    // the slashes around them are not, so `..` has to be dropped here.
    expect(
      renderFilename('../../{slug}', { title: 'Post', url: 'https://x.com', date: DATE }),
    ).toBe('post.md');
    expect(
      renderFilename('./notes/{slug}', {
        title: 'Post',
        url: 'https://x.com',
        date: DATE,
      }),
    ).toBe('notes/post.md');
  });

  it('leaves unknown tokens alone', () => {
    expect(
      renderFilename('{nope}-{slug}.md', {
        title: 'x',
        url: 'https://x.com',
        date: DATE,
      }),
    ).toBe('{nope}-x.md');
  });
});

describe('joinPath', () => {
  it('trims surrounding slashes', () => {
    expect(joinPath('/bookmarks/', 'a.md')).toBe('bookmarks/a.md');
    expect(joinPath('', 'a.md')).toBe('a.md');
  });
});

describe('parseTags', () => {
  it('splits, trims, drops empties and leading hashes', () => {
    expect(parseTags('#one, two\n three,,')).toEqual(['one', 'two', 'three']);
  });
});

describe('buildFrontmatter', () => {
  const fm = buildFrontmatter({
    title: 'He said "hi"\nagain',
    url: 'https://ex.com',
    savedAt: DATE,
    tags: ['a', 'a', 'b', ' '],
    note: 'note "q"',
    metadata: { description: 'multi\nline', author: 'X', bogus: 5 },
  });

  it('escapes quotes and flattens newlines', () => {
    expect(fm).toContain('title: "He said \\"hi\\" again"');
    expect(fm).toContain('description: "multi line"');
  });

  it('dedupes tags and drops blanks', () => {
    expect(fm).toContain('tags:\n  - "a"\n  - "b"');
  });

  it('ignores metadata fields it does not know', () => {
    expect(fm).not.toContain('bogus');
  });

  it('omits optional keys that are absent', () => {
    const bare = buildFrontmatter({ title: 't', url: 'u', savedAt: DATE, tags: [] });
    expect(bare).not.toContain('tags:');
    expect(bare).not.toContain('author:');
    expect(bare.split('\n').at(-1)).toBe('---');
  });
});

describe('stripFrontmatter / composeDocument', () => {
  it('drops an existing frontmatter block', () => {
    expect(stripFrontmatter('---\na: 1\n---\nbody')).toBe('body');
    expect(stripFrontmatter('no frontmatter')).toBe('no frontmatter');
  });

  it('does not strip a horizontal rule mid-document', () => {
    expect(stripFrontmatter('# Title\n\n---\n\ntext')).toBe('# Title\n\n---\n\ntext');
  });

  it('emits exactly one frontmatter block plus the note quote', () => {
    const doc = composeDocument(
      '---\ntitle: "t"\n---',
      '---\ntitle: old\n---\n\n# Body',
      'read later',
    );
    expect(doc.match(/^---$/gm)).toHaveLength(2);
    expect(doc).toContain('> read later');
    expect(doc.endsWith('# Body\n')).toBe(true);
  });

  it('quotes every line of a multi-line note', () => {
    const doc = composeDocument('---\n---', 'body', 'one\ntwo');
    expect(doc).toContain('> one\n> two');
  });
});
