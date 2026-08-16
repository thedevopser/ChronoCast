import { describe, expect, it } from 'vitest';

import { isBroadcaster, isPrivileged } from '../../../src/core/chat/chatter-badges.js';

describe('isPrivileged', () => {
  it('reconnaît le diffuseur', () => {
    expect(isPrivileged([{ set_id: 'broadcaster', id: '1', info: '' }])).toBe(true);
  });

  it('reconnaît un modérateur', () => {
    expect(isPrivileged([{ set_id: 'moderator', id: '1', info: '' }])).toBe(true);
  });

  it('reconnaît le badge parmi d’autres', () => {
    expect(
      isPrivileged([
        { set_id: 'subscriber', id: '12', info: '12' },
        { set_id: 'moderator', id: '1', info: '' },
      ]),
    ).toBe(true);
  });

  it('refuse un spectateur ordinaire', () => {
    expect(isPrivileged([])).toBe(false);
  });

  it('refuse les badges qui ressemblent à une habilitation sans en être une', () => {
    expect(isPrivileged([{ set_id: 'vip', id: '1', info: '' }])).toBe(false);
    expect(isPrivileged([{ set_id: 'subscriber', id: '12', info: '12' }])).toBe(false);
    expect(isPrivileged([{ set_id: 'founder', id: '0', info: '' }])).toBe(false);
  });

  it('distingue la casse', () => {
    expect(isPrivileged([{ set_id: 'Moderator', id: '1', info: '' }])).toBe(false);
  });

  it('refuse en l’absence de badges', () => {
    expect(isPrivileged(undefined)).toBe(false);
    expect(isPrivileged(null)).toBe(false);
  });

  it('refuse une charge utile malformée sans jamais lever', () => {
    expect(isPrivileged('moderator')).toBe(false);
    expect(isPrivileged([null, 42, 'moderator'])).toBe(false);
    expect(isPrivileged([{ set_id: 7 }])).toBe(false);
  });
});

describe('isBroadcaster', () => {
  it('reconnaît le diffuseur', () => {
    expect(isBroadcaster([{ set_id: 'broadcaster', id: '1', info: '' }])).toBe(true);
  });

  it('reconnaît le badge parmi d’autres', () => {
    expect(
      isBroadcaster([
        { set_id: 'subscriber', id: '12', info: '12' },
        { set_id: 'broadcaster', id: '1', info: '' },
      ]),
    ).toBe(true);
  });

  it('refuse un modérateur', () => {
    expect(isBroadcaster([{ set_id: 'moderator', id: '1', info: '' }])).toBe(false);
  });

  it('refuse les autres badges', () => {
    expect(isBroadcaster([])).toBe(false);
    expect(isBroadcaster([{ set_id: 'vip', id: '1', info: '' }])).toBe(false);
    expect(isBroadcaster([{ set_id: 'subscriber', id: '12', info: '12' }])).toBe(false);
    expect(isBroadcaster([{ set_id: 'founder', id: '0', info: '' }])).toBe(false);
  });

  it('distingue la casse', () => {
    expect(isBroadcaster([{ set_id: 'Broadcaster', id: '1', info: '' }])).toBe(false);
  });

  it('refuse une charge utile malformée sans jamais lever', () => {
    expect(isBroadcaster(undefined)).toBe(false);
    expect(isBroadcaster(null)).toBe(false);
    expect(isBroadcaster('broadcaster')).toBe(false);
    expect(isBroadcaster([null, 42, 'broadcaster'])).toBe(false);
    expect(isBroadcaster([{ set_id: 7 }])).toBe(false);
  });
});
