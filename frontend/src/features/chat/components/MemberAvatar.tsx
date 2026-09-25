import { ChatIcon } from '@/components/icons';
import { Avatar, type AvatarSize } from '@/components/ui';

import type { ConversationSummary, MemberPublic } from '../api';

/** Anonymous members get the cream ✦ circle and never an image (the Avatar type enforces it). */
export function MemberAvatar({
  member,
  size = 'md',
  label,
}: {
  member: MemberPublic;
  size?: AvatarSize;
  label: string;
}) {
  if (member.is_anonymous) return <Avatar anonymous size={size} alt={label} />;
  return <Avatar size={size} src={member.avatar_url} name={label} alt={label} />;
}

export function ConversationAvatar({
  conversation,
  label,
  size = 'md',
}: {
  conversation: ConversationSummary;
  label: string;
  size?: AvatarSize;
}) {
  if (conversation.kind === 'group' || !conversation.title_member) {
    return (
      <span
        role="img"
        aria-label={label}
        className="inline-flex size-[44px] shrink-0 items-center justify-center rounded-full-2 border border-ink-black bg-pure-white"
      >
        <ChatIcon />
      </span>
    );
  }
  return <MemberAvatar member={conversation.title_member} size={size} label={label} />;
}
