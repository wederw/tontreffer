// Tonhöhe, Tonfolgen und Skalen aus gesungenen Tönen.
// Läuft im Browser (window.Tonhoehe) und in Node (require).
(function (root) {
  'use strict';

  const mod = (a, n) => ((a % n) + n) % n;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  function median(arr) {
    if (!arr.length) return NaN;
    const s = arr.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  const centsOf = (f, ref) => 1200 * Math.log2(f / ref);

  // ---------- Tonhöhe: YIN (de Cheveigné & Kawahara 2002) ----------

  // Die längste Periode 1/fmin muss gut 2,5-mal in den Puffer passen:
  // einmal als Verschiebung τ, einmal als Fenster, plus Reserve.
  function bufferSizeFor(sampleRate, fmin = 60) {
    let n = 1024;
    while (n < 2.5 * sampleRate / fmin) n *= 2;
    return n;
  }

  function createDetector(sampleRate, opts = {}) {
    const fmin = opts.fmin ?? 60;
    const fmax = opts.fmax ?? 1500;
    const threshold = opts.threshold ?? 0.15;          // Schwelle für d′(τ)
    const maxAperiodicity = opts.maxAperiodicity ?? 0.35;
    const tauMin = Math.max(2, Math.floor(sampleRate / fmax));
    const tauMax = Math.ceil(sampleRate / fmin);
    const d = new Float64Array(tauMax + 2);
    const cm = new Float64Array(tauMax + 2);

    return function detect(buf, gateDb = -60) {
      let ss = 0;
      for (let i = 0; i < buf.length; i++) ss += buf[i] * buf[i];
      const rms = Math.sqrt(ss / buf.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
      if (db < gateDb) return { f: null, conf: 0, db };

      const W = buf.length - tauMax - 1;
      if (W < tauMax) throw new Error(`Puffer zu kurz: ${buf.length} Samples für fmin = ${fmin} Hz`);

      // 1. Differenzfunktion d(τ) = Σ (x_j − x_{j+τ})²
      for (let tau = 1; tau <= tauMax + 1; tau++) {
        let s = 0;
        for (let j = 0; j < W; j++) { const x = buf[j] - buf[j + tau]; s += x * x; }
        d[tau] = s;
      }
      // 2. kumulativ normiert: d′(τ) = d(τ) · τ / Σ_{k≤τ} d(k)
      cm[0] = 1;
      let run = 0;
      for (let tau = 1; tau <= tauMax + 1; tau++) {
        run += d[tau];
        cm[tau] = run > 0 ? d[tau] * tau / run : 1;
      }
      // 3. erstes Tal unter der Schwelle, bis zu seinem Boden
      let tau = -1;
      for (let t = tauMin; t <= tauMax; t++) {
        if (cm[t] < threshold) {
          while (t + 1 <= tauMax && cm[t + 1] < cm[t]) t++;
          tau = t;
          break;
        }
      }
      if (tau < 0) {
        let best = tauMin;
        for (let t = tauMin + 1; t <= tauMax; t++) if (cm[t] < cm[best]) best = t;
        if (cm[best] > maxAperiodicity) return { f: null, conf: 1 - cm[best], db };
        tau = best;
      }
      // 4. Parabel durch d(τ−1), d(τ), d(τ+1) für Bruchteile eines Samples
      let t0 = tau;
      if (tau > 1 && tau <= tauMax) {
        const a = d[tau - 1], b = d[tau], c = d[tau + 1];
        const den = a - 2 * b + c;
        if (den > 0) t0 = tau + 0.5 * (a - c) / den;
      }
      const f = sampleRate / t0;
      const conf = 1 - cm[tau];
      if (f < fmin * 0.97 || f > fmax * 1.03) return { f: null, conf, db };
      return { f, conf, db };
    };
  }

  // ---------- Töne aus einer Tonhöhenspur ----------

  // frames: [{ t: Sekunden, f: Hz oder null }], zeitlich sortiert.
  // Ein neuer Ton beginnt, wenn die Tonhöhe länger als `confirm` Sekunden
  // mehr als `tol` Cent vom Median der letzten `window` Sekunden abweicht,
  // oder nach einer Pause länger als `maxGap`.
  function segmentNotes(frames, o = {}) {
    const tol = o.tol ?? 45;
    const minDur = o.minDur ?? 0.25;
    const maxGap = o.maxGap ?? 0.15;
    const confirm = o.confirm ?? 0.12;
    const win = o.window ?? 0.6;
    const notes = [];
    let cur = null;
    let pending = [];

    const finish = () => {
      if (cur) {
        const n = summarize(cur.pts, o);
        if (n && n.dur >= minDur) notes.push(n);
      }
      cur = null;
      pending = [];
    };

    // cur.last: letzter stimmhafter Rahmen, auch wenn er gerade als Ausschlag wartet.
    // Eine Lücke ist nur Stille, kein Ausschlag.
    for (const fr of frames) {
      if (!fr.f) {
        if (cur && fr.t - cur.last > maxGap) finish();
        continue;
      }
      const c = centsOf(fr.f, 440);
      if (cur && fr.t - cur.last > maxGap) finish();
      if (!cur) { cur = { pts: [{ t: fr.t, c }], last: fr.t }; continue; }
      cur.last = fr.t;

      const recent = [];
      for (let i = cur.pts.length - 1; i >= 0 && fr.t - cur.pts[i].t <= win; i--) recent.push(cur.pts[i].c);
      const ref = median(recent);
      if (Math.abs(c - ref) <= tol) {
        // Ein Ausschlag, der zurückkommt (Vibrato), gehört zum Ton.
        // Ohne das fehlten die Spitzen einer Seite und der Median kippte.
        for (const p of pending) cur.pts.push(p);
        cur.pts.push({ t: fr.t, c });
        pending = [];
        continue;
      }
      pending.push({ t: fr.t, c });
      const pm = median(pending.map((p) => p.c));
      if (!pending.every((p) => Math.abs(p.c - pm) <= tol)) {
        // Kein stehender neuer Ton, sondern Bewegung: bleibt beim laufenden Ton
        for (const p of pending.slice(0, -1)) cur.pts.push(p);
        pending = [pending[pending.length - 1]];
      } else if (pending[pending.length - 1].t - pending[0].t >= confirm) {
        const start = pending.slice();
        finish();
        cur = { pts: start, last: start[start.length - 1].t };
      }
    }
    finish();
    return notes;
  }

  // Ein Ton: Median ohne Einschwingen und Ausklang, Streuung, Vibrato
  function summarize(pts, o = {}) {
    if (pts.length < 3) return null;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t, dur = t1 - t0;
    const trim = o.trim ?? 0.15;
    const core = dur > 0.3 ? pts.filter((p) => p.t >= t0 + trim * dur && p.t <= t1 - trim * dur) : pts;
    const cs = core.map((p) => p.c);
    const mean = cs.reduce((a, b) => a + b, 0) / cs.length;
    const spread = Math.sqrt(cs.reduce((a, b) => a + (b - mean) ** 2, 0) / cs.length);
    const vib = vibrato(core, o.frameDur || 0);
    // Ohne Vibrato ist der Median robust gegen Ausreißer. Mit Vibrato liegen die
    // meisten Werte an den Umkehrpunkten, dann trifft der Mittelwert die Mitte.
    const mid = vib ? mean : median(cs);
    return { t0, t1, dur, c: mid, f: 440 * Math.pow(2, mid / 1200), spread, vib, n: pts.length };
  }

  // Vibrato: Gerade abziehen (langsames Wegdriften), Rest glätten,
  // Nulldurchgänge zählen. Tiefe = √2 · Effektivwert des Rests.
  // Jede Tonhöhe ist ein Mittel über das Analysefenster der Länge L; eine
  // Schwingung mit Rate r wird dadurch um sinc(π·r·L) gedämpft, das wird
  // herausgerechnet.
  function vibrato(core, frameDur) {
    if (core.length < 12) return null;
    const span = core[core.length - 1].t - core[0].t;
    if (span < 0.5) return null;
    const n = core.length;
    let st = 0, sc = 0;
    for (const p of core) { st += p.t; sc += p.c; }
    const mt = st / n, mc = sc / n;
    let num = 0, den = 0;
    for (const p of core) { num += (p.t - mt) * (p.c - mc); den += (p.t - mt) ** 2; }
    const slope = den > 0 ? num / den : 0;
    const res = core.map((p) => p.c - (mc + slope * (p.t - mt)));
    const sm = res.map((v, i) => (res[Math.max(0, i - 1)] + v + res[Math.min(n - 1, i + 1)]) / 3);
    let crossings = 0;
    for (let i = 1; i < n; i++) if ((sm[i - 1] < 0) !== (sm[i] < 0)) crossings++;
    const rate = crossings / (2 * span);
    let depth = Math.SQRT2 * Math.sqrt(res.reduce((a, v) => a + v * v, 0) / n);
    const u = Math.PI * rate * frameDur;
    if (u > 0 && u < 2) depth /= Math.sin(u) / u;
    if (depth < 15 || rate < 3 || rate > 9) return null;
    return { rate, depth };
  }

  // ---------- Skala aus gesungenen Tönen ----------

  // Alle Töne werden auf eine Oktave über dem Bezugston gefaltet und
  // zusammengefasst, wenn sie weniger als `tol` Cent auseinanderliegen.
  // ref: 'first' (erster Ton), 'lowest' (tiefster Ton) oder eine Frequenz in Hz.
  function deriveScale(notes, o = {}) {
    if (!notes.length) return null;
    const tol = o.tol ?? 35;
    let fref;
    if (typeof o.ref === 'number') fref = o.ref;
    else if (o.ref === 'lowest') fref = Math.min(...notes.map((n) => n.f));
    else fref = notes[0].f;

    const pts = notes
      .map((n, i) => ({ c: mod(centsOf(n.f, fref), 1200), w: Math.max(n.dur || 0, 0.05), i }))
      .sort((a, b) => a.c - b.c);
    const groups = [];
    for (const p of pts) {
      const last = groups[groups.length - 1];
      if (last && p.c - last.max <= tol) { last.m.push(p); last.max = p.c; }
      else groups.push({ m: [p], min: p.c, max: p.c });
    }
    if (groups.length > 1) {
      const first = groups[0], last = groups[groups.length - 1];
      if (first.min + 1200 - last.max <= tol) {
        groups.pop();
        first.m = last.m.map((p) => ({ ...p, c: p.c - 1200 })).concat(first.m);
      }
    }
    let degs = groups.map((g) => {
      const W = g.m.reduce((a, p) => a + p.w, 0);
      const c = g.m.reduce((a, p) => a + p.c * p.w, 0) / W;
      const sd = Math.sqrt(g.m.reduce((a, p) => a + p.w * (p.c - c) ** 2, 0) / W);
      return { c, count: g.m.length, spread: sd, notes: g.m.map((p) => p.i).sort((a, b) => a - b) };
    });

    // Die Gruppe am Bezugston wird zur Stufe 0: ihr Mittel ist der neue Bezug
    let ref = null;
    for (const dg of degs) {
      const dist = Math.min(Math.abs(dg.c), Math.abs(dg.c - 1200));
      if (dist <= tol && (!ref || dist < ref.dist)) ref = { dg, dist };
    }
    let shift = 0;
    if (ref) shift = ref.dg.c > 600 ? ref.dg.c - 1200 : ref.dg.c;
    fref *= Math.pow(2, shift / 1200);
    degs = degs.map((dg) => ({ ...dg, c: ref && dg === ref.dg ? 0 : mod(dg.c - shift, 1200) }));
    if (!ref) degs.push({ c: 0, count: 0, spread: 0, notes: [] });
    degs.sort((a, b) => a.c - b.c);
    degs.forEach((dg) => { dg.f = fref * Math.pow(2, dg.c / 1200); });

    const steps = degs.map((dg, i) => (i + 1 < degs.length ? degs[i + 1].c : 1200) - dg.c);
    return { fref, degrees: degs, steps, refSung: !!ref };
  }

  // ---------- Raster, Brüche, 12-TET ----------

  // Wie gut trifft N-EDO die Stufen? maxErr/rmsErr in Cent; distinct heißt,
  // dass keine zwei Stufen auf denselben Rasterschritt fallen.
  function fitEdo(cents, o = {}) {
    const out = [];
    for (let N = o.min ?? 5; N <= (o.max ?? 72); N++) {
      const step = 1200 / N;
      let maxErr = 0, ss = 0;
      const ks = [];
      for (const c of cents) {
        const k = Math.round(c / step);
        const e = c - k * step;
        ks.push(mod(k, N));
        maxErr = Math.max(maxErr, Math.abs(e));
        ss += e * e;
      }
      out.push({ N, step, maxErr, rmsErr: Math.sqrt(ss / Math.max(1, cents.length)), steps: ks, distinct: new Set(ks).size === ks.length });
    }
    return out;
  }
  function smallestEdo(fits, tol) {
    return fits.find((x) => x.distinct && x.maxErr <= tol) || null;
  }

  // Brüche bis zur 15er-Ungeradzahlgrenze, Nenner bis 16 (wie im Mikrotonalen Synth)
  const oddPart = (x) => { while (x % 2 === 0) x /= 2; return x; };
  const RATIOS = [];
  for (let q = 1; q <= 16; q++) {
    for (let p = q; p <= 2 * q; p++) {
      if (gcd(p, q) !== 1 || Math.max(oddPart(p), oddPart(q)) > 15) continue;
      RATIOS.push({ p, q, c: 1200 * Math.log2(p / q), w: Math.log2(p * q) });
    }
  }
  // Einfachster Bruch in der Nähe: Fehler + 2.5 · log2(p·q), höchstens `limit` Cent daneben
  function nearestRatio(c, limit = 20) {
    const cc = mod(c, 1200);
    let best = null, score = Infinity;
    for (const r of RATIOS) {
      for (const shift of [0, 1200]) {
        const e = cc + shift - r.c;
        if (Math.abs(e) > limit) continue;
        const sc = Math.abs(e) + 2.5 * r.w;
        if (sc < score) { score = sc; best = { p: r.p, q: r.q, err: e }; }
      }
    }
    return best;
  }

  const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'H'];
  const NAMES_ASCII = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'H'];
  function note12(f, a4 = 440) {
    const m = 69 + 12 * Math.log2(f / a4);
    const n = Math.round(m);
    return { name: NAMES[mod(n, 12)], ascii: NAMES_ASCII[mod(n, 12)], octave: Math.floor(n / 12) - 1, dev: (m - n) * 100, midi: n };
  }

  // ---------- Export ----------

  // Scala-Text; mit kind = 'ascl' zusätzlich Tonnamen und Bezugsfrequenz für Live 12
  // (gleiches Format wie der Export des Mikrotonalen Synths).
  function toScl(scale, o = {}) {
    const name = o.name || 'gesungene-skala';
    const kind = o.kind || 'scl';
    const degs = scale.degrees.filter((dg) => dg.c > 1e-9);
    const lines = [
      `! ${name}.${kind}`,
      '!',
      o.description || `Gesungene Skala, Bezug ${scale.fref.toFixed(2)} Hz, ${scale.degrees.length} Stufen`,
      ` ${degs.length + 1}`,
      '!',
    ];
    for (const dg of degs) lines.push(' ' + dg.c.toFixed(6));
    lines.push(' 2/1');
    if (kind === 'ascl') {
      let fr = scale.fref;
      while (fr < 261.6256) fr *= 2;
      while (fr >= 523.2511) fr /= 2;
      const names = scale.degrees.map((dg) => {
        const n = note12(fr * Math.pow(2, dg.c / 1200));
        const dev = Math.round(n.dev);
        return n.ascii + (dev ? (dev > 0 ? '+' : '-') + Math.abs(dev) : '');
      });
      lines.push('!');
      lines.push('! @ABL NOTE_NAMES ' + names.map((s) => `"${s}"`).join(' '));
      lines.push(`! @ABL REFERENCE_PITCH 3 0 ${fr.toFixed(4)}`);
    }
    return lines.join('\n') + '\n';
  }

  const API = {
    bufferSizeFor, createDetector, segmentNotes, summarize, deriveScale,
    fitEdo, smallestEdo, nearestRatio, note12, toScl, centsOf, median, mod, NAMES,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Tonhoehe = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
