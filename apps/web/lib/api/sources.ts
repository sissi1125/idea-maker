/**
 * 官网来源 API client — feat-400.1 / 验收 3.1
 */

import { apiFetch } from "./client";

export interface SourceRecord {
  id: string;
  kind: string;
  root_url: string;
  host: string;
  status: string;
  created_at: string;
}
export interface SourcePage {
  id: string;
  source_record_id: string;
  url: string;
  path: string;
  title: string | null;
  page_type: string;
  fetched_at: string;
}

export async function listSources(projectId: string): Promise<{ records: SourceRecord[]; pages: SourcePage[] }> {
  return apiFetch(`/projects/${projectId}/sources`);
}

export async function importWebsite(
  projectId: string,
  url: string,
  opts: { maxPages?: number; maxDepth?: number; replaceExisting?: boolean } = {},
): Promise<{ result: { pagesFetched: number; pagesSkipped: number; assetsImported: number; ragChunksEmbedded: number; pages: unknown[] } }> {
  return apiFetch(`/projects/${projectId}/sources/import-website`, {
    method: "POST",
    body: { url, ...opts },
  });
}
