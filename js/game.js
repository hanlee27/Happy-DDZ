/* game.js — 游戏流程状态机：发牌 / 叫分 / 出牌 / 结算 */
(function (global) {
  'use strict';
  const R = global.Rules;
  const AI = global.AI;
  const T = R.TYPE;

  const HUMAN = 0;            // 0 底部（我）  1 左侧机器人  2 右侧机器人
  const HUMAN_NAME = '我';
  const AI_NAMES = ['小涵', '小铭'];

  const DELAY = { aiThink: 780, afterPlay: 620, afterPass: 480, bid: 640, redeal: 1100 };
  const TURN_MS = 25000;

  const listeners = {};
  let state = null;
  let pending = null;

  /* ---------------- 事件 ---------------- */
  function on(evt, cb) {
    (listeners[evt] = listeners[evt] || []).push(cb);
  }
  function emit(evt, payload) {
    const arr = listeners[evt];
    if (!arr) return;
    for (const cb of arr) { try { cb(payload, state); } catch (e) { console.error(e); } }
  }
  function later(fn, ms) { return setTimeout(fn, ms); }

  /* ---------------- 初始化 ---------------- */
  function newState(diff) {
    return {
      phase: 'idle',            // idle | bidding | playing | over
      diff: diff || 'normal',
      hands: [[], [], []],
      hole: [],
      holeRevealed: false,
      landlord: -1,
      teammate: [null, null, null],
      baseScore: 100,
      bidMult: 1,
      bombMult: 1,
      springMult: 1,
      turn: -1,
      prev: null,
      prevSeat: -1,
      passCount: 0,
      bid: { best: 0, bestSeat: -1, order: [], idx: 0 },
      bidLog: [],
      counts: [0, 0, 0],
      totalScore: [0, 0, 0],
      lastPlay: [null, null, null],
      playTimes: [0, 0, 0],
      dealToken: 0
    };
  }

  function getState() { return state; }
  function multiplier() { return state.bidMult * state.bombMult * state.springMult; }

  function name(seat) {
    if (seat === HUMAN) return HUMAN_NAME;
    return AI_NAMES[seat === 1 ? 0 : 1];
  }

  /* ---------------- 开始一局 ---------------- */
  function start(diff) {
    clearPending();
    const keepTotal = state ? state.totalScore.slice() : [0, 0, 0];
    state = newState(diff || (state && state.diff) || 'normal');
    state.totalScore = keepTotal;

    const deck = R.shuffle(R.createDeck());
    for (let i = 0; i < 51; i++) state.hands[i % 3].push(deck[i]);
    state.hole = deck.slice(51);
    state.hands.forEach((h, i) => { state.hands[i] = R.sortDesc(h); });
    state.counts = state.hands.map(h => h.length);
    state.dealToken++;

    emit('deal', { token: state.dealToken });
    later(beginBidding, 900);
  }

  function redeal() {
    emit('redeal');
    later(() => start(state.diff), DELAY.redeal);
  }

  /* ---------------- 叫分 ---------------- */
  function beginBidding() {
    state.phase = 'bidding';
    const first = Math.floor(Math.random() * 3);
    state.bid = {
      best: 0, bestSeat: -1,
      order: [first, (first + 1) % 3, (first + 2) % 3],
      idx: 0
    };
    state.bidLog = [];
    emit('bid-start', { first });
    later(stepBid, DELAY.bid);
  }

  function stepBid() {
    if (state.phase !== 'bidding') return;
    const b = state.bid;
    if (b.idx >= 3 || b.best === 3) return finishBidding();

    const seat = b.order[b.idx];
    if (seat === HUMAN) {
      // 人类叫分需要至少能叫到 b.best+1
      if (b.best >= 3) { b.idx++; return stepBid(); }
      setPending({ type: 'bid', seat, timer: later(() => humanBid(0), TURN_MS) });
      emit('await-bid', { seat, best: b.best, deadline: Date.now() + TURN_MS });
    } else {
      setPending({ type: 'bid', seat, timer: later(() => {
        const v = AI.evaluateBid(state.hands[seat], b.best, state.diff);
        doBid(seat, v);
      }, DELAY.aiThink) });
      emit('bid-thinking', { seat });
    }
  }

  function doBid(seat, value) {
    if (state.phase !== 'bidding') return;
    clearPending();
    const b = state.bid;
    if (value > b.best) { b.best = value; b.bestSeat = seat; }
    state.bidLog.push({ seat, value });
    emit('bid', { seat, value, best: b.best, bestSeat: b.bestSeat });
    b.idx++;
    later(stepBid, DELAY.bid);
  }

  function humanBid(value) {
    if (!state || state.phase !== 'bidding') return;
    const b = state.bid;
    const seat = b.order[b.idx];
    if (seat !== HUMAN || !pending || pending.type !== 'bid') return;
    if (value !== 0 && value <= b.best) return;
    doBid(seat, value);
  }

  function finishBidding() {
    const b = state.bid;
    if (b.bestSeat < 0) {
      emit('toast', { text: '无人叫地主，重新发牌' });
      state.phase = 'idle';
      return redeal();
    }
    state.landlord = b.bestSeat;
    state.bidMult = b.best;
    const farmers = [0, 1, 2].filter(s => s !== state.landlord);
    state.teammate[state.landlord] = null;
    state.teammate[farmers[0]] = farmers[1];
    state.teammate[farmers[1]] = farmers[0];

    state.holeRevealed = true;
    state.hands[state.landlord] = R.sortDesc(state.hands[state.landlord].concat(state.hole));
    state.counts[state.landlord] = state.hands[state.landlord].length;

    emit('landlord', { seat: state.landlord, hole: state.hole, bid: b.best });
    later(() => beginPlay(), 900);
  }

  /* ---------------- 出牌流程 ---------------- */
  function setPending(p) { pending = p; }
  function clearPending() {
    if (pending) { clearTimeout(pending.timer); pending = null; }
  }

  function beginPlay() {
    if (state.phase === 'over') return;
    state.phase = 'playing';
    state.turn = state.landlord;
    state.prev = null;
    state.prevSeat = -1;
    state.passCount = 0;
    state.lastPlay = [null, null, null];
    state.playTimes = [0, 0, 0];
    emit('play-start', { landlord: state.landlord });
    later(startTurn, 500);
  }

  function startTurn() {
    if (!state || state.phase !== 'playing') return;
    const seat = state.turn;
    if (state.hands[seat].length === 0) return endGame(seat);

    const deadline = Date.now() + TURN_MS;
    emit('turn', { seat, deadline });

    if (seat === HUMAN) {
      setPending({ type: 'play', seat, timer: later(autoHuman, TURN_MS) });
      emit('await-play', { seat, deadline });
    } else {
      setPending({
        type: 'play', seat,
        timer: later(() => aiTurn(seat), DELAY.aiThink + Math.random() * 420)
      });
      emit('thinking', { seat });
    }
  }

  function autoHuman() {
    if (!state || state.phase !== 'playing' || state.turn !== HUMAN) return;
    clearPending();
    if (state.prev) return applyPass(HUMAN);
    const sorted = R.sortAsc(state.hands[HUMAN]);
    applyPlay(HUMAN, [sorted[0]]);
  }

  function aiTurn(seat) {
    if (!state || state.phase !== 'playing' || state.turn !== seat) return;
    clearPending();
    const ctx = {
      hand: state.hands[seat],
      prev: state.prev,
      prevSeat: state.prevSeat,
      me: seat,
      teammateSeat: state.teammate[seat],
      landlordSeat: state.landlord,
      counts: state.hands.map(h => h.length),
      diff: state.diff
    };
    let out = null;
    try { out = AI.decide(ctx); } catch (e) { console.error('AI 出错', e); out = null; }

    if (out && out.length) {
      const p = R.parse(out);
      const valid = p && (!state.prev || R.beats(p, state.prev)) &&
        out.every(c => state.hands[seat].some(h => h.id === c.id));
      if (valid) return applyPlay(seat, out);
    }
    if (!state.prev) {
      // 首家必须出牌，兜底出最小的单张
      return applyPlay(seat, [R.sortAsc(state.hands[seat])[0]]);
    }
    applyPass(seat);
  }

  function humanPlay(cards) {
    if (!state || state.phase !== 'playing' || state.turn !== HUMAN) return false;
    if (!pending || pending.type !== 'play') return false;
    if (!cards || !cards.length) return false;
    const p = R.parse(cards);
    if (!p) return false;
    if (state.prev && !R.beats(p, state.prev)) return false;
    if (!cards.every(c => state.hands[HUMAN].some(h => h.id === c.id))) return false;
    clearPending();
    applyPlay(HUMAN, cards);
    return true;
  }

  function humanPass() {
    if (!state || state.phase !== 'playing' || state.turn !== HUMAN) return false;
    if (!pending || pending.type !== 'play') return false;
    if (!state.prev) return false;
    clearPending();
    applyPass(HUMAN);
    return true;
  }

  function applyPlay(seat, cards) {
    clearPending();
    const p = R.parse(cards);
    const ids = new Set(cards.map(c => c.id));
    state.hands[seat] = state.hands[seat].filter(c => !ids.has(c.id));
    state.counts[seat] = state.hands[seat].length;
    state.playTimes[seat]++;
    const shown = R.sortDesc(cards);
    state.lastPlay[seat] = { cards: shown, p };

    if (p.type === T.BOMB || p.type === T.ROCKET) {
      state.bombMult *= 2;
      emit('bomb', { seat, playType: p.type, mult: multiplier() });
    }

    state.prev = p;
    state.prevSeat = seat;
    state.passCount = 0;
    emit('played', { seat, cards: shown, p, mult: multiplier() });

    if (state.hands[seat].length === 0) return later(() => endGame(seat), 620);
    if (state.hands[seat].length <= 2) emit('warn', { seat, left: state.hands[seat].length });

    state.turn = (seat + 1) % 3;
    later(startTurn, DELAY.afterPlay);
  }

  function applyPass(seat) {
    clearPending();
    state.playTimes = state.playTimes || [0, 0, 0];
    emit('passed', { seat });
    state.passCount++;
    if (state.passCount >= 2) {
      state.prev = null;
      state.prevSeat = -1;
      state.passCount = 0;
      state.lastPlay = [null, null, null];
      emit('new-trick', {});
    }
    state.turn = (seat + 1) % 3;
    later(startTurn, DELAY.afterPass);
  }

  /* ---------------- 结算 ---------------- */
  function endGame(winner) {
    if (state.phase === 'over') return;
    clearPending();
    state.phase = 'over';

    const farmers = [0, 1, 2].filter(s => s !== state.landlord);
    const landlordWin = winner === state.landlord;

    let spring = null;
    if (landlordWin && farmers.every(s => state.counts[s] === 17)) spring = 'spring';
    else if (!landlordWin && state.playTimes[state.landlord] === 1) spring = 'anti';
    if (spring) state.springMult = 2;

    const mult = multiplier();
    const S = state.baseScore * mult;
    const delta = [0, 0, 0];
    if (landlordWin) {
      delta[state.landlord] = 2 * S;
      farmers.forEach(s => { delta[s] = -S; });
    } else {
      delta[state.landlord] = -2 * S;
      farmers.forEach(s => { delta[s] = S; });
    }
    for (let i = 0; i < 3; i++) state.totalScore[i] += delta[i];

    const humanWin = winner === HUMAN || state.teammate[HUMAN] === winner;
    emit('over', {
      winner, landlordWin, spring, mult, unit: S, delta,
      totals: state.totalScore.slice(),
      humanWin,
      humanIsLandlord: state.landlord === HUMAN,
      cards: state.hands.map(h => h.length)
    });
  }

  global.Game = {
    HUMAN, DELAY, TURN_MS,
    on, emit, getState, start, name, multiplier,
    humanBid, humanPlay, humanPass,
    setPending, clearPending, later
  };
})(window);
