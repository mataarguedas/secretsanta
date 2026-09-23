import { useId, type ReactNode } from 'react';

import { Card } from '@/components/ui';

/**
 * One settings block on the Profile page: a white content card with a serif heading that
 * names the region. Language uses it now; Notifications, Devices, the install guide, legal
 * links and account deletion reuse it as their prompts land.
 */
export function ProfileSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <Card as="section" aria-labelledby={headingId} className="flex flex-col gap-15">
      <h2 id={headingId} className="font-serif text-heading-sm font-medium">
        {title}
      </h2>
      {children}
    </Card>
  );
}
