import { describe, expect, it } from 'vitest';

import i18n from '@/i18n';
import { member } from '@/test/render';

import { memberName } from './members';

const t = i18n.getFixedT('es');

describe('memberName', () => {
  it('names a person by their display name', () => {
    expect(memberName(t, member({ display_name: 'Carla Mora' }))).toBe('Carla Mora');
  });

  it('a deleted account is "Deleted user", a leaver a former participant', () => {
    const gone = { display_name: 'Deleted user', avatar_url: null, is_self: false };
    expect(memberName(t, member({ ...gone, is_deleted: true }))).toBe('Usuario eliminado');
    expect(memberName(t, member({ ...gone, is_former: true }))).toBe(
      i18n.getFixedT('es')('chat.member.former'),
    );
    expect(memberName(i18n.getFixedT('en'), member({ ...gone, is_deleted: true }))).toBe(
      'Deleted user',
    );
  });

  it('an anonymous member is only ever its alias', () => {
    const elf = member({
      display_name: 'Secret Elf #7',
      is_anonymous: true,
      anon_number: 7,
      avatar_url: null,
    });
    expect(memberName(t, elf)).toBe(t('chat.member.anonymous', { n: 7 }));
  });
});
