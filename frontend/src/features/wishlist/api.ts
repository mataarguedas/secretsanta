import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { UserPublic } from '@/features/events/api';
import { apiClient } from '@/lib/apiClient';

/** Backend `app/schemas/wishlists.py`. */
export type Priority = 'low' | 'medium' | 'high';

export interface WishlistPhoto {
  id: string;
  /** Presigned (1 h). */
  url: string;
  thumb_url: string;
  width: number;
  height: number;
}

export interface WishlistItem {
  id: string;
  title: string;
  note: string | null;
  url: string | null;
  price_crc: number | null;
  priority: Priority;
  position: number;
  photos: WishlistPhoto[];
}

export interface Wishlist {
  owner: UserPublic;
  is_self: boolean;
  items: WishlistItem[];
}

export interface ItemPayload {
  title: string;
  note: string | null;
  url: string | null;
  price_crc: number | null;
  priority: Priority;
}

export const wishlistKeys = {
  list: (eventId: string, userId: string) => ['events', eventId, 'wishlists', userId] as const,
};

export function useWishlist(eventId: string, userId: string | null) {
  return useQuery({
    queryKey: wishlistKeys.list(eventId, userId ?? ''),
    queryFn: ({ signal }) =>
      apiClient.get<Wishlist>(`/events/${eventId}/wishlists/${userId ?? ''}`, { signal }),
    enabled: userId !== null,
  });
}

/** Owner-only mutations on the signed-in user's own list (`ownerId` = their user id). */
export function useCreateItem(eventId: string, ownerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ItemPayload) =>
      apiClient.post<WishlistItem>(`/events/${eventId}/wishlist/items`, payload),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: wishlistKeys.list(eventId, ownerId) }),
  });
}

export function useUpdateItem(eventId: string, ownerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<ItemPayload> }) =>
      apiClient.patch<WishlistItem>(`/events/${eventId}/wishlist/items/${id}`, payload),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: wishlistKeys.list(eventId, ownerId) }),
  });
}

export function useDeleteItem(eventId: string, ownerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<undefined>(`/events/${eventId}/wishlist/items/${id}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: wishlistKeys.list(eventId, ownerId) }),
  });
}

/**
 * FR-WSH-4: optimistic. The list re-renders in the new order at once and rolls back if
 * the server refuses; it's refetched either way.
 */
export function useReorderItems(eventId: string, ownerId: string) {
  const queryClient = useQueryClient();
  const key = wishlistKeys.list(eventId, ownerId);
  return useMutation({
    mutationFn: (itemIds: string[]) =>
      apiClient.put<WishlistItem[]>(`/events/${eventId}/wishlist/order`, { item_ids: itemIds }),
    onMutate: async (itemIds) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Wishlist>(key);
      if (previous) {
        const byId = new Map(previous.items.map((item) => [item.id, item]));
        const items = itemIds
          .map((id, position) => {
            const item = byId.get(id);
            return item ? { ...item, position } : undefined;
          })
          .filter((item): item is WishlistItem => item !== undefined);
        queryClient.setQueryData<Wishlist>(key, { ...previous, items });
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Move one id to `to` (an index in the same list). */
export function moveId(ids: string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from === -1 || to < 0 || to >= ids.length || from === to) return ids;
  const next = ids.filter((value) => value !== id);
  next.splice(to, 0, id);
  return next;
}
