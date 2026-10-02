// node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../pitch.js');

const SR = 48000;

// Signal aus einer Funktion der Phase; freq(t) darf sich ändern (Vibrato)
function render(dur, freq, partials, amp = 0.3) {
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += 2 * Math.PI * freq(t) / SR;
    let s = 0;
    for (let k = 0; k < partials.length; k++) s += partials[k] * Math.sin((k + 1) * ph);
    out[i] = amp * s;
  }
  return out;
}

// Wie im Browser: alle `hop` Samples ein Puffer der Länge bufferSizeFor
function track(sig, hop = 1024) {
  const size = P.bufferSizeFor(SR, 60);
  const det = P.createDetector(SR, { fmin: 60, fmax: 1500 });
  const frames = [];
  for (let i = 0; i + size <= sig.length; i += hop) {
    const r = det(sig.subarray(i, i + size), -60);
    frames.push({ t: (i + size) / SR, f: r.f && r.conf >= 0.7 ? r.f : null, conf: r.conf, db: r.db });
  }
  return frames;
}

const cents = (f, ref) => 1200 * Math.log2(f / ref);
const voiced = (fr) => fr.filter((x) => x.f);

test('reiner Sinus 220 Hz: auf 1 ¢ genau', () => {
  const fr = voiced(track(render(1, () => 220, [1])));
  assert.ok(fr.length > 30);
  for (const x of fr) assert.ok(Math.abs(cents(x.f, 220)) < 1, `${x.f} Hz`);
});

test('tiefe und hohe Lage: 70 Hz Sägezahn, 1000 Hz Sinus', () => {
  const saw = Array.from({ length: 20 }, (_, k) => 1 / (k + 1));
  for (const x of voiced(track(render(1, () => 70, saw)))) assert.ok(Math.abs(cents(x.f, 70)) < 3, `${x.f} Hz`);
  for (const x of voiced(track(render(1, () => 1000, [1])))) assert.ok(Math.abs(cents(x.f, 1000)) < 3, `${x.f} Hz`);
});

test('schwacher Grundton wie bei einer Stimme: kein Oktavfehler', () => {
  // Grundton leiser als 2. und 3. Teilton, typisch für Formanten
  const fr = voiced(track(render(1, () => 140, [0.25, 1, 0.8, 0.5, 0.35, 0.2, 0.12])));
  assert.ok(fr.length > 30);
  for (const x of fr) assert.ok(Math.abs(cents(x.f, 140)) < 3, `${x.f} Hz statt 140`);
});

test('Rauschen und Stille gelten als stimmlos', () => {
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
  const noise = new Float32Array(SR).map(() => 0.1 * rnd());
  const fn = track(noise);
  assert.ok(voiced(fn).length / fn.length < 0.1, 'Rauschen erkannt als Ton');
  const silence = track(new Float32Array(SR));
  assert.equal(voiced(silence).length, 0);
});

test('Vibrato 5.5 Hz, ±40 ¢ um 330 Hz: ein Ton, Mitte und Vibrato richtig', () => {
  const f = (t) => 330 * Math.pow(2, (40 * Math.sin(2 * Math.PI * 5.5 * t)) / 1200);
  const sig = render(2.5, f, [0.4, 1, 0.6, 0.3]);
  const notes = P.segmentNotes(track(sig, 1200), { frameDur: P.bufferSizeFor(SR, 60) / SR });
  assert.equal(notes.length, 1);
  const n = notes[0];
  assert.ok(Math.abs(cents(n.f, 330)) < 6, `Mitte ${n.f.toFixed(2)} Hz`);
  assert.ok(n.vib, 'Vibrato nicht erkannt');
  assert.ok(Math.abs(n.vib.rate - 5.5) < 0.8, `Rate ${n.vib.rate}`);
  assert.ok(Math.abs(n.vib.depth - 40) < 12, `Tiefe ${n.vib.depth}`);
});

test('breites Vibrato ±100 ¢: Mitte bleibt, auch wenn die Messrate ein Vielfaches der Vibratorate ist', () => {
  for (const [rate, hop] of [[5, 1200], [5, 1031], [4.5, 1200]]) {
    const f = (t) => 330 * Math.pow(2, (100 * Math.sin(2 * Math.PI * rate * t)) / 1200);
    const notes = P.segmentNotes(track(render(2.5, f, [0.4, 1, 0.6, 0.3]), hop), { frameDur: P.bufferSizeFor(SR, 60) / SR });
    assert.equal(notes.length, 1, `${rate} Hz, hop ${hop}`);
    assert.ok(Math.abs(cents(notes[0].f, 330)) < 8, `${rate} Hz, hop ${hop}: Mitte ${cents(notes[0].f, 330).toFixed(1)} ¢`);
  }
});

