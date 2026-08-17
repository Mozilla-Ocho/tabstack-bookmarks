/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { i18n } from '#i18n';
import { getBackend } from './backends';
import { HttpError } from './httpError';
import { buildFrontmatter, composeDocument, renderFilename } from './markdown';
import type { SaveRecord, SaveRequest } from './messages';
import { hasOrigin } from './permissions';
import { backendOrigin, configErrors, getSettings } from './settings';
import { extractMarkdown, generateSummary } from './tabstack';

export function isSaveableUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url);
}

/**
 * Extract via Tabstack, then hand the markdown to the configured backend.
 * `onUpdate` is called on every state transition so the popup can follow along.
 */
export async function runSave(
  request: SaveRequest,
  onUpdate: (record: SaveRecord) => void,
): Promise<SaveRecord> {
  const now = Date.now();
  let record: SaveRecord = {
    url: request.url,
    title: request.title,
    status: 'extracting',
    tags: request.tags ?? [],
    note: request.note,
    startedAt: now,
    updatedAt: now,
  };

  const advance = (patch: Partial<SaveRecord>) => {
    record = { ...record, ...patch, updatedAt: Date.now() };
    onUpdate(record);
    return record;
  };

  onUpdate(record);

  try {
    if (!isSaveableUrl(request.url)) {
      throw new Error(i18n.t('errors.notHttp'));
    }

    const settings = await getSettings();
    const problems = configErrors(settings);
    if (problems.length) {
      throw new Error(i18n.t('errors.configProblems', [problems.join(' ')]));
    }

    const origin = backendOrigin(settings);
    if (origin && !(await hasOrigin(origin))) {
      throw new Error(i18n.t('errors.originNotAllowed', [origin]));
    }

    const wantsSummary = request.summarize ?? settings.summarize;

    // /generate/json fetches the page itself, so run it alongside the extract
    // instead of after it. A failed summary must not lose the markdown.
    const [extracted, summary] = await Promise.all([
      extractMarkdown({
        apiKey: settings.apiKey,
        url: request.url,
        effort: settings.effort,
        contentScope: settings.contentScope,
        nocache: settings.nocache,
      }),
      wantsSummary
        ? generateSummary({
            apiKey: settings.apiKey,
            url: request.url,
            effort: settings.effort,
            nocache: settings.nocache,
          }).catch((error: unknown) => {
            advance({
              summaryError: error instanceof Error ? error.message : String(error),
            });
            return null;
          })
        : Promise.resolve(null),
    ]);

    const title =
      request.title.trim() ||
      extracted.metadata?.title?.trim() ||
      extracted.url ||
      request.url;

    const savedAt = new Date();
    const tags = [
      ...(settings.defaultTags ?? []),
      ...(request.tags ?? []),
      ...(summary && settings.useSuggestedTags ? summary.tags : []),
    ];
    const document = composeDocument(
      buildFrontmatter({
        title,
        url: extracted.url || request.url,
        savedAt,
        tags,
        note: request.note,
        summary: summary?.summary,
        metadata: extracted.metadata,
      }),
      extracted.content,
      request.note,
      summary?.key_points,
    );

    const path =
      request.overwritePath ??
      renderFilename(settings.filenameTemplate, {
        title,
        url: extracted.url || request.url,
        date: savedAt,
      });

    advance({
      status: 'storing',
      title,
      path,
      tags,
      backend: settings.backend,
      summary: summary?.summary,
      bytes: new TextEncoder().encode(document).length,
    });

    const result = await getBackend(settings.backend).save(
      {
        path,
        content: document,
        title,
        url: extracted.url || request.url,
        overwrite: Boolean(request.overwritePath),
      },
      settings,
    );

    return advance({
      status: 'done',
      location: result.location,
      link: result.link,
      downloadId: result.downloadId,
      error: undefined,
      // A previous attempt may have left these behind.
      errorStatus: undefined,
      retryAt: undefined,
    });
  } catch (error) {
    return advance({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      // Any HTTP source, not just Tabstack: the import queue needs a GitHub or
      // Obsidian status too, or a bad destination token fails every item one at
      // a time — each paying for a full extraction first.
      errorStatus: error instanceof HttpError ? error.status : undefined,
    });
  }
}
