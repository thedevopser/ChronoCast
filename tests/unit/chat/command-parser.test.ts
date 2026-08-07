import { describe, expect, it } from 'vitest';

import { parseCommand } from '../../../src/core/chat/command-parser.js';

describe('parseCommand', () => {
  it('reconnaît une commande et son argument', () => {
    expect(parseCommand('!addtime 300')).toEqual({ name: 'addtime', argument: '300' });
  });

  it('ramène le nom en minuscules', () => {
    expect(parseCommand('!AddTime 300')).toEqual({ name: 'addtime', argument: '300' });
  });

  it('tolère les espaces multiples et les bords', () => {
    expect(parseCommand('   !addtime    300   ')).toEqual({ name: 'addtime', argument: '300' });
  });

  it('reconnaît une commande sans argument', () => {
    expect(parseCommand('!addtime')).toEqual({ name: 'addtime', argument: null });
  });

  it('ne retient que le premier argument', () => {
    expect(parseCommand('!addtime 300 merci beaucoup')).toEqual({
      name: 'addtime',
      argument: '300',
    });
  });

  it('ignore le caractère invisible que Twitch ajoute aux doublons', () => {
    expect(parseCommand('!addtime 300 \u{E0000}')).toEqual({ name: 'addtime', argument: '300' });
    expect(parseCommand('!addtime\u{E0000}')).toEqual({ name: 'addtime', argument: null });
  });

  it('rejette un message sans préfixe', () => {
    expect(parseCommand('addtime 300')).toBeNull();
  });

  it('rejette le préfixe seul', () => {
    expect(parseCommand('!')).toBeNull();
    expect(parseCommand('!  300')).toBeNull();
  });

  it('rejette un message vide ou blanc', () => {
    expect(parseCommand('')).toBeNull();
    expect(parseCommand('   ')).toBeNull();
  });

  it('rejette une valeur qui n’est pas une chaîne', () => {
    expect(parseCommand(undefined as unknown as string)).toBeNull();
    expect(parseCommand(42 as unknown as string)).toBeNull();
  });
});
