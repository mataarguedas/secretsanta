import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { eventKeys } from '@/features/events/api';
import { eventTabPath } from '@/features/events/tabs';
import { apiClient } from '@/lib/apiClient';

/** `POST /events/{id}/draw` returns the new state and nothing else. */
export interface DrawResult {
  state: 'drawn';
}

/**
 * Host: the reveal. On success every event query refetches (state, `my_assignment`, the
 * dashboard cards) and the page goes to Overview, where the "You're giving to…" card is.
 */
export function useDrawEvent(eventId: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => apiClient.post<DrawResult>(`/events/${eventId}/draw`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: eventKeys.all });
      await navigate(eventTabPath(eventId, 'overview'));
    },
  });
}
