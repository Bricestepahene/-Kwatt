import { describe, expect, it } from 'vitest';
import { betPreview, initialBet, localOffers, oddsLabel, stepBet } from './offers';

describe('offres de l’écran 15', () => {
  it('sans réseau : offres calculées sur l’appareil, sans pari', () => {
    const o = localOffers(1482);
    expect(o.rank).toBe('notable');
    expect(o.betCap).toBe(0);
    expect(o.difficulties.map((d) => d.oddsHundredths)).toEqual([100, 120, 150, 180, 450]);
    expect(o.difficulties.find((d) => d.id === 'ton_niveau')!.machineRating).toBe(1482);
    expect(localOffers(null).rating).toBe(900);
  });

  it('pari par pas de 50 sous le plafond (planche : 200, plafond 600)', () => {
    expect(initialBet(600)).toBe(200);
    expect(initialBet(100)).toBe(100);
    expect(initialBet(0)).toBe(0);
    expect(stepBet(600, 1, 600)).toBe(600);
    expect(stepBet(0, -1, 600)).toBe(0);
    expect(stepBet(200, 1, 620)).toBe(250);
  });

  it('aperçu « Si tu gagnes +220 / Si tu perds −190 » et série ×1,5', () => {
    const level = localOffers(1482).difficulties.find((d) => d.id === 'ton_niveau')!;
    expect(betPreview(level, 200, 0)).toEqual({ ifWin: 220, ifLoss: -190, base: 60, streakNext: false });
    expect(betPreview(level, 0, 3)).toEqual({ ifWin: 90, ifLoss: 10, base: 90, streakNext: true });
  });

  it('cote affichée', () => {
    expect(oddsLabel(180, ',')).toBe('1,8');
    expect(oddsLabel(100, '.')).toBe('1');
    expect(oddsLabel(450, ',')).toBe('4,5');
  });
});
