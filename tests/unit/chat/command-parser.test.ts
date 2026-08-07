import { describe, expect, it } from 'vitest';

import { parseCommand } from '../../../src/core/chat/command-parser.js';

/**
 * L'analyseur ne connaît ni la configuration ni le compteur : il réduit une
 * ligne de chat à un nom et un argument brut, ou à rien du tout.
 *
 * Ce découpage n'est pas cosmétique. Le service qui suit doit pouvoir refuser
 * une commande pour six raisons différentes ; s'il devait en plus démêler la
 * syntaxe, aucun de ces refus ne serait vérifiable isolément.
 */

describe('parseCommand', () => {
  it('reconnaît une commande et son argument', () => {
    expect(parseCommand('!addtime 300')).toEqual({ name: 'addtime', argument: '300' });
  });

  it('ramène le nom en minuscules', () => {
    // Twitch n'impose aucune casse au chat : « !AddTime » est la même intention.
    expect(parseCommand('!AddTime 300')).toEqual({ name: 'addtime', argument: '300' });
  });

  it('tolère les espaces multiples et les bords', () => {
    expect(parseCommand('   !addtime    300   ')).toEqual({ name: 'addtime', argument: '300' });
  });

  it('reconnaît une commande sans argument', () => {
    // Le manque d'argument n'est pas une erreur de syntaxe : c'est au service de
    // décider qu'une commande sans valeur ne crédite rien.
    expect(parseCommand('!addtime')).toEqual({ name: 'addtime', argument: null });
  });

  it('ne retient que le premier argument', () => {
    // « !addtime 300 merci beaucoup » reste une commande valide : le reste du
    // message appartient à celui qui l'écrit, pas à l'analyseur.
    expect(parseCommand('!addtime 300 merci beaucoup')).toEqual({
      name: 'addtime',
      argument: '300',
    });
  });

  it('ignore le caractère invisible que Twitch ajoute aux doublons', () => {
    // Twitch appose U+E0000 en fin de message pour contourner sa propre
    // détection de doublon. Sans normalisation, la seconde occurrence d'une
    // commande ne serait jamais reconnue — et personne ne comprendrait pourquoi.
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
    // La charge utile vient du réseau : elle n'est jamais présumée conforme.
    expect(parseCommand(undefined as unknown as string)).toBeNull();
    expect(parseCommand(42 as unknown as string)).toBeNull();
  });
});
