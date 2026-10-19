import type { SourceAdapter } from "./types";
import { greenhouseAdapter } from "./greenhouse";
import { leverAdapter } from "./lever";

/** Adapters that can be polled on a schedule. Imports/bookmarks (JSON, CSV, email, LinkedIn links, manual URLs) live in ./import. */
export const SCHEDULED_ADAPTERS: Record<string, SourceAdapter> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
};

export function getAdapter(kind: string, overrides?: Record<string, SourceAdapter>): SourceAdapter | null {
  return overrides?.[kind] ?? SCHEDULED_ADAPTERS[kind] ?? null;
}
