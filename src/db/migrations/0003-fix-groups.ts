import type { Migration } from './index.js';

/**
 * Findings that one change fixes together (a template, a sitemap setting)
 * share a fix_group, so the sprint planner counts their effort once.
 * NULL for findings fixed one at a time, and for findings saved before this.
 */
export const fixGroups: Migration = {
  id: 3,
  name: 'fix-groups',
  sql: `
    ALTER TABLE findings ADD COLUMN fix_group TEXT;
  `,
};
