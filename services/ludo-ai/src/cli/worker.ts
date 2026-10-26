/** Fil de calcul d'un tournoi : joue sa part des donnes et renvoie les parties. */
import { parentPort, workerData } from 'node:worker_threads';
import { runMatch } from '@kwatt/ludo-ai';
import { toPlayer, type PoolJob } from './pool.js';

const { job, shard } = workerData as { job: PoolJob; shard: { index: number; count: number } };
const result = runMatch({ game: job.game, lineup: job.lineup.map(toPlayer), deals: job.deals, seed: job.seed, shard });
parentPort!.postMessage(result.results);
