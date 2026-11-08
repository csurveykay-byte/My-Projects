'use strict';
/*
 * Klondike solver, draw-one, unlimited passes through the stock.
 *
 * Cards are numbered 0..51: id = suit * 13 + rank. Rank 0 is the ace, 12 is the king.
 * Suits: 0 spades, 1 hearts, 2 diamonds, 3 clubs.
 *
 * Because the stock can be cycled any number of times, every card in the stock or
 * waste can be reached at any moment. The solver therefore treats the stock as a pool.
 * The pool is exactly the cards that are neither in the tableau nor on a foundation.
 *
 * Solver state: { d: [7 face-down arrays], u: [7 face-up arrays], f: [4 counts], s: [pool] }
 * Moves:
 *   { t: 'tf', from }          top of tableau pile -> foundation
 *   { t: 'sf', id }            stock card -> foundation
 *   { t: 'tt', from, to, n }   top n face-up cards of one pile -> another pile
 *   { t: 'st', id, to }        stock card -> tableau pile
 */

function rankOf(c) { return c % 13; }
function suitOf(c) { return (c / 13) | 0; }
function isRed(c) { const s = suitOf(c); return s === 1 || s === 2; }

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dealFromSeed(seed) {
  const rnd = mulberry32(seed);
  const deck = [];
  for (let i = 0; i < 52; i++) deck.push(i);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
  }
  const d = [], u = [];
  let p = 0;
  for (let i = 0; i < 7; i++) {
    d.push(deck.slice(p, p + i)); p += i;
    u.push([deck[p++]]);
  }
  return { d, u, f: [0, 0, 0, 0], s: deck.slice(p) };
}

function cloneState(S) {
  return { d: S.d.map(a => a.slice()), u: S.u.map(a => a.slice()), f: S.f.slice(), s: S.s.slice() };
}

function flip(S, i) {
  if (S.u[i].length === 0 && S.d[i].length > 0) S.u[i].push(S.d[i].pop());
}

function keyOf(S) {
  const parts = [];
  for (let i = 0; i < 7; i++) {
    let a = '';
    const d = S.d[i], u = S.u[i];
    for (let k = 0; k < d.length; k++) a += String.fromCharCode(65 + d[k]);
    a += '/';
    for (let k = 0; k < u.length; k++) a += String.fromCharCode(65 + u[k]);
    parts.push(a);
  }
  parts.sort();
  return parts.join(';') + String.fromCharCode(65 + S.f[0], 65 + S.f[1], 65 + S.f[2], 65 + S.f[3]);
}

function canPlace(S, c, j) {
  const t = S.u[j];
  if (t.length === 0) return S.d[j].length === 0 && rankOf(c) === 12;
  const top = t[t.length - 1];
  return isRed(top) !== isRed(c) && rankOf(top) === rankOf(c) + 1;
}

// A foundation move that can never hurt: nothing will need this card as a base.
function isSafe(S, c) {
  const r = rankOf(c);
  if (r <= 1) return true;
  const red = isRed(c);
  const a = red ? 0 : 1, b = red ? 3 : 2;
  return S.f[a] >= r && S.f[b] >= r;
}

function autoSafe(S, out) {
  let moved = true;
  while (moved) {
    moved = false;
    for (let i = 0; i < 7; i++) {
      const u = S.u[i];
      if (u.length === 0) continue;
      const c = u[u.length - 1];
      if (S.f[suitOf(c)] === rankOf(c) && isSafe(S, c)) {
        u.pop(); S.f[suitOf(c)]++; flip(S, i);
        out.push({ t: 'tf', from: i });
        moved = true;
      }
    }
    for (let k = 0; k < S.s.length; k++) {
      const c = S.s[k];
      if (S.f[suitOf(c)] === rankOf(c) && isSafe(S, c)) {
        S.s.splice(k, 1); S.f[suitOf(c)]++;
        out.push({ t: 'sf', id: c });
        moved = true;
        break;
      }
    }
  }
}

function scoreOf(S) {
  let down = 0, empty = 0;
  for (let i = 0; i < 7; i++) {
    down += S.d[i].length;
    if (S.u[i].length === 0) empty++;
  }
  return 6 * (S.f[0] + S.f[1] + S.f[2] + S.f[3]) - 8 * down + 2 * empty;
}

function finishChild(S, mv, bonus) {
  const via = [];
  autoSafe(S, via);
  return { mv, via, S, score: scoreOf(S) + bonus };
}

