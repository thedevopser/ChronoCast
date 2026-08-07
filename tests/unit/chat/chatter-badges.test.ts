import { describe, expect, it } from 'vitest';

import { isPrivileged } from '../../../src/core/chat/chatter-badges.js';

/**
 * C'est la porte d'autorisation, et une porte se vérifie séparément de ce
 * qu'elle garde. Une douzaine de lignes de production, une vingtaine de lignes
 * de test : le rapport est délibéré.
 *
 * L'habilitation se lit sur le **badge**, jamais sur le pseudo. Le badge est
 * une donnée de plateforme, que Twitch pose lui-même ; le pseudo est une chaîne
 * qu'on peut imiter à un caractère près.
 */

describe('isPrivileged', () => {
  it('reconnaît le diffuseur', () => {
    expect(isPrivileged([{ set_id: 'broadcaster', id: '1', info: '' }])).toBe(true);
  });

  it('reconnaît un modérateur', () => {
    expect(isPrivileged([{ set_id: 'moderator', id: '1', info: '' }])).toBe(true);
  });

  it('reconnaît le badge parmi d’autres', () => {
    // L'ordre des badges appartient à Twitch : on cherche, on ne suppose pas.
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
    // Un VIP, un abonné ou un fondateur ne modèrent pas la chaîne : leur donner
    // la commande reviendrait à l'ouvrir à qui paie.
    expect(isPrivileged([{ set_id: 'vip', id: '1', info: '' }])).toBe(false);
    expect(isPrivileged([{ set_id: 'subscriber', id: '12', info: '12' }])).toBe(false);
    expect(isPrivileged([{ set_id: 'founder', id: '0', info: '' }])).toBe(false);
  });

  it('distingue la casse', () => {
    // Twitch écrit ses `set_id` en minuscules. Accepter « Moderator » élargirait
    // la porte sur la foi d'une valeur qui n'existe pas.
    expect(isPrivileged([{ set_id: 'Moderator', id: '1', info: '' }])).toBe(false);
  });

  it('refuse en l’absence de badges', () => {
    // La charge utile vient du réseau. Le refus est le comportement sûr : ne pas
    // savoir qui parle ne vaut pas l'autorisation de créditer du temps.
    expect(isPrivileged(undefined)).toBe(false);
    expect(isPrivileged(null)).toBe(false);
  });

  it('refuse une charge utile malformée sans jamais lever', () => {
    // Une exception ici abattrait le traitement de la notification, donc une
    // ligne de chat suffirait à faire du bruit dans les journaux du streamer.
    expect(isPrivileged('moderator')).toBe(false);
    expect(isPrivileged([null, 42, 'moderator'])).toBe(false);
    expect(isPrivileged([{ set_id: 7 }])).toBe(false);
  });
});