test('Legato in 75-¢-Schritten ohne Pause: vier Töne', () => {
  const steps = [0, 75, 150, 225];
  const f = (t) => 220 * Math.pow(2, steps[Math.min(3, Math.floor(t / 0.6))] / 1200);
  const notes = P.segmentNotes(track(render(2.4, f, [0.4, 1, 0.6, 0.3]), 1200));
  assert.deepEqual(notes.map((n) => Math.round(cents(n.f, 220)) + 0), steps);
});

// Eine gesungene Mavila-Folge (16-EDO) mit kleinen Fehlern, Pausen und Oktave
const MAVILA = [0, 150, 300, 525, 675, 825, 975];
function singSequence(centsList, fref, opts = {}) {
  const parts = [];
  const pause = new Float32Array(Math.round(0.25 * SR));
  centsList.forEach((c, i) => {
    const err = opts.err ? opts.err[i % opts.err.length] : 0;
    const base = fref * Math.pow(2, (c + err) / 1200);
    const f = (t) => base * Math.pow(2, (20 * Math.sin(2 * Math.PI * 5 * t + i)) / 1200);
    parts.push(render(1.0, f, [0.35, 1, 0.7, 0.4, 0.2]), pause);
  });
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

test('Folge von Tönen wird in einzelne Töne zerlegt', () => {
  const sig = singSequence(MAVILA, 220);
  const notes = P.segmentNotes(track(sig, 1200));
  assert.equal(notes.length, MAVILA.length);
  notes.forEach((n, i) => assert.ok(Math.abs(cents(n.f, 220) - MAVILA[i]) < 6, `Ton ${i + 1}: ${cents(n.f, 220).toFixed(1)} ¢`));
});

test('gesungene Mavila-Folge ergibt die Mavila-Skala und 16-EDO', () => {
  const err = [3, -6, 5, -4, 7, -5, 4, -3];
  const seq = [...MAVILA, 1200, 675, 300];      // Oktave und Wiederholungen
  const notes = P.segmentNotes(track(singSequence(seq, 196, { err }), 1200));
  assert.equal(notes.length, seq.length);
  const sc = P.deriveScale(notes, { ref: 'first', tol: 35 });
  assert.equal(sc.degrees.length, 7);
  assert.ok(sc.refSung);
  sc.degrees.forEach((dg, i) => assert.ok(Math.abs(dg.c - MAVILA[i]) < 12, `Stufe ${i + 1}: ${dg.c.toFixed(1)} ¢`));
  // Oktave und Wiederholungen landen in denselben Stufen
  assert.equal(sc.degrees[0].count, 2);
  assert.equal(sc.degrees[2].count, 2);
  assert.equal(sc.degrees[4].count, 2);
  const fits = P.fitEdo(sc.degrees.map((dg) => dg.c));
  assert.equal(P.smallestEdo(fits, 15).N, 16);
});

test('Bezug „tiefster Ton“ und fester Bezug', () => {
  const notes = [300, 0, 675].map((c, i) => ({ f: 220 * Math.pow(2, c / 1200), dur: 1, i }));
  const low = P.deriveScale(notes, { ref: 'lowest' });
  assert.deepEqual(low.degrees.map((dg) => Math.round(dg.c)), [0, 300, 675]);
  const fixed = P.deriveScale(notes, { ref: 200 });
  assert.equal(fixed.refSung, false);
  assert.ok(fixed.degrees.some((dg) => dg.c === 0 && dg.count === 0));
});

test('nächster Bruch und 12-TET-Name', () => {
  assert.deepEqual(P.nearestRatio(701.96).p, 3);
  const r = P.nearestRatio(675);
  assert.ok(!r || Math.abs(r.err) <= 20);
  const n = P.note12(261.63);
  assert.equal(n.name, 'C');
  assert.equal(n.octave, 4);
  assert.ok(Math.abs(n.dev) < 1);
});

test('Scala- und ASCL-Text', () => {
  const sc = { fref: 220, degrees: [{ c: 0 }, { c: 140 }, { c: 675 }] };
  const scl = P.toScl(sc, { name: 'probe' });
  const lines = scl.trim().split('\n');
  assert.equal(lines[0], '! probe.scl');
  assert.equal(lines[3], ' 3');
  assert.deepEqual(lines.slice(5), [' 140.000000', ' 675.000000', ' 2/1']);
  const ascl = P.toScl(sc, { name: 'probe', kind: 'ascl' });
  assert.match(ascl, /@ABL NOTE_NAMES "A" "A#\+40" "E-25"/);
  assert.match(ascl, /@ABL REFERENCE_PITCH 3 0 440\.0000/);
});
