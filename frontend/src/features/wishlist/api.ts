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

/** Another of the user's events whose wishlist has items (`GET …/wishlist/copy-sources`). */
export interface CopySource {
  event_id: string;
  name: string;
  item_count: number;
}

export const wishlistKeys = {
  list: (eventId: string, userId: string) => ['events', eventId, 'wishlists', userId] as const,
  copySources: (eventId: string) => ['events', eventId, 'wishlist', 'copy-sources'] as const,
};

/** Photo URLs are presigned for 1 h (PRD §8). */
const PHOTO_URL_TTL = 60 * 60_000;

export function useWishlist(eventId: string, userId: string | null) {
  return useQuery({
    queryKey: wishlistKeys.list(eventId, userId ?? ''),
    queryFn: ({ signal }) =>
      apiClient.get<Wishlist>(`/events/${eventId}/wishlists/${userId ?? ''}`, { signal }),
    enabled: userId !== null,
    // Stale well before the photo URLs expire, so coming back to the tab refetches fresh
    // ones instead of leaving broken images; a visible tab renews them on its own.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: PHOTO_URL_TTL - 10 * 60_000,
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

/** Put a changed item (as the server returned it) into the owner's cached list. */
function replaceItem(list: Wishlist | undefined, item: WishlistItem): Wishlist | undefined {
  return list && { ...list, items: list.items.map((i) => (i.id === item.id ? item : i)) };
}

/**
 * `POST /wishlist/items/{id}/photos` through XHR for progress. The cache is updated in the
 * hook-level callback so it still happens if the sheet closes mid-upload.
 */
export function useUploadPhoto(eventId: string, ownerId: string) {
  const queryClient = useQueryClient();
  const key = wishlistKeys.list(eventId, ownerId);
  return useMutation({
    mutationFn: ({
      itemId,
      file,
      onProgress,
    }: {
      itemId: string;
      file: File;
      onProgress: (fraction: number) => void;
    }) => {
      const form = new FormData();
      form.append('file', file);
      return apiClient.upload<WishlistItem>(`/wishlist/items/${itemId}/photos`, form, {
        onProgress,
      });
    },
    onSuccess: (item) => {
      queryClient.setQueryData<Wishlist>(key, (list) => replaceItem(list, item));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function useDeletePhoto(eventId: string, ownerId: string) {
  const queryClient = useQueryClient();
  const key = wishlistKeys.list(eventId, ownerId);
  return useMutation({
    mutationFn: ({ itemId, photoId }: { itemId: string; photoId: string }) =>
      apiClient.delete<undefined>(`/wishlist/items/${itemId}/photos/${photoId}`),
    onSuccess: (_data, { itemId, photoId }) => {
      queryClient.setQueryData<Wishlist>(key, (list) => {
        const item = list?.items.find((i) => i.id === itemId);
        return item
          ? replaceItem(list, { ...item, photos: item.photos.filter((p) => p.id !== photoId) })
          : list;
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function useCopySources(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: wishlistKeys.copySources(eventId),
    queryFn: ({ signal }) =>
      apiClient.get<CopySource[]>(`/events/${eventId}/wishlist/copy-sources`, { signal }),
    enabled,
    staleTime: 0,
  });
}

/** FR-WSH-5: resolves to the imported items. */
export function useCopyFrom(eventId: string, ownerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sourceEventId: string) =>
      apiClient.post<WishlistItem[]>(`/events/${eventId}/wishlist/copy-from/${sourceEventId}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: wishlistKeys.list(eventId, ownerId) }),
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
