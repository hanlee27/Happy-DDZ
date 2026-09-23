/* rules.js — 牌型定义 / 识别 / 比较 / 出牌提示
 * 牌值: 3..10 => 3..10, J=11,Q=12,K=13,A=14, 2=15, 小王=16, 大王=17 */
(function (global) {
  'use strict';

  const SUITS = ['♠', '♥', '♣', '♦'];

  const TYPE = {
    SINGLE: 'single', PAIR: 'pair', TRIPLE: 'triple',
    TRIPLE_ONE: 'triple_one', TRIPLE_TWO: 'triple_two',
    STRAIGHT: 'straight', STRAIGHT_PAIR: 'straight_pair',
    PLANE: 'plane', PLANE_ONE: 'plane_one', PLANE_TWO: 'plane_two',
    FOUR_TWO: 'four_two', FOUR_TWO_PAIR: 'four_two_pair',
    BOMB: 'bomb', ROCKET: 'rocket'
  };

  const TYPE_CN = {
    single: '单张', pair: '对子', triple: '三张', triple_one: '三带一', triple_two: '三带二',
    straight: '顺子', straight_pair: '连对', plane: '飞机', plane_one: '飞机带单',
    plane_two: '飞机带对', four_two: '四带二', four_two_pair: '四带两对',
    bomb: '炸弹', rocket: '王炸'
  };

  const RANK_TEXT = {
    3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王'
  };

  /* ---------------- 牌堆 ---------------- */
  function createDeck() {
    const deck = [];
    let id = 0;
    for (let si = 0; si < SUITS.length; si++) {
      for (let v = 3; v <= 15; v++) deck.push({ id: id++, value: v, suit: SUITS[si] });
    }
    deck.push({ id: id++, value: 16, suit: 'joker' });
    deck.push({ id: id++, value: 17, suit: 'joker' });
    return deck;
  }

  function shuffle(arr, rng) {
    const a = arr.slice();
    const rand = rng || Math.random;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function sortDesc(cards) {
    return cards.slice().sort((a, b) => (b.value - a.value) || (a.id - b.id));
  }
  function sortAsc(cards) {
    return cards.slice().sort((a, b) => (a.value - b.value) || (a.id - b.id));
  }

  function toGroups(cards) {
    const map = new Map();
    for (const c of cards) {
      if (!map.has(c.value)) map.set(c.value, []);
      map.get(c.value).push(c);
    }
    return map;
  }

  function consecutive(vals) {
    for (let i = 1; i < vals.length; i++) if (vals[i] !== vals[i - 1] + 1) return false;
    return true;
  }

  function findRuns(vals, minLen) {
    const runs = [];
    let start = 0;
    for (let i = 1; i <= vals.length; i++) {
      if (i === vals.length || vals[i] !== vals[i - 1] + 1) {
        const seg = vals.slice(start, i);
        if (seg.length >= minLen) runs.push(seg);
        start = i;
      }
    }
    return runs;
  }

  function removeValues(cards, vals, per) {
    const need = new Map();
    for (const v of vals) need.set(v, per || 3);
    const out = [];
    for (const c of cards) {
      const left = need.get(c.value) || 0;
      if (left > 0) { need.set(c.value, left - 1); continue; }
      out.push(c);
    }
    return out;
  }

  /** 在 groups 里找连续 k 个三张（rank<=14），返回 rank 升序数组 */
  function pickTripleRun(groups, k) {
    const triples = [];
    for (const [v, arr] of groups) if (arr.length >= 3 && v <= 14) triples.push(v);
    triples.sort((a, b) => a - b);
    const runs = findRuns(triples, k);
    return runs.length ? runs[0].slice(0, k) : null;
  }

  /* ---------------- 牌型识别 ---------------- */
  function parse(cards) {
    const n = cards.length;
    if (!n) return null;

    const groups = toGroups(cards);
    const vals = [...groups.keys()].sort((a, b) => a - b);
    const byCount = { 1: [], 2: [], 3: [], 4: [] };
    for (const v of vals) byCount[groups.get(v).length].push(v);

    const res = (type, main, chain) => ({ type, main, chain: chain || 1, cards: cards.slice() });

    if (n === 2 && groups.has(16) && groups.has(17)) return res(TYPE.ROCKET, 17);
    if (n === 4 && byCount[4].length === 1) return res(TYPE.BOMB, byCount[4][0]);
    if (n === 1) return res(TYPE.SINGLE, vals[0]);
    if (n === 2 && byCount[2].length === 1) return res(TYPE.PAIR, byCount[2][0]);
    if (n === 3 && byCount[3].length === 1) return res(TYPE.TRIPLE, byCount[3][0]);

    if (n === 4 && byCount[3].length === 1 && byCount[1].length === 1) return res(TYPE.TRIPLE_ONE, byCount[3][0]);
    if (n === 5 && byCount[3].length === 1 && byCount[2].length === 1) return res(TYPE.TRIPLE_TWO, byCount[3][0]);

    // 顺子（不含 2 和王）
    if (n >= 5 && byCount[1].length === n && vals[vals.length - 1] <= 14 && consecutive(vals)) {
      return res(TYPE.STRAIGHT, vals[vals.length - 1], n);
    }
    // 连对
    if (n >= 6 && n % 2 === 0 && byCount[2].length * 2 === n && vals[vals.length - 1] <= 14 && consecutive(vals)) {
      return res(TYPE.STRAIGHT_PAIR, vals[vals.length - 1], vals.length);
    }
    // 飞机（纯）
    if (n % 3 === 0 && byCount[3].length * 3 === n && vals.length >= 2 && vals[vals.length - 1] <= 14 && consecutive(vals)) {
      return res(TYPE.PLANE, vals[vals.length - 1], vals.length);
    }
    // 飞机带单 / 飞机带对（翅膀的点数不能与飞机主体重复）
    const wingSafe = (run, rest) => {
      for (const c of rest) if (run.indexOf(c.value) >= 0) return false;
      return true;
    };
    if (n % 4 === 0) {
      const k = n / 4;
      if (k >= 2) {
        const run = pickTripleRun(groups, k);
        if (run) {
          const rest = removeValues(cards, run, 3);
          if (rest.length === k && wingSafe(run, rest)) return res(TYPE.PLANE_ONE, run[run.length - 1], k);
        }
      }
    }
    if (n % 5 === 0) {
      const k = n / 5;
      if (k >= 2) {
        const run = pickTripleRun(groups, k);
        if (run) {
          const rest = removeValues(cards, run, 3);
          if (rest.length === 2 * k && wingSafe(run, rest)) {
            let ok = true;
            for (const [, arr] of toGroups(rest)) if (arr.length !== 2) { ok = false; break; }
            if (ok) return res(TYPE.PLANE_TWO, run[run.length - 1], k);
          }
        }
      }
    }
    // 四带二 / 四带两对
    if (n === 6 && byCount[4].length === 1) return res(TYPE.FOUR_TWO, byCount[4][0]);
    if (n === 8 && byCount[4].length === 1) {
      const rest = removeValues(cards, [byCount[4][0]], 4);
      let ok = true;
      for (const [, arr] of toGroups(rest)) if (arr.length !== 2) { ok = false; break; }
      if (ok) return res(TYPE.FOUR_TWO_PAIR, byCount[4][0]);
    }
    return null;
  }

  /* ---------------- 比较 ---------------- */
  function beats(a, b) {
    if (!a) return false;
    if (!b) return true;
    if (a.type === TYPE.ROCKET) return true;
    if (b.type === TYPE.ROCKET) return false;
    if (a.type === TYPE.BOMB && b.type !== TYPE.BOMB) return true;
    if (b.type === TYPE.BOMB && a.type !== TYPE.BOMB) return false;
    if (a.type !== b.type) return false;
    if (a.chain !== b.chain) return false;
    return a.main > b.main;
  }

  /* ---------------- 组合工具 ---------------- */
  function combos(arr, k, limit) {
    const out = [];
    const cur = [];
    (function walk(start) {
      if (out.length >= limit) return;
      if (cur.length === k) { out.push(cur.slice()); return; }
      for (let i = start; i < arr.length; i++) {
        cur.push(arr[i]); walk(i + 1); cur.pop();
        if (out.length >= limit) return;
      }
    })(0);
    return out;
  }

  /* ---------------- 出牌提示 ---------------- */
  /**
   * 枚举手中所有能压过 prev 的出法；prev 为 null 表示自由出牌（本轮首家）
   */
  function findPlays(hand, prev, limit) {
    limit = limit || 80;
    const groups = toGroups(hand);
    const vals = [...groups.keys()].sort((a, b) => a - b);
    const out = [];
    const free = !prev;
    const need = prev ? prev.type : null;
    const gt = prev ? prev.main : -1;
    const chLen = prev ? prev.chain : 0;
    const okT = (t) => free || need === t;
    const push = (a) => { if (a && a.length && out.length < limit) out.push(a); };
    const cnt = (v) => (groups.get(v) || []).length;

    const valsWith = (k) => vals.filter(v => groups.get(v).length >= k);
    const take = (v, k) => groups.get(v).slice(0, k);

    // 单张 / 对子 / 三张
    if (okT(TYPE.SINGLE)) for (const v of vals) if (v > gt) push([take(v, 1)[0]]);
    if (okT(TYPE.PAIR)) for (const v of valsWith(2)) if (v > gt) push(take(v, 2));
    if (okT(TYPE.TRIPLE)) for (const v of valsWith(3)) if (v > gt) push(take(v, 3));

    // 三带一 / 三带二
    if (okT(TYPE.TRIPLE_ONE) || okT(TYPE.TRIPLE_TWO)) {
      const pool = vals.slice().sort((a, b) => (groups.get(a).length - groups.get(b).length) || (a - b));
      for (const v of valsWith(3)) {
        if (!free && v <= gt) continue;
        const singles = pool.filter(x => x !== v && groups.get(x).length >= 1);
        const pairs = pool.filter(x => x !== v && groups.get(x).length >= 2);
        if (okT(TYPE.TRIPLE_ONE)) for (const w of singles.slice(0, 4)) push(take(v, 3).concat(take(w, 1)));
        if (okT(TYPE.TRIPLE_TWO)) for (const w of pairs.slice(0, 3)) push(take(v, 3).concat(take(w, 2)));
      }
    }

    // 顺子 / 连对 / 飞机
    const runLengths = (min, max, maxCard) => {
      const list = [];
      if (!free) { if (chLen >= min && chLen <= max) list.push(chLen); }
      else for (let L = min; L <= max; L++) list.push(L);
      return list.filter(L => L >= min && L <= max);
    };

    const buildRuns = (k, type) => {
      for (const L of runLengths(k === 1 ? 5 : k === 2 ? 3 : 2, k === 1 ? 12 : k === 2 ? 10 : 6, 14)) {
        for (let s = 3; s + L - 1 <= 14; s++) {
          let ok = true;
          for (let v = s; v < s + L; v++) if (cnt(v) < k) { ok = false; break; }
          if (!ok) continue;
          if (!free && s + L - 1 <= gt) continue;
          const cards = [];
          for (let v = s; v < s + L; v++) cards.push(...take(v, k));
          push(cards);
        }
      }
    };
    if (okT(TYPE.STRAIGHT)) buildRuns(1);
    if (okT(TYPE.STRAIGHT_PAIR)) buildRuns(2);
    if (okT(TYPE.PLANE) || okT(TYPE.PLANE_ONE) || okT(TYPE.PLANE_TWO)) {
      const kList = free ? [2, 3, 4, 5] : [chLen];
      for (const k of kList) {
        if (k < 2) continue;
        for (let s = 3; s + k - 1 <= 14; s++) {
          let ok = true;
          for (let v = s; v < s + k; v++) if (cnt(v) < 3) { ok = false; break; }
          if (!ok) continue;
          if (!free && s + k - 1 <= gt) continue;
          const body = [];
          const bodyRanks = [];
          for (let v = s; v < s + k; v++) { body.push(...take(v, 3)); bodyRanks.push(v); }
          if (okT(TYPE.PLANE)) push(body);
          const rest = hand.filter(c => !body.some(b => b.id === c.id));
          const restGroups = toGroups(rest);
          const restVals = [...restGroups.keys()].filter(v => bodyRanks.indexOf(v) < 0).sort((a, b) => a - b);
          if (okT(TYPE.PLANE_ONE)) {
            const pool = restVals.slice().sort((a, b) => (restGroups.get(a).length - restGroups.get(b).length) || (a - b));
            for (const cb of combos(pool, k, 3)) {
              const w = [];
              for (const v of cb) w.push(...take2(restGroups, v, 1));
              push(body.concat(w));
            }
          }
          if (okT(TYPE.PLANE_TWO)) {
            const pool = restVals.filter(v => restGroups.get(v).length >= 2)
              .sort((a, b) => (restGroups.get(a).length - restGroups.get(b).length) || (a - b));
            for (const cb of combos(pool, k, 2)) {
              const w = [];
              for (const v of cb) w.push(...take2(restGroups, v, 2));
              push(body.concat(w));
            }
          }
        }
      }
    }

    // 四带二 / 四带两对
    if (okT(TYPE.FOUR_TWO) || okT(TYPE.FOUR_TWO_PAIR)) {
      const pool = vals.slice().sort((a, b) => (groups.get(a).length - groups.get(b).length) || (a - b));
      for (const v of valsWith(4)) {
        if (!free && v <= gt) continue;
        const singles = pool.filter(x => x !== v);
        if (okT(TYPE.FOUR_TWO)) for (const cb of combos(singles, 2, 3)) {
          push(take(v, 4).concat(cb.flatMap(x => take(x, 1))));
        }
        const pv = pool.filter(x => x !== v && groups.get(x).length >= 2);
        if (okT(TYPE.FOUR_TWO_PAIR)) for (const cb of combos(pv, 2, 2)) {
          push(take(v, 4).concat(cb.flatMap(x => take(x, 2))));
        }
      }
    }

    // 炸弹 / 王炸
    const prevIsRocket = prev && prev.type === TYPE.ROCKET;
    if (!prevIsRocket) {
      for (const v of valsWith(4)) {
        if (prev && prev.type === TYPE.BOMB && v <= gt) continue;
        push(take(v, 4));
      }
      if (groups.has(16) && groups.has(17)) push([groups.get(16)[0], groups.get(17)[0]]);
    }

    // 去重 + 排序（炸弹/王炸放最后，其余按张数、点数）
    const seen = new Set();
    const uniq = [];
    for (const arr of out) {
      const key = arr.map(c => c.id).sort((a, b) => a - b).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const p = parse(arr);
      uniq.push({ cards: sortDesc(arr), p: p });
    }
    uniq.sort((a, b) => {
      const ba = (a.p && (a.p.type === TYPE.BOMB || a.p.type === TYPE.ROCKET)) ? 1 : 0;
      const bb = (b.p && (b.p.type === TYPE.BOMB || b.p.type === TYPE.ROCKET)) ? 1 : 0;
      if (ba !== bb) return ba - bb;
      if (a.cards.length !== b.cards.length) return a.cards.length - b.cards.length;
      return (a.p ? a.p.main : 0) - (b.p ? b.p.main : 0);
    });
    return uniq.map(u => u.cards).slice(0, limit);
  }

  function take2(groups, v, k) {
    return (groups.get(v) || []).slice(0, k);
  }

  global.Rules = {
    SUITS, TYPE, TYPE_CN, RANK_TEXT,
    createDeck, shuffle, sortDesc, sortAsc,
    toGroups, consecutive, findRuns, removeValues,
    pickTripleRun, parse, beats, findPlays, combos
  };
})(typeof window !== 'undefined' ? window : this);
