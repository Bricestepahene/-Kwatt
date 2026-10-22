import { applyRoll, BASE, legalMoves, newGame, type LudoState } from '@kwatt/rules-ludo';
import { afterAll, describe, expect, it } from 'vitest';
import { buildService } from './app.js';

const app = buildService({ maxBudgetMs: 50 });
afterAll(() => app.close());

const B = BASE;
/** Classique à 2, lancer de 3, deux pions en jeu : plusieurs coups possibles. */
function position(): LudoState {
  const g = newGame({ preset: 'classique', players: 2 });
  return applyRoll({ ...g, tokens: [[4, 20, B, B], [33, B, B, B]] }, 3);
}

const choose = (body: unknown) => app.inject({ method: 'POST', url: '/v1/choose', payload: body as object });

describe('service ludo-ai', () => {
  it('GET /health', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, service: 'ludo-ai', maxBudgetMs: 50, levels: { facile: 'facile@1', fon: 'fon@1' } });
  });

  it('POST /v1/choose : un coup légal, expliqué', async () => {
    const state = position();
    const r = await choose({ state, level: 'coriace', seed: 1 });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(legalMoves(state)).toContainEqual(body.move);
    // La capture (4 + 3 = 7, où est le pion adverse) est choisie, et la raison est donnée en code.
    expect(body.move.captures).toEqual([{ seat: 1, token: 0 }]);
    expect(body.candidates.length).toBeGreaterThanOrEqual(2);
    expect(body.candidates[0]).toHaveProperty('pCapture');
    expect(body.agent).toBe('coriace@1');
    expect(body.stats.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('tous les niveaux, toutes les variantes (le JSON fait l’aller-retour)', async () => {
    const states: LudoState[] = [
      applyRoll(newGame({ preset: 'parchis', players: 4 }), 5),
      applyRoll(newGame({ preset: 'pachisi', players: 4, teams: [[0, 2], [1, 3]] }), 10),
      applyRoll(newGame({ preset: 'six', players: 6, house: { protection: 'departs' } }), 6),
      position(),
    ];
    for (const state of states) {
      for (const level of ['facile', 'moyen', 'coriace', 'ton_niveau', 'fon']) {
        const r = await choose({ state: JSON.parse(JSON.stringify(state)), level, budgetMs: 20 });
        expect(r.statusCode, `${state.config.preset} ${level} ${r.body}`).toBe(200);
        expect(legalMoves(state)).toContainEqual(r.json().move);
      }
    }
  });

  it('le budget est plafonné par le service', async () => {
    const r = await choose({ state: position(), level: 'fon', budgetMs: 60_000 });
    expect(r.statusCode).toBe(200);
    expect(r.json().stats.elapsedMs).toBeLessThan(1000);
  });

  it('requête invalide : 400 avec un code', async () => {
    const r = await choose({ state: position(), level: 'impossible' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('ludo_ai.invalid_request');
    const broken = await app.inject({ method: 'POST', url: '/v1/choose', headers: { 'content-type': 'application/json' }, payload: '{pas du json' });
    expect(broken.statusCode).toBe(400);
    expect(broken.json().error.code).toBe('ludo_ai.invalid_request');
    const text = await app.inject({ method: 'POST', url: '/v1/choose', headers: { 'content-type': 'text/plain' }, payload: 'bonjour' });
    expect(text.statusCode).toBe(400);
    expect(text.json().error.code).toBe('ludo_ai.invalid_request');
  });

  it('configuration trafiquée : refusée', async () => {
    const state = position();
    const tampered = { ...state, config: { ...state.config, mechanics: { ...state.config.mechanics, exitRolls: [1, 2, 3, 4, 5, 6] } } };
    const r = await choose({ state: tampered, level: 'moyen' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toEqual({ code: 'ludo_ai.invalid_state', params: { field: 'config' } });
    const badTokens = { ...state, tokens: [[4, 20, B], [33, B, B, B]] };
    expect((await choose({ state: badTokens, level: 'moyen' })).json().error.params).toEqual({ field: 'tokens' });
  });

  it('combinaison bloquée : le code des règles est renvoyé', async () => {
    const state = position();
    const r = await choose({ state: { ...state, config: { ...state.config, house: { barriers: 'any' } } }, level: 'moyen' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('ludo.setup.barrier_lock');
  });

  it('pas au moment de jouer : 409', async () => {
    const r = await choose({ state: newGame({ preset: 'classique', players: 2 }), level: 'facile' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('ludo_ai.not_move_phase');
  });

  it('route inconnue : 404 avec un code', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/nope' });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('ludo_ai.not_found');
  });
});
