/** Event page tabs (FR-EVT-4). The URL is the source of truth. */

export const EVENT_TABS = ['overview', 'participants', 'wishlists', 'chat', 'manage'] as const;
export type EventTab = (typeof EVENT_TABS)[number];

export const isEventTab = (value: string): value is EventTab =>
  (EVENT_TABS as readonly string[]).includes(value);

/** Overview lives at `/events/:id`; every other tab at `/events/:id/<tab>`. */
export function eventTabPath(id: string, tab: EventTab): string {
  return tab === 'overview' ? `/events/${id}` : `/events/${id}/${tab}`;
}
