import { Client } from "@elastic/elasticsearch";
import { config } from "../config.js";

const client = new Client({ node: config.elasticsearchUrl });
const index = "scheduled-emails";
let searchAvailable = false;
export async function ensureSearchIndex() {
  try {
    const exists = await client.indices.exists({ index });
    if (!exists) await client.indices.create({ index, mappings: { properties: { userId: { type: "keyword" }, recipient: { type: "search_as_you_type" }, subject: { type: "search_as_you_type" }, status: { type: "keyword" }, scheduledAt: { type: "date" }, sentAt: { type: "date" } } } });
    searchAvailable = true;
  } catch (error) { console.warn("Elasticsearch is unavailable; search will use the database until it reconnects.", error instanceof Error ? error.message : error); }
}
export async function indexEmail(row: Record<string, unknown>) {
  if (!searchAvailable) return;
  try { await client.index({ index, id: String(row.id), document: { userId: row.user_id, recipient: row.recipient, subject: row.subject, status: row.status, scheduledAt: row.scheduled_at, sentAt: row.sent_at }, refresh: "wait_for" }); } catch (error) { searchAvailable = false; console.warn("Unable to index email document.", error instanceof Error ? error.message : error); }
}
export async function searchEmailIds(userId: string, query: string) {
  if (!searchAvailable) return null;
  try { const result = await client.search<{ }>( { index, query: { bool: { filter: [{ term: { userId } }], must: [{ multi_match: { query, fields: ["recipient", "recipient._2gram", "subject", "subject._2gram"] } }] } }, size: 100 }); return result.hits.hits.map((hit) => hit._id!).filter(Boolean); } catch (error) { searchAvailable = false; console.warn("Unable to search Elasticsearch.", error instanceof Error ? error.message : error); return null; }
}
