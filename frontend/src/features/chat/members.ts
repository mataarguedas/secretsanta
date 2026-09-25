import type { TFunction } from 'i18next';

import type { ConversationSummary, MemberPublic } from './api';

/**
 * How a member is named on screen. An anonymous member is only ever its translated alias
 * ("Elfo secreto #7"), built from `anon_number`; nothing else about them exists here.
 */
export function memberName(t: TFunction, member: MemberPublic): string {
  if (member.is_anonymous && member.anon_number !== null) {
    return t('chat.member.anonymous', { n: member.anon_number });
  }
  if (member.is_former) return t('chat.member.former');
  return member.display_name;
}

export function conversationTitle(t: TFunction, conversation: ConversationSummary): string {
  if (conversation.kind === 'group' || !conversation.title_member) return t('chat.group.title');
  return memberName(t, conversation.title_member);
}
