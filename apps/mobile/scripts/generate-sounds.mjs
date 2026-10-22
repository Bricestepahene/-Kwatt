#!/usr/bin/env node
/**
 * Synthétise les sons du plateau (D-13 : aucun fichier sous licence) :
 *   balafon.wav       déplacer un pion (lame de bois frappée, résonateur qui grésille)
 *   tamtam.wav        prise (tambour d'aisselle, note qui descend)
 *   tamtam-leger.wav  déplacer, réglage « Tam-tam »
 *   nkul.wav          c'est ton tour (tambour à fente, deux tons)
 *   mvet.wav          victoire, dame (cordes pincées en arpège)
 *
 * WAV mono 16 bits à 22 050 Hz, déterministes (bruit pseudo-aléatoire à graine fixe).
 *   pnpm --filter @kwatt/mobile assets:sounds
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22_050;
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..', 'assets', 'sounds');

/** Bruit pseudo-aléatoire reproductible (LCG), entre -1 et 1. */
function noise(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x80000000 - 1;
  };
}

const buffer = (seconds) => new Float64Array(Math.round(seconds * RATE));

/** Ajoute un partiel amorti : fréquence (Hz ou fonction du temps), amplitude, constante de temps. */
function partial(buf, { at = 0, freq, amp, tau, phase = 0 }) {
  const start = Math.round(at * RATE);
  let ph = phase;
  for (let i = start; i < buf.length; i++) {
    const t = (i - start) / RATE;
    const f = typeof freq === 'function' ? freq(t) : freq;
    ph += (2 * Math.PI * f) / RATE;
    const attack = Math.min(1, t / 0.002); // 2 ms d'attaque : pas de clic
    buf[i] += amp * attack * Math.exp(-t / tau) * Math.sin(ph);
  }
}

/** Bruit bref filtré (frappe de la baguette ou de la main). */
function click(buf, { at = 0, amp, tau, smooth = 0.6, seed = 1 }) {
  const rnd = noise(seed);
  const start = Math.round(at * RATE);
  let y = 0;
  for (let i = start; i < buf.length; i++) {
    const t = (i - start) / RATE;
    if (t > tau * 8) break;
    y = smooth * y + (1 - smooth) * rnd();
    buf[i] += amp * Math.exp(-t / tau) * y;
  }
}

/** Corde pincée (Karplus-Strong), pour le mvet. */
function pluck(buf, { at, freq, amp, decay = 0.996, seed }) {
  const rnd = noise(seed);
  const period = Math.max(2, Math.round(RATE / freq));
  const line = Float64Array.from({ length: period }, () => rnd());
  const start = Math.round(at * RATE);
  for (let i = start, k = 0; i < buf.length; i++, k++) {
    const idx = k % period;
    const next = (k + 1) % period;
    const value = line[idx];
    buf[i] += amp * value;
    line[idx] = decay * 0.5 * (value + line[next]);
  }
}

function normalize(buf, peak = 0.89) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  const k = max > 0 ? peak / max : 1;
  // Fondu de sortie de 10 ms.
  const fade = Math.round(0.01 * RATE);
  for (let i = 0; i < buf.length; i++) {
    const tail = buf.length - i;
    buf[i] *= k * (tail < fade ? tail / fade : 1);
  }
  return buf;
}

function wav(buf) {
  const data = Buffer.alloc(buf.length * 2);
  buf.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // taille du bloc fmt
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function balafon() {
  const buf = buffer(0.38);
  const f0 = 523.25; // do
  partial(buf, { freq: f0, amp: 1, tau: 0.16 });
  partial(buf, { freq: f0 * 3.93, amp: 0.32, tau: 0.05 });
  partial(buf, { freq: f0 * 9.08, amp: 0.1, tau: 0.02 });
  // Grésillement du mirliton de la calebasse : légère modulation de la fondamentale.
  partial(buf, { freq: f0 + 118, amp: 0.08, tau: 0.12 });
  partial(buf, { freq: f0 - 118, amp: 0.08, tau: 0.12 });
  click(buf, { amp: 0.35, tau: 0.003, smooth: 0.3, seed: 11 });
  return normalize(buf, 0.8);
}

function tamtam({ from, to, amp, length, seed }) {
  const buf = buffer(length);
  const glide = (t) => to + (from - to) * Math.exp(-t / 0.06); // la note descend, comme un tambour d'aisselle
  partial(buf, { freq: glide, amp: 1, tau: length / 2.2 });
  partial(buf, { freq: (t) => glide(t) * 1.59, amp: 0.35, tau: length / 5 });
  partial(buf, { freq: (t) => glide(t) * 2.14, amp: 0.15, tau: length / 8 });
  click(buf, { amp: 0.6, tau: 0.006, smooth: 0.75, seed });
  return normalize(buf, amp);
}

function nkul() {
  const buf = buffer(0.5);
  for (const [at, f] of [
    [0, 330],
    [0.13, 247],
  ]) {
    partial(buf, { at, freq: f, amp: 1, tau: 0.11 });
    partial(buf, { at, freq: f * 2.76, amp: 0.25, tau: 0.04 });
    click(buf, { at, amp: 0.25, tau: 0.002, smooth: 0.4, seed: 23 + at * 1000 });
  }
  return normalize(buf, 0.85);
}

function mvet() {
  const buf = buffer(1.5);
  const notes = [392, 493.88, 587.33, 783.99]; // sol, si, ré, sol : arpège qui monte
  notes.forEach((freq, i) => pluck(buf, { at: i * 0.09, freq, amp: 0.6, decay: 0.997, seed: 101 + i }));
  // Résonance douce de la calebasse : passe-bas léger.
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y = 0.55 * y + 0.45 * buf[i];
    buf[i] = y;
  }
  return normalize(buf, 0.85);
}

const sounds = {
  'balafon.wav': balafon(),
  'tamtam.wav': tamtam({ from: 190, to: 112, amp: 0.92, length: 0.55, seed: 7 }),
  'tamtam-leger.wav': tamtam({ from: 250, to: 175, amp: 0.55, length: 0.28, seed: 9 }),
  'nkul.wav': nkul(),
  'mvet.wav': mvet(),
};

await mkdir(out, { recursive: true });
for (const [name, buf] of Object.entries(sounds)) {
  const bytes = wav(buf);
  await writeFile(path.join(out, name), bytes);
  console.log(`✓ ${name} (${(buf.length / RATE).toFixed(2)} s, ${(bytes.length / 1024).toFixed(1)} Ko)`);
}