function gen(S) {
  const out = [];
  let firstEmpty = -1;
  for (let i = 0; i < 7; i++) if (S.u[i].length === 0) { firstEmpty = i; break; }

  // tableau -> foundation (the unsafe ones; safe ones were already applied)
  for (let i = 0; i < 7; i++) {
    const u = S.u[i];
    if (u.length === 0) continue;
    const c = u[u.length - 1];
    if (S.f[suitOf(c)] === rankOf(c)) {
      const N = cloneState(S);
      N.u[i].pop(); N.f[suitOf(c)]++; flip(N, i);
      out.push(finishChild(N, { t: 'tf', from: i }, 0));
    }
  }
  // stock -> foundation
  for (let k = 0; k < S.s.length; k++) {
    const c = S.s[k];
    if (S.f[suitOf(c)] === rankOf(c)) {
      const N = cloneState(S);
      N.s.splice(k, 1); N.f[suitOf(c)]++;
      out.push(finishChild(N, { t: 'sf', id: c }, 0));
    }
  }
  // tableau -> tableau
  for (let i = 0; i < 7; i++) {
    const u = S.u[i];
    if (u.length === 0) continue;
    for (let k = 0; k < u.length; k++) {
      const c = u[k];
      const n = u.length - k;
      const whole = k === 0;
      if (!whole) {
        const e = u[k - 1];
        if (S.f[suitOf(e)] !== rankOf(e)) continue; // only split a run to free a foundation card
      }
      for (let j = 0; j < 7; j++) {
        if (j === i) continue;
        if (S.u[j].length === 0) {
          if (j !== firstEmpty) continue;
          if (rankOf(c) !== 12) continue;
          if (whole && S.d[i].length === 0) continue; // pointless shuffle of a king column
        } else if (!canPlace(S, c, j)) continue;
        const N = cloneState(S);
        const run = N.u[i].splice(k, n);
        for (let q = 0; q < run.length; q++) N.u[j].push(run[q]);
        flip(N, i);
        out.push(finishChild(N, { t: 'tt', from: i, to: j, n }, S.d[i].length * 0.1));
      }
    }
  }
  // stock -> tableau
  for (let k = 0; k < S.s.length; k++) {
    const c = S.s[k];
    for (let j = 0; j < 7; j++) {
      if (S.u[j].length === 0) {
        if (j !== firstEmpty || rankOf(c) !== 12) continue;
      } else if (!canPlace(S, c, j)) continue;
      const N = cloneState(S);
      N.s.splice(k, 1); N.u[j].push(c);
      out.push(finishChild(N, { t: 'st', id: c, to: j }, S.d[j].length > 0 ? -1 : 0));
    }
  }
  return out;
}

// opts: { maxNodes, maxMs, onTick(nodes) }
function solve(init, opts) {
  const maxNodes = (opts && opts.maxNodes) || 60000;
  const maxMs = (opts && opts.maxMs) || 0;
  const onTick = opts && opts.onTick;
  const t0 = Date.now();
  const seen = new Set();
  let nodes = 0, aborted = false;
  const root = cloneState(init);
  const path = [];
  autoSafe(root, path);

  function dfs(S) {
    if (S.f[0] + S.f[1] + S.f[2] + S.f[3] === 52) return true;
    const key = keyOf(S);
    if (seen.has(key)) return false;
    seen.add(key);
    if (++nodes > maxNodes) { aborted = true; return false; }
    if ((nodes & 1023) === 0) {
      if (onTick && (nodes & 4095) === 0) onTick(nodes);
      if (maxMs && Date.now() - t0 > maxMs) { aborted = true; return false; }
    }
    const kids = gen(S);
    kids.sort((a, b) => b.score - a.score);
    for (let q = 0; q < kids.length; q++) {
      const kid = kids[q];
      const len = path.length;
      path.push(kid.mv);
      for (let v = 0; v < kid.via.length; v++) path.push(kid.via[v]);
      if (dfs(kid.S)) return true;
      path.length = len;
      if (aborted) return false;
    }
    return false;
  }

  const ok = dfs(root);
  return { ok, moves: ok ? path : null, nodes, aborted };
}

// Independent replay of a move list using only the rules of the game.
function verify(init, moves) {
  const S = cloneState(init);
  for (let q = 0; q < moves.length; q++) {
    const m = moves[q];
    if (m.t === 'tf') {
      const u = S.u[m.from];
      if (!u || u.length === 0) return false;
      const c = u[u.length - 1];
      if (S.f[suitOf(c)] !== rankOf(c)) return false;
      u.pop(); S.f[suitOf(c)]++; flip(S, m.from);
    } else if (m.t === 'sf') {
      const idx = S.s.indexOf(m.id);
      if (idx < 0) return false;
      if (S.f[suitOf(m.id)] !== rankOf(m.id)) return false;
      S.s.splice(idx, 1); S.f[suitOf(m.id)]++;
    } else if (m.t === 'tt') {
      const a = S.u[m.from];
      if (m.from === m.to || m.n < 1 || m.n > a.length) return false;
      const c = a[a.length - m.n];
      if (!canPlace(S, c, m.to)) return false;
      const run = a.splice(a.length - m.n, m.n);
      for (let r = 0; r < run.length; r++) S.u[m.to].push(run[r]);
      flip(S, m.from);
    } else if (m.t === 'st') {
      const idx = S.s.indexOf(m.id);
      if (idx < 0) return false;
      if (!canPlace(S, m.id, m.to)) return false;
      S.s.splice(idx, 1); S.u[m.to].push(m.id);
    } else return false;
  }
  return S.f[0] === 13 && S.f[1] === 13 && S.f[2] === 13 && S.f[3] === 13;
}

// One job per message, used by the page's worker and by its no-worker fallback.
function handleJob(m, post) {
  if (m.cmd === 'attempt') {
    const deal = dealFromSeed(m.seed);
    const t0 = Date.now();
    const r = solve(deal, {
      maxNodes: m.maxNodes, maxMs: m.maxMs,
      onTick: function (n) { post({ type: 'tick', id: m.id, nodes: n }); }
    });
    const ms = Date.now() - t0;
    const ok = r.ok && verify(deal, r.moves);
    post({ type: 'result', id: m.id, seed: m.seed, ok: ok, nodes: r.nodes, ms: ms,
           aborted: r.aborted, moves: ok ? r.moves : null, deal: ok ? deal : null });
  } else if (m.cmd === 'solve') {
    const r = solve(m.state, { maxNodes: m.maxNodes, maxMs: m.maxMs });
    const ok = r.ok && verify(m.state, r.moves);
    post({ type: 'result', id: m.id, ok: ok, nodes: r.nodes, aborted: r.aborted,
           moves: ok ? r.moves : null });
  }
}

if (typeof module !== 'undefined') {
  module.exports = { dealFromSeed, solve, verify, cloneState, rankOf, suitOf, isRed, canPlace, handleJob };
}
