/* ui.js — 渲染与交互 */
(function (global) {
  'use strict';
  const R = global.Rules;
  const AI = global.AI;
  const Game = global.Game;
  const SFX = global.SFX;
  const HUMAN = Game.HUMAN;
  const T = R.TYPE;

  const $ = (id) => document.getElementById(id);

  const SEATS = {
    0: { name: $('name-left'), score: $('score-left'), count: $('count-left'), timer: $('timer-left'), avatar: $('avatar-left'), role: $('role-left'), bubble: $('bubble-left'), played: $('played-left') },
    1: { name: $('name-right'), score: $('score-right'), count: $('count-right'), timer: $('timer-right'), avatar: $('avatar-right'), role: $('role-right'), bubble: $('bubble-right'), played: $('played-right') },
    2: { score: $('score-me'), count: $('count-me'), avatar: $('avatar-me'), role: $('role-me'), timer: $('timer-me'), bubble: $('bubble-me'), played: $('played-center') }
  };

  const seatUI = (seat) => (seat === 0 ? SEATS[2] : seat === 1 ? SEATS[0] : SEATS[1]);

  const el = {
    holeCards: $('hole-cards'),
    playZone: $('play-zone'),
    hand: $('hand'),
    statBase: $('stat-base'), statMult: $('stat-mult'), statTotal: $('stat-total'),
    toast: $('toast'), playHint: $('play-hint'),
    btnPlay: $('btn-play'), btnPass: $('btn-pass'), btnHint: $('btn-hint'),
    controls: $('controls'), bidControls: $('bid-controls'),
    btnNobid: $('btn-nobid'), btnBid1: $('btn-bid1'), btnBid2: $('btn-bid2'), btnBid3: $('btn-bid3'),
    overlayStart: $('overlay-start'), overlayRules: $('overlay-rules'), overlayResult: $('overlay-result'),
    resultTitle: $('result-title'), resultSub: $('result-sub'), resultRows: $('result-rows'),
    btnStart: $('btn-start'), btnRules: $('btn-rules'), btnRulesClose: $('btn-rules-close'),
    btnAgain: $('btn-again'), btnAgainQuit: $('btn-again-quit'),
    btnSound: $('btn-sound'), diffGroup: $('diff-group')
  };

  let selected = new Set();     // 选中牌的 id
  let hints = [];               // 提示候选
  let hintIdx = 0;
  let diff = localStorage.getItem('ddz.diff') || 'normal';
  let soundOn = localStorage.getItem('ddz.sound') !== '0';
  let myTurn = false;
  let busy = false;

  /* ---------------- 卡牌渲染 ---------------- */
  function jokerIcon() {
    // 小丑帽图标：用 currentColor 填充，可随红/黑继承、随牌宽缩放
    return '<svg viewBox="0 0 32 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M5 19 L3 9 L11 15 Z"/>' +
      '<path d="M11 15 L16 5 L21 15 Z"/>' +
      '<path d="M21 15 L29 9 L27 19 Z"/>' +
      '<rect x="5" y="17" width="22" height="7" rx="3.5"/>' +
      '<circle cx="3" cy="8.5" r="2.3"/>' +
      '<circle cx="16" cy="4.5" r="2.3"/>' +
      '<circle cx="29" cy="8.5" r="2.3"/>' +
      '</svg>';
  }

  function cardEl(card, mini) {
    const d = document.createElement('div');
    d.className = 'card' + (mini ? ' mini' : '');
    d.dataset.id = card.id;
    const red = card.suit === '♥' || card.suit === '♦';

    if (card.value >= 16) {
      const big = card.value === 17;
      d.classList.add('joker');
      if (big) d.classList.add('red');
      const icon = jokerIcon();
      d.innerHTML = `<div class="corner">${icon}</div>
                     <div class="pip joker-pip">${icon}</div>
                     <div class="corner b">${icon}</div>`;
      return d;
    }
    if (red) d.classList.add('red');
    const r = R.RANK_TEXT[card.value];
    // 角落只保留点数，中间用大花色，避免小符号与中间花色重叠
    d.innerHTML = `<div class="corner"><span>${r}</span></div>
                   <div class="pip${mini ? ' small' : ''}">${card.suit}</div>
                   <div class="corner b"><span>${r}</span></div>`;
    return d;
  }

  function backEl(mini) {
    const d = document.createElement('div');
    d.className = 'card back' + (mini ? ' mini' : '');
    return d;
  }

  function rowOf(cards, mini) {
    const wrap = document.createElement('div');
    wrap.className = 'row';
    for (const c of cards) wrap.appendChild(cardEl(c, mini));
    return wrap;
  }

  /* ---------------- 我的牌 ---------------- */
  function renderHand() {
    const st = Game.getState();
    if (!st) return;
    el.hand.innerHTML = '';
    const cards = R.sortDesc(st.hands[HUMAN]);
    cards.forEach((c, i) => {
      const d = cardEl(c, false);
      d.style.zIndex = i + 1;
      if (selected.has(c.id)) d.classList.add('selected');
      if (myTurn) d.classList.add('pickable');
      el.hand.appendChild(d);
    });
    layoutHand();
    updateControls();
  }

  /**
   * 手牌尺寸自适应：牌之间完全不重叠，整排刚好铺满可用宽度并取到最大尺寸。
   * 牌面内部字号全部基于 --card-w 计算，因此缩放后依然清晰。
   */
  const HAND_RATIO = 1.4;      // 标准扑克牌高宽比
  const CARD_MAX_W = 112;      // 单张最大宽度，避免手上牌少时大得离谱
  const CARD_MIN_W = 15;

  function layoutHand() {
    const cards = el.hand.children;
    const n = cards.length;
    if (!n) return;

    const wrapW = el.hand.clientWidth || el.hand.parentElement.clientWidth || window.innerWidth;
    const gap = n > 20 ? 2 : 3;
    const avail = wrapW - 8;

    const byWidth = (avail - gap * (n - 1)) / n;
    const byHeight = (window.innerHeight * 0.26) / HAND_RATIO;
    let w = Math.min(byWidth, byHeight, CARD_MAX_W);
    w = Math.max(w, CARD_MIN_W);

    const root = document.documentElement.style;
    root.setProperty('--card-w', Math.floor(w) + 'px');
    root.setProperty('--card-h', Math.round(w * HAND_RATIO) + 'px');
    el.hand.style.setProperty('--hand-gap', gap + 'px');
  }

  function updateControls() {
    const st = Game.getState();
    const isMyTurn = !!st && st.phase === 'playing' && st.turn === HUMAN && myTurn;
    el.btnPlay.disabled = !isMyTurn || !isPlayable(selectedCards());
    el.btnPass.disabled = !isMyTurn || !st.prev;
    el.btnHint.disabled = !isMyTurn;
  }

  function selectedCards() {
    const st = Game.getState();
    if (!st) return [];
    return st.hands[HUMAN].filter(c => selected.has(c.id));
  }

  function isPlayable(cards) {
    const st = Game.getState();
    if (!cards.length) return false;
    const p = R.parse(cards);
    if (!p) return false;
    if (st.prev && !R.beats(p, st.prev)) return false;
    return true;
  }

  /* ---------------- 座位信息 ---------------- */
  function renderSeats() {
    const st = Game.getState();
    if (!st) return;
    for (const k of [0, 1]) {
      const s = SEATS[k];
      const seat = k + 1;   // 0 -> 左侧(seat1), 1 -> 右侧(seat2)
      s.name.textContent = Game.name(seat);
      s.count.textContent = st.hands[seat].length + ' 张';
      s.score.textContent = st.totalScore[seat] >= 0 ? '+' + st.totalScore[seat] : st.totalScore[seat];
      s.score.style.color = st.totalScore[seat] >= 0 ? '#ffd35c' : '#ff9a96';
      const role = st.landlord < 0 ? '' : (st.landlord === seat ? '地主' : '农民');
      s.role.textContent = role;
      s.role.classList.toggle('hidden', !role);
      s.role.classList.toggle('farmer', role === '农民');
      s.avatar.classList.toggle('active', st.phase === 'playing' && st.turn === seat);
    }
    // 我
    SEATS[2].count.textContent = st.hands[HUMAN].length + ' 张';
    SEATS[2].score.textContent = (st.totalScore[HUMAN] >= 0 ? '+' : '') + st.totalScore[HUMAN];
    SEATS[2].score.style.color = st.totalScore[HUMAN] >= 0 ? '#ffd35c' : '#ff9a96';
    const myRole = st.landlord < 0 ? '' : (st.landlord === HUMAN ? '地主' : '农民');
    SEATS[2].role.textContent = myRole;
    SEATS[2].role.classList.toggle('hidden', !myRole);
    SEATS[2].role.classList.toggle('farmer', myRole === '农民');
    SEATS[2].avatar.classList.toggle('active', st.phase === 'playing' && st.turn === HUMAN);

    el.statBase.textContent = st.baseScore;
    el.statMult.textContent = '×' + Game.multiplier();
    el.statTotal.textContent = st.totalScore[HUMAN] >= 0 ? '+' + st.totalScore[HUMAN] : st.totalScore[HUMAN];
  }

  function renderHole(reveal) {
    el.holeCards.innerHTML = '';
    const st = Game.getState();
    if (!st) return;
    for (const c of st.hole) {
      el.holeCards.appendChild(c && reveal ? cardEl(c, true) : backEl(true));
    }
  }

  /* ---------------- 选中态 ---------------- */
  function applySelection() {
    for (const d of el.hand.children) {
      d.classList.toggle('selected', selected.has(+d.dataset.id));
    }
    updateControls();
  }

  function clearSelection() { selected = new Set(); applySelection(); }

  /* ---------------- 出牌区 ---------------- */
  function clearPlayed() {
    for (const k of [0, 1, 2]) {
      SEATS[k].played.innerHTML = '';
      if (SEATS[k].bubble) SEATS[k].bubble.classList.add('hidden');
    }
  }

  function showPlayed(seat, cards) {
    const s = seatUI(seat);
    s.played.innerHTML = '';
    if (!cards || !cards.length) return;
    const row = rowOf(cards, true);
    row.classList.add('play-in');
    s.played.appendChild(row);
    layoutPlayed(row);
  }

  /** 出的牌：在不超出所在列的前提下尽量放大 */
  function layoutPlayed(row) {
    const n = row.children.length;
    if (!n) return;
    const pz = el.playZone;
    let colW = window.innerWidth / 3;
    if (pz) {
      const cs = getComputedStyle(pz);
      const contentW = pz.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (contentW > 0) colW = contentW / 3;
    }
    const host = row.parentElement;
    const hcs = getComputedStyle(host);
    const avail = colW - parseFloat(hcs.paddingLeft) - parseFloat(hcs.paddingRight);

    const mini = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mini-w')) || 56;
    const gap = n > 10 ? 2 : 3;
    const MINI_MIN = 22;                 // 低于这个尺寸就换行，而不是继续缩小

    let w = Math.min(mini, (avail - gap * (n - 1)) / n);
    if (w < MINI_MIN) {
      // 一行放不下：均分到多行，每行尺寸尽量一致
      const lines = Math.max(2, Math.ceil(n * (MINI_MIN + gap) / (avail + gap)));
      const perLine = Math.ceil(n / lines);
      w = Math.min(mini, (avail - gap * (perLine - 1)) / perLine);
    }
    w = Math.max(w, 12);

    // 向下取整，保证整行一定放得下（避免浮点误差触发多余换行）
    row.style.maxWidth = Math.ceil(avail + 1) + 'px';
    row.style.setProperty('--card-w', Math.floor(w) + 'px');
    row.style.setProperty('--card-h', Math.round(w * 1.4) + 'px');
    row.style.setProperty('--card-gap', gap + 'px');
  }

  function relayoutPlayed() {
    for (const k of [0, 1, 2]) {
      const row = SEATS[k].played.firstElementChild;
      if (row) layoutPlayed(row);
    }
  }

  function bubble(seat, text, ms) {
    const s = seatUI(seat);
    if (!s.bubble) return;
    s.bubble.textContent = text;
    s.bubble.classList.remove('hidden');
    s.bubble.classList.add('pop');
    clearTimeout(s.bubble._t);
    s.bubble._t = setTimeout(() => s.bubble.classList.add('hidden'), ms || 1200);
  }

  function toast(text) {
    if (!text) return;
    el.toast.textContent = text;
    el.toast.classList.remove('show');
    void el.toast.offsetWidth;
    el.toast.classList.add('show');
  }

  /* ---------------- 计时条 ---------------- */
  function stopTimers() {
    for (const k of [0, 1, 2]) {
      const t = SEATS[k].timer;
      if (!t) continue;
      t.classList.add('hidden');
      const bar = t.querySelector('.timer-bar');
      if (bar) { bar.classList.remove('run'); bar.style.animationDuration = ''; }
    }
  }

  function startTimer(seat, ms) {
    const s = seatUI(seat);
    if (!s.timer) return;
    const bar = s.timer.querySelector('.timer-bar');
    s.timer.classList.remove('hidden');
    bar.classList.remove('run');
    bar.style.animationDuration = ms + 'ms';
    void bar.offsetWidth;
    bar.classList.add('run');
  }

  /* ---------------- 叫分按钮 ---------------- */
  function showBid(best) {
    el.controls.classList.add('hidden');
    el.bidControls.classList.remove('hidden');
    el.btnBid1.disabled = best >= 1;
    el.btnBid2.disabled = best >= 2;
    el.btnBid3.disabled = best >= 3;
  }
  function hideBid() {
    el.bidControls.classList.add('hidden');
    el.controls.classList.remove('hidden');
  }
  function showControls(show) {
    el.controls.classList.toggle('hidden', !show);
  }

  /* ---------------- 结算 ---------------- */
  function showResult(p) {
    el.resultTitle.textContent = p.humanWin ? '胜 利' : '失 败';
    el.resultTitle.className = 'result-title ' + (p.humanWin ? 'win' : 'lose');
    const role = p.humanIsLandlord ? '地主' : '农民';
    let sub = `你是${role} · 底分 ${Game.getState().baseScore} × 倍数 ${p.mult}`;
    if (p.spring === 'spring') sub += ' · 春天 ×2';
    if (p.spring === 'anti') sub += ' · 反春天 ×2';
    el.resultSub.textContent = sub;

    const order = [HUMAN, 1, 2];
    el.resultRows.innerHTML = '';
    for (const seat of order) {
      const row = document.createElement('div');
      row.className = 'result-row';
      const d = p.delta[seat];
      row.innerHTML = `<span>${Game.name(seat)}${seat === HUMAN ? '（你）' : ''}</span>
                       <span class="delta ${d >= 0 ? 'plus' : 'minus'}">${d >= 0 ? '+' : ''}${d}</span>`;
      el.resultRows.appendChild(row);
    }
    el.overlayResult.classList.remove('hidden');
  }

  /* ---------------- 提示 ---------------- */
  function doHint() {
    const st = Game.getState();
    if (!st || st.phase !== 'playing' || st.turn !== HUMAN || !myTurn) return;
    if (!hints.length) {
      hints = R.findPlays(st.hands[HUMAN], st.prev, 200);
      hintIdx = 0;
    }
    if (!hints.length) {
      toast(st.prev ? '没有能压过的牌' : '');
      return;
    }
    const pick = hints[hintIdx % hints.length];
    hintIdx++;
    selected = new Set(pick.map(c => c.id));
    applySelection();
    SFX.select();
  }

  /* ---------------- 交互绑定 ---------------- */
  let dragStart = -1, dragging = false;

  function handCards() {
    const st = Game.getState();
    return st ? R.sortDesc(st.hands[HUMAN]) : [];
  }

  function idxOf(target) {
    const cardDom = target && target.closest ? target.closest('.card') : null;
    if (!cardDom) return -1;
    return handCards().findIndex(c => String(c.id) === cardDom.dataset.id);
  }

  el.hand.addEventListener('pointerdown', (e) => {
    if (!myTurn) return;
    const idx = idxOf(e.target);
    if (idx < 0) return;
    e.preventDefault();
    dragStart = idx;
    dragging = false;
    if (el.hand.setPointerCapture) { try { el.hand.setPointerCapture(e.pointerId); } catch (_) {} }
  });

  el.hand.addEventListener('pointermove', (e) => {
    if (dragStart < 0) return;
    const node = document.elementFromPoint(e.clientX, e.clientY);
    const idx = idxOf(node);
    if (idx < 0 || idx === dragStart) return;
    dragging = true;
    const a = Math.min(dragStart, idx), b = Math.max(dragStart, idx);
    selected = new Set(handCards().slice(a, b + 1).map(c => c.id));
    applySelection();
  });

  const endDrag = () => {
    if (dragStart < 0) return;
    if (!dragging) {
      const c = handCards()[dragStart];
      if (c) {
        if (selected.has(c.id)) selected.delete(c.id); else selected.add(c.id);
        SFX.select();
      }
    }
    dragStart = -1;
    dragging = false;
    hints = []; hintIdx = 0;
    applySelection();
  };
  el.hand.addEventListener('pointerup', endDrag);
  el.hand.addEventListener('pointercancel', () => { dragStart = -1; dragging = false; });

  el.btnPlay.addEventListener('click', () => {
    const cards = selectedCards();
    if (!isPlayable(cards)) return;
    SFX.click();
    if (Game.humanPlay(cards)) {
      SFX.play();
      clearSelection();
      hints = []; hintIdx = 0;
    }
  });

  el.btnPass.addEventListener('click', () => {
    SFX.click();
    if (Game.humanPass()) { SFX.pass(); clearSelection(); }
  });

  el.btnHint.addEventListener('click', doHint);

  el.btnNobid.addEventListener('click', () => { SFX.click(); Game.humanBid(0); });
  el.btnBid1.addEventListener('click', () => { SFX.click(); Game.humanBid(1); });
  el.btnBid2.addEventListener('click', () => { SFX.click(); Game.humanBid(2); });
  el.btnBid3.addEventListener('click', () => { SFX.click(); Game.humanBid(3); });

  el.btnSound.addEventListener('click', () => {
    soundOn = !soundOn;
    SFX.setEnabled(soundOn);
    el.btnSound.textContent = soundOn ? '🔊' : '🔇';
    el.btnSound.classList.toggle('off', !soundOn);
    localStorage.setItem('ddz.sound', soundOn ? '1' : '0');
  });

  el.btnRules.addEventListener('click', () => el.overlayRules.classList.remove('hidden'));
  $('btn-settings').addEventListener('click', () => el.overlayRules.classList.remove('hidden'));
  el.btnRulesClose.addEventListener('click', () => el.overlayRules.classList.add('hidden'));

  el.btnStart.addEventListener('click', () => {
    SFX.unlock();
    SFX.setEnabled(soundOn);
    el.overlayStart.classList.add('hidden');
    Game.start(diff);
  });

  el.btnAgain.addEventListener('click', () => {
    el.overlayResult.classList.add('hidden');
    Game.start(diff);
  });
  el.btnAgainQuit.addEventListener('click', () => {
    el.overlayResult.classList.add('hidden');
    el.overlayStart.classList.remove('hidden');
  });

  el.diffGroup.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    diff = chip.dataset.diff;
    localStorage.setItem('ddz.diff', diff);
    for (const c of el.diffGroup.children) c.classList.toggle('active', c === chip);
  });

  /* ---------------- 游戏事件 ---------------- */
  Game.on('deal', () => {
    selected = new Set(); hints = []; hintIdx = 0;
    clearPlayed(); stopTimers(); hideBid(); showControls(false);
    renderHole(false); renderHand(); renderSeats();
    const cards = el.hand.children;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      c.classList.add('deal');
      c.style.animationDelay = (i * 32) + 'ms';
      setTimeout(() => SFX.deal(), i * 32);
    }
  });

  Game.on('bid-start', (p) => {
    toast(`由 ${Game.name(p.first)} 开始叫分`);
  });

  Game.on('bid-thinking', (p) => {
    stopTimers();
    startTimer(p.seat, 1400);
  });

  Game.on('await-bid', (p) => {
    stopTimers();
    startTimer(HUMAN, Game.TURN_MS);
    showBid(p.best);
  });

  Game.on('bid', (p) => {
    stopTimers();
    bubble(p.seat, p.value === 0 ? '不叫' : p.value + ' 分');
    SFX.bid();
    renderSeats();
  });

  Game.on('landlord', (p) => {
    hideBid(); showControls(true); stopTimers();
    renderHole(true); renderSeats(); renderHand();
    bubble(p.seat, '我是地主！');
    toast(`${Game.name(p.seat)} 当地主 · ${p.bid} 分`);
    setTimeout(() => { renderSeats(); updateControls(); }, 400);
  });

  Game.on('turn', (p) => {
    stopTimers();
    renderSeats();
    if (p.seat === HUMAN) {
      startTimer(HUMAN, Game.TURN_MS);
    } else {
      myTurn = false;
      if (selected.size) { selected = new Set(); }
      renderHand();
      startTimer(p.seat, 1600);
    }
  });

  Game.on('thinking', () => { /* 由 turn 统一处理 */ });

  Game.on('await-play', () => {
    myTurn = true;
    hints = []; hintIdx = 0;
    renderHand();
    showControls(true);
    updateControls();
    SFX.turn();
  });

  Game.on('played', (p) => {
    myTurn = false;
    showPlayed(p.seat, p.cards);
    renderSeats();
    if (p.seat === HUMAN) clearSelection();
    renderHand();
    if (p.p.type !== T.BOMB && p.p.type !== T.ROCKET) SFX.play();
  });

  Game.on('passed', (p) => {
    bubble(p.seat, '不出');
    SFX.pass();
  });

  Game.on('new-trick', () => { clearPlayed(); });

  Game.on('bomb', (p) => {
    const label = p.playType === T.ROCKET ? '王 炸 ！！！' : '炸 弹 ！！！';
    toast(label);
    if (p.playType === T.ROCKET) SFX.rocket(); else SFX.bomb();
    renderSeats();
  });

  Game.on('warn', (p) => {
    bubble(p.seat, `只剩 ${p.left} 张`);
    SFX.turn();
  });

  Game.on('redeal', () => {
    toast('重新发牌');
    clearPlayed();
    renderSeats();
  });

  Game.on('over', (p) => {
    myTurn = false;
    stopTimers();
    renderSeats();
    if (p.humanWin) SFX.win(); else SFX.lose();
    setTimeout(() => showResult(p), 700);
  });

  Game.on('toast', (p) => toast(p.text));

  /* ---------------- 初始化 ---------------- */
  function init() {
    el.btnSound.textContent = soundOn ? '🔊' : '🔇';
    el.btnSound.classList.toggle('off', !soundOn);
    SFX.setEnabled(soundOn);
    for (const c of el.diffGroup.children) {
      c.classList.toggle('active', c.dataset.diff === diff);
    }
    el.holeCards.innerHTML = '';
    for (let i = 0; i < 3; i++) el.holeCards.appendChild(backEl(true));
  }

  window.addEventListener('resize', () => { layoutHand(); relayoutPlayed(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.UI = {
    cardEl, backEl, rowOf, renderHand, renderSeats, renderHole,
    updateControls, selectedCards, isPlayable, applySelection, clearSelection,
    showPlayed, clearPlayed, bubble, toast, stopTimers, startTimer, showResult, doHint,
    seatUI, SEATS, el
  };
})(window);
