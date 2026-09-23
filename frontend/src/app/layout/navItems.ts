import type { ComponentType, SVGProps } from 'react';

import { ChatIcon, GiftIcon, PersonIcon } from '@/components/icons';

export interface NavItem {
  key: 'events' | 'chats' | 'profile';
  to: string;
  labelKey: 'nav.events' | 'nav.chats' | 'nav.profile';
  Icon: ComponentType<Omit<SVGProps<SVGSVGElement>, 'children'>>;
  isActive: (pathname: string) => boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    key: 'events',
    to: '/',
    labelKey: 'nav.events',
    Icon: GiftIcon,
    // The dashboard lives at "/" and every event page under /events.
    isActive: (p) => p === '/' || p === '/events' || p.startsWith('/events/'),
  },
  {
    key: 'chats',
    to: '/chats',
    labelKey: 'nav.chats',
    Icon: ChatIcon,
    isActive: (p) => p === '/chats' || p.startsWith('/chats/'),
  },
  {
    key: 'profile',
    to: '/profile',
    labelKey: 'nav.profile',
    Icon: PersonIcon,
    isActive: (p) => p === '/profile' || p.startsWith('/profile/'),
  },
];
