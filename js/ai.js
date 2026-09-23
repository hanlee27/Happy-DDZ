/* ai.js — 机器人决策：叫分、首出、跟牌 */
(function (global) {
  'use strict';
  const R = global.Rules;
  const T = R.TYPE;

  const BOMB_TYPES = [T.BOMB, T.ROCKET];

  /* ---------------- 手牌评估 ---------------- */
  function evalHand(hand) {
    const g = R.toGroups(hand);
    let bombs = 0, twos = 0, jokers = 0, aces = 0, rocket = false;
    for (const [v, arr] of g) {
      if (arr.length === 4) bombs++;
      if (v === 15) twos += arr.length;
      if (v === 16 || v === 17) jokers += arr.length;
      if (v === 14) aces += arr.length;
    }
    if (g.has(16) && g.has(17)) { rocket = true; bombs += 1; }

    // 连牌潜力
    let straightBonus = 0;
    const vals = [...g.keys()].filter(v => v <= 14).sort((a, b) => a - b);
    for (const run of R.findRuns(vals, 5)) straightBonus += Math.min(run.length, 8) - 4;

    let score = 0;
    score += jokers * 2.4 + twos * 1.5 + aces * 0.8;
    score += bombs * 3.2 + (rocket ? 2.5 : 0);
    score += straightBonus * 0.9;
    // 单牌过多是负担
    let singles = 0;
    for (const [, arr] of g) if (arr.length === 1) singles++;
    score -= Math.max(0, singles - 6) * 0.7;
    return { score, bombs, rocket, twos, jokers, aces, singles };
  }

  /* ---------------- 叫分 ---------------- */
  /**
   * @param {Array} hand 手牌
   * @param {number} currentBid 当前最高叫分
   * @param {string} diff easy|normal|hard
   * @returns {number} 0=不叫, 1~3
   */
  function evaluateBid(hand, currentBid, diff) {
    const e = evalHand(hand);
    const s = e.score;

    let want;
    if (s >= 11) want = 3;
    else if (s >= 8) want = 2;
    else if (s >= 5.2) want = 1;
    else want = 0;

    if (diff === 'easy') {
      // 新手：阈值更高且判断有抖动
      want = s >= 12 ? 3 : s >= 9 ? 2 : s >= 6.5 ? 1 : 0;
      const jitter = [0, 0, -1, 1][Math.floor(Math.random() * 4)];
      want = Math.max(0, Math.min(3, want + jitter));
    } else if (diff === 'hard') {
      if (s >= 10) want = 3;
      else if (s >= 7) want = 2;
      else if (s >= 4.6) want = 1;
      else want = 0;
      // 王炸 / 多炸弹 直接冲
      if (e.rocket && s >= 6) want = 3;
    } else {
      if (Math.random() < 0.1) want = Math.max(0, want - 1);
    }

    return want > currentBid ? want : 0;
  }

  /* ---------------- 打分工具 ---------------- */
  function isBombType(t) { return BOMB_TYPES.indexOf(t) >= 0; }

  /** 通用代价：出这些牌对自己手牌的损耗（越大越不划算） */
  function cost(hand, cards, p) {
    const g = R.toGroups(hand);
    const used = R.toGroups(cards);
    let c = 0;
    for (const card of cards) {
      if (card.value >= 16) c += 9;
      else if (card.value >= 15) c += 4.5;
      else if (card.value >= 13) c += 1.2;
    }
    // 拆炸弹
    for (const [v, arr] of g) {
      if (arr.length === 4) {
        const u = (used.get(v) || []).length;
        if (u > 0 && u < 4) c += 9;
      }
    }
    // 拆王炸
    if (g.has(16) && g.has(17)) {
      const u = (used.get(16) || []).length + (used.get(17) || []).length;
      if (u === 1) c += 7;
    }
    if (isBombType(p.type)) c += 16;
    return c;
  }

  function pickFrom(scored, diff) {
    scored.sort((a, b) => b.score - a.score);
    if (scored.length === 0) return null;
    if (diff === 'easy' && scored.length > 1) {
      return scored[Math.floor(Math.random() * Math.min(3, scored.length))].cards;
    }
    return scored[0].cards;
  }

  /* ---------------- 首出 ---------------- */
  function leadPlay(ctx) {
    const { hand, diff } = ctx;
    const cands = R.findPlays(hand, null, 160);
    if (!cands.length) return null;

    const landlordSeat = ctx.landlordSeat;
    const oppCount = oppMin(ctx);
    const scored = [];

    for (const cards of cands) {
      const p = R.parse(cards);
      if (!p) continue;
      let s = cards.length * 2.2 - cost(hand, cards, p) - p.main * 0.45;

      // 对手只剩 1 张：绝不出单张（除非只剩单张）
      if (oppCount === 1 && p.type === T.SINGLE && hand.length > 1) s -= 60;
      // 对手只剩 2 张：尽量避免出单张/对子被一穿
      if (oppCount === 2 && p.type === T.PAIR) s -= 12;

      // 手牌已很少：优先能走完
      const left = hand.length - cards.length;
      if (left === 0) s += 1000;
      else if (left === 1) s += 6;
      else if (left <= 3) s += 3;

      // 领出时避免用炸弹
      if (isBombType(p.type) && hand.length > 5) s -= 25;

      // 队友快走完了 → 喂小牌
      if (ctx.teammateSeat !== null && ctx.counts[ctx.teammateSeat] <= 3) {
        if (p.type === T.SINGLE) s += 12 - p.main * 0.7;
        else if (p.type === T.PAIR) s += 6 - p.main * 0.5;
        if (isBombType(p.type)) s -= 20;
      }
      // 对手快走完了 → 出大牌压制 / 赶紧甩牌
      if (oppCount <= 3) {
        s += p.main * 0.5 + cards.length * 1.2;
        if (isBombType(p.type)) s += 12;
      } else if (oppCount <= 5) {
        s += cards.length * 1.2;
      }

      // 残局且自己是大牌持有者，出最小即可
      if (diff === 'easy') s += Math.random() * 8;
      else s += Math.random() * 2.4;

      scored.push({ cards, score: s });
    }
    return pickFrom(scored, diff);
  }

  /* ---------------- 跟牌 ---------------- */
  function followPlay(ctx) {
    const { hand, prev, prevSeat, teammateSeat, diff } = ctx;
    const cands = R.findPlays(hand, prev, 200);
    if (!cands.length) return null;

    const canFinish = (cards) => cards.length === hand.length;
    const oppCount = oppMin(ctx);

    // 能一把走完，直接走
    for (const cards of cands) {
      if (canFinish(cards)) return cards;
    }

    // 上一手是队友出的，一般不压；自己手牌很少时例外（趁机把牌甩掉）
    if (teammateSeat !== null && prevSeat === teammateSeat && hand.length > 3) {
      return null;
    }

    const normal = [], bombs = [];
    for (const cards of cands) {
      const p = R.parse(cards);
      if (!p) continue;
      (isBombType(p.type) ? bombs : normal).push({ cards, p });
    }

    // 优先普通的压牌
    if (normal.length) {
      normal.sort((a, b) => a.p.main - b.p.main || a.cards.length - b.cards.length);
      for (const cand of normal) {
        const p = cand.p;
        const leave = hand.length - cand.cards.length;

        // 别为了小牌浪费 2 / 王（农民抢回出牌权更积极，地主更惜牌）
        const saveBig = ctx.isLandlord ? 6 : 10;
        if (oppCount > 3 && hand.length > saveBig) {
          if (p.type === T.SINGLE && p.main >= 16 && prev.main <= 12) continue;
          if (p.type === T.SINGLE && p.main === 15 && prev.main <= 10) continue;
          if (p.type === T.PAIR && p.main >= 15 && prev.main <= 12) continue;
        }
        // 出了之后剩一堆散牌，且对手还不紧张 → 谨慎
        if (leave >= 8 && cost(hand, cand.cards, p) >= 9 && oppCount > (ctx.isLandlord ? 5 : 7)) continue;

        return cand.cards;
      }
      // 没有合适的普通牌 → 视情况
      if (oppCount > 4 && hand.length - normal[0].cards.length > 4) return null;
      return normal[0].cards;
    }

    // 只剩炸弹/王炸
    if (!bombs.length) return null;
    bombs.sort((a, b) => a.p.main - b.p.main);
    const landlordPress = ctx.isLandlord ? oppCount <= 3 : (ctx.landlordCount <= 5);
    const worth = oppCount <= 2 || landlordPress || hand.length <= 5;
    if (worth) return bombs[0].cards;
    if (diff === 'hard' && oppCount <= 4 && Math.random() < 0.5) return bombs[0].cards;
    return null;
  }

  function oppMin(ctx) {
    let m = Infinity;
    for (let i = 0; i < 3; i++) {
      if (i === ctx.me) continue;
      if (ctx.teammateSeat !== null && i === ctx.teammateSeat) continue;
      m = Math.min(m, ctx.counts[i]);
    }
    return m === Infinity ? 17 : m;
  }

  /* ---------------- 入口 ---------------- */
  function decide(ctx) {
    const hand = R.sortDesc(ctx.hand || []);
    if (!hand.length) return null;
    ctx = Object.assign({}, ctx, { hand });

    if (ctx.counts) {
      ctx.landlordCount = ctx.counts[ctx.landlordSeat];
      ctx.isLandlord = ctx.teammateSeat === null;
    }

    const whole = R.parse(hand);
    if (whole && (!ctx.prev || R.beats(whole, ctx.prev))) return hand;

    if (!ctx.prev) return leadPlay(ctx);
    return followPlay(ctx);
  }

  global.AI = { evalHand, evaluateBid, decide, cost };
})(window);
