import type { Session } from "@shopify/shopify-api";
import { adminGraphql } from "@/lib/admin";
import { createJsonlParser } from "@/lib/sync/transform";

export type BulkStatus = {
  id: string;
  status: "CREATED" | "RUNNING" | "COMPLETED" | "CANCELING" | "CANCELED" | "FAILED" | "EXPIRED";
  errorCode: string | null;
  objectCount: string;
  url: string | null;
};

/** Thrown when the shop already has a bulk query running; the job retries later. */
export class BulkBusyError extends Error {
  name = "BulkBusyError";
}

const RUN = `#graphql
  mutation RunBulk($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }`;

const STATUS = `#graphql
  query BulkStatus($id: ID!) {
    node(id: $id) { ... on BulkOperation { id status errorCode objectCount url } }
  }`;

export async function startBulkQuery(session: Session, query: string): Promise<string> {
  type Result = {
    bulkOperationRunQuery: { bulkOperation: { id: string } | null; userErrors: { message: string }[] };
  };
  const data = await adminGraphql<Result>(session, RUN, { query });
  const { bulkOperation, userErrors } = data.bulkOperationRunQuery;
  if (!bulkOperation) {
    const message = userErrors.map((e) => e.message).join("; ");
    if (/in progress|already/i.test(message)) throw new BulkBusyError(message);
    throw new Error(`Bulk query rejected: ${message}`);
  }
  return bulkOperation.id;
}

export async function bulkStatus(session: Session, id: string): Promise<BulkStatus> {
  const data = await adminGraphql<{ node: BulkStatus | null }>(session, STATUS, { id });
  if (!data.node) throw new Error(`Bulk operation ${id} not found`);
  return data.node;
}

/** Streams a bulk result file (JSONL) and returns its rows. `url` is null when the result is empty. */
export async function readJsonl(url: string | null, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
  if (!url) return [];
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`Bulk result download failed: ${res.status}`);
  const rows: Record<string, unknown>[] = [];
  const parser = createJsonlParser();
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rows.push(...parser.push(decoder.decode(value, { stream: true })));
  }
  rows.push(...parser.push(decoder.decode()), ...parser.end());
  return rows;
}
