import { getBackend } from './backends';
import {
  buildFrontmatter,
  composeDocument,
  renderFilename,
} from './markdown';
import type { SaveRecord, SaveRequest } from './messages';
import { hasOrigin } from './permissions';
import { backendOrigin, configErrors, getSettings } from './settings';
import { extractMarkdown, generateSummary, TabstackError } from './tabstack';

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
      throw new Error('Only http(s) pages can be saved.');
    }

    const settings = await getSettings();
    const problems = configErrors(settings);
    if (problems.length) {
      throw new Error(`${problems.join(' ')} Open the extension options to fix.`);
    }

    const origin = backendOrigin(settings);
    if (origin && !(await hasOrigin(origin))) {
      throw new Error(
        `The extension is not allowed to talk to ${origin} yet. Open the options page and grant access to the destination.`,
      );
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
      error: undefined,
    });
  } catch (error) {
    return advance({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      errorStatus: error instanceof TabstackError ? error.status : undefined,
    });
  }
}
