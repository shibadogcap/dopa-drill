// Game flow for the quiz app. Reuses the existing UI framework (screens, effects,
// audio, mascot, trophies) but replaces the math problem logic with a quiz engine.
import { startClock, onFrame, wait, tween, clamp, lerp, rand, pick, chance, centerOf, params,
  easeOutBack, easeOutCubic, easeInCubic, easeInOutCubic, easeOutQuint } from './core.js';
import { AudioEngine } from './audio.js';
import { Dopakichi, COSTUMES, dopakichiSVG } from './dopakichi.js';
import { FX } from './fx.js';
import { Backdrop } from './bg.js';
import * as store from './store.js';
import { createGuide } from './guide.js';
import * as growth from './growth.js';
import * as qs from './quests.js';
import * as tr from './trophies.js';
import * as ul from './unlocks.js';
import { QuizEngine } from './quiz.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const capture = params.has('capture');
const audio = new AudioEngine({ capture });
const fx = new FX($('#fx'), 300);
const fxBack = new FX($('#fx-back'), 520);
const bg = new Backdrop($('#bg'), $('#rays-fallback'));
const backLayer = $('#actors-back');
const frontLayer = $('#actors-front');
const hero = new Dopakichi(backLayer, { scale: 0.72, front: frontLayer });
const actors = [hero];
const crowd = [];
const body = document.body;
const sheet = $('#sheet');
const card = $('#card');
const stage = $('#stage');
const padButtons = Object.fromEntries($$('#pad button').map((b) => [b.dataset.key, b]));

const quiz = new QuizEngine();

const S = {
  screen: 'title', ready: false, currentSet: null, questionIndex: 0,
  E: 0.06, visualE: 0.02, level: 0, reach: false, shownWrong: null, wrongInQ: false,
  firstTry: 0, solved: 0, misses: 0, combo: 0, comboEnd: 0, comboLimit: 1, startT: 0, endT: 0, targetMs: 0,
  dopa: { L: 0, shown: 0, unit: '' }, reduced: false, motion: 1, settingsOpen: false,
  run: 0, muted: false, kick: 0, flash: 0, shake: 0, idleAt: 0, busyUntil: 0,
  sets: [], selectedSetId: null,
};
window.__dopa = { S, audio, quiz };

const guide = createGuide({ hero, reduced: () => S.reduced, onClose: () => {
  store.markGuideSeen();
  S.guideOpen = false;
  requestAnimationFrame(layoutActors);
  checkLoginBonus();
}});

let titleRewardTimer = 0;
function openGuide(help = false) {
  if (S.demo || S.screen !== 'title' || S.guideOpen || S.settingsOpen || S.bonusOpen || S.trophyOpen || S.confirm || S.scene) return;
  clearTimeout(titleRewardTimer);
  S.guideOpen = true;
  guide.open({ help });
}

// ---------------------------------------------------------------- utilities
const fmtTime = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const now = () => performance.now();

function setLevelClasses(L) {
  for (let i = 0; i <= 10; i++) body.classList.toggle(`lv${i}`, i <= L);
}

function showScreen(name) {
  S.screen = name;
  $$('.screen').forEach((s) => s.classList.toggle('is-active', s.id === `screen-${name}`));
  const el = $(`#screen-${name}`);
  if (!S.reduced) tween(260, (k) => { el.style.opacity = k; el.style.transform = `translateY(${(1 - k) * 18}px)`; }).then(() => { el.style.transform = ''; });
  requestAnimationFrame(layoutActors);
}

function layoutActors() {
  if (S.scene || S.guideOpen) return;
  hero.begin();
  let r;
  if (S.settingsOpen || S.bonusOpen || S.confirm || S.trophyOpen || S.skillInfo) {
    const c = $(S.bonusOpen ? '#bonus .modal-card' : S.confirm ? '#confirm .modal-card' : S.trophyOpen ? '#trophy-got .modal-card' : S.skillInfo ? '#skill-info .modal-card' : '#settings .modal-card').getBoundingClientRect();
    hero.S = 0.5; hero.place(c.left + c.width * 0.78, c.top + 4); hero.lift = 0; hero.rot = 0;
    return;
  }
  if (S.screen === 'trophy') {
    const h = $('#screen-trophy .tree-head').getBoundingClientRect();
    const c = $('#trophy-count').getBoundingClientRect();
    hero.S = 0.3; hero.place(c.left - 34, h.bottom - 16); hero.lift = 0; hero.rot = 0;
    crowd.forEach((m, i) => placeCrowd(m, i));
    return;
  }
  if (S.screen === 'collect') {
    const b = $('#co-preview').getBoundingClientRect();
    hero.S = clamp(b.height / 260, 0.4, 0.62); hero.place(b.left + b.width / 2, b.bottom - 14); hero.lift = 0; hero.rot = 0;
    return;
  }
  if (S.screen === 'title') r = $('#title-stage').getBoundingClientRect();
  else if (S.screen === 'play') r = stage.getBoundingClientRect();
  else r = $(`#screen-${S.screen} .result-card`).getBoundingClientRect();
  const onCard = S.screen === 'result';
  const scale = S.screen === 'title' ? clamp(r.height / 190, 0.7, 1.1) : onCard ? 0.6 : clamp(r.height / 175, 0.5, 0.74);
  hero.S = scale;
  const x = r.left + r.width / 2;
  const y = onCard ? r.top + 6 : r.bottom - 12;
  hero.place(x, y);
  hero.lift = 0; hero.rot = 0;
  crowd.forEach((c, i) => placeCrowd(c, i));
}

// ---------------------------------------------------------------- set selection
function dataBase() {
  const url = (store.settings().dataUrl || '').trim();
  return url || 'questions/';
}

async function initSets() {
  quiz.setBase(dataBase());
  try {
    S.sets = await quiz.loadSets();
    renderSetList();
  } catch (err) {
    console.error('Failed to load sets:', err);
    const from = quiz.dataSource;
    $('#set-list').innerHTML = `<p class="hint">問題データを読み込めませんでした（${from}）<br>せっていで問題データのURLを確認してください</p>`;
  }
}

function renderSetList() {
  const container = $('#set-list');
  container.innerHTML = '';
  S.sets.forEach((set, i) => {
    const btn = document.createElement('button');
    btn.dataset.set = set.id;
    btn.innerHTML = `${i + 1}<small>セット</small>`;
    btn.addEventListener('click', () => startQuiz(set.id));
    container.appendChild(btn);
  });
}

// ---------------------------------------------------------------- quiz flow
async function startQuiz(setId) {
  audio.unlock();
  S.run += 1;
  if (S.bonusOpen) { $('#bonus').hidden = true; S.bonusOpen = false; }
  
  try {
    S.currentSet = await quiz.loadSet(setId);
  } catch (err) {
    console.error('Failed to load set:', err);
    return;
  }
  
  S.selectedSetId = setId;
  S.questionIndex = 0;
  S.solved = 0;
  S.misses = 0;
  S.combo = 0;
  S.comboPeak = 0;
  S.dopa = { L: 0, shown: 0, unit: '' };
  S.targetMs = S.currentSet.timeLimit * 1000;
  $('#clock-label').textContent = `目標 ${fmtTime(S.targetMs)}`;
  $('.clock').classList.remove('over', 'extra', 'hurry');
  $('#ok-total').textContent = `/${S.currentSet.questions.length}`;
  const pips = $('#pips');
  pips.innerHTML = '';
  // Many questions (e.g. 90): a compact progress bar instead of 90 dots.
  S.manyPips = S.currentSet.questions.length > 20;
  pips.classList.toggle('many', S.manyPips);
  if (S.manyPips) {
    pips.innerHTML = `<span class="pcount" id="pcount"></span><i class="ptrack"><i id="pfill"></i></i>`;
  } else {
    for (let i = 0; i < S.currentSet.questions.length; i++) {
      const s = document.createElement('span');
      s.className = 'pip';
      pips.appendChild(s);
    }
  }
  updateTally();
  audio.key = 0;
  audio.startMusic();
  audio.jingle();
  showScreen('play');
  S.startT = now();
  setupQuestion();
}

function updateTally() {
  $('#ok').textContent = S.solved;
  $('#ng').textContent = S.misses;
}

async function setupQuestion() {
  S.ready = false;
  const q = quiz.getCurrentQuestion();
  if (!q) {
    await showResults();
    return;
  }
  
  S.wrongInQ = false;
  S.shownWrong = null;
  if (S.manyPips) {
    const pc = $('#pcount');
    if (pc) pc.textContent = `${S.questionIndex + 1}/${S.currentSet.questions.length}`;
    const pf = $('#pfill');
    if (pf) pf.style.transform = `scaleX(${(S.questionIndex / S.currentSet.questions.length).toFixed(3)})`;
  } else {
    $$('.pip').forEach((pp, i) => pp.classList.toggle('now', i === S.questionIndex));
  }
  $('#qtitle').textContent = S.currentSet.title;
  $('#qno').textContent = `第${S.questionIndex + 1}問`;
  
  // Render question text
  sheet.innerHTML = '';
  const textEl = document.createElement('p');
  textEl.className = 'q-text';
  textEl.textContent = q.text;
  sheet.appendChild(textEl);
  
  // Render image if present
  const imgContainer = $('#q-image');
  if (q.image) {
    imgContainer.innerHTML = `<img src="${q.image}" alt="問題画像">`;
    imgContainer.hidden = false;
  } else {
    imgContainer.innerHTML = '';
    imgContainer.hidden = true;
  }
  
  // Render options
  const pad = $('#pad');
  pad.innerHTML = '';
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.dataset.key = i;
    btn.textContent = opt;
    btn.addEventListener('click', () => answerQuestion(i));
    pad.appendChild(btn);
  });
  
  $('#step-label').innerHTML = '&nbsp;';
  
  const E = basicE(S.questionIndex);
  applyLevel(E);
  const run = S.run;
  await cardEnter(E);
  if (S.screen !== 'play' || run !== S.run) return;
  S.ready = true;
  S.qStart = now();
  S.qMisses = 0;
}

function basicE(i) {
  const total = S.currentSet ? S.currentSet.questions.length : 90;
  return total <= 1 ? 1 : 0.08 + 0.92 * (i / (total - 1)) ** 1.3;
}

function applyLevel(E) {
  S.E = E;
  const L = Math.min(10, Math.round(E * 10));
  S.level = L;
  setLevelClasses(L);
  audio.setLevel(E, 112 + 16 * Math.min(1, E));
  hero.bob = clamp(E * 1.4);
  ensureCrowd(E);
}

async function cardEnter(E) {
  if (S.reduced) { card.style.transform = ''; card.style.opacity = 1; return; }
  if (E < 0.4) {
    await tween(300, (k) => { card.style.transform = `translateX(${(1 - k) * 60}px) rotate(${(1 - k) * 3}deg)`; card.style.opacity = k; }, easeOutCubic);
  } else {
    const drop = 260 + 120 * Math.min(1, E);
    await tween(drop, (k) => { card.style.transform = `translateY(${(1 - k) * -120}px) rotate(${(1 - k) * -8}deg) scale(${0.8 + 0.2 * k})`; card.style.opacity = Math.min(1, k * 3); }, easeInCubic);
    const r = card.getBoundingClientRect();
    fx.puff(r.left + 20, r.bottom, 5); fx.puff(r.right - 20, r.bottom, 5);
    S.shake = Math.max(S.shake, 4 * E);
    audio.land();
    await tween(220, (k) => { card.style.transform = `scale(${1 + Math.sin(k * Math.PI) * 0.035 * E}, ${1 - Math.sin(k * Math.PI) * 0.05 * E})`; });
  }
  card.style.transform = '';
  card.style.opacity = 1;
}

// ---------------------------------------------------------------- input
function pressVisual(btn) {
  if (!btn) return;
  btn.classList.add('press');
  setTimeout(() => btn.classList.remove('press'), 110);
}

function answerQuestion(answerIndex) {
  if (S.screen !== 'play' || !S.ready) return;
  const btn = $$(`#pad button`)[answerIndex];
  pressVisual(btn);
  S.ready = false;
  // The monkey carries the answer from the button to the card, then scoring.
  const from = btn ? centerOf(btn) : centerOf(card);
  const to = centerOf(card);
  const label = quiz.getCurrentQuestion()?.options[answerIndex] ?? '';
  audio.keyTap(S.combo);
  hero.carry(from, to, label, {
    E: S.E,
    onGrab: () => audio.grab(),
    onPlace: () => { audio.place(); applyAnswer(answerIndex); },
  });
}

function applyAnswer(answerIndex) {
  const result = quiz.answer(S.questionIndex, answerIndex);
  if (!result) return;
  S.qMs = now() - S.qStart;
  if (result.correct) {
    S.solved += 1;
    S.firstTry += 1;
    addCombo();
    bumpDopa();
    onCorrect();
  } else {
    S.misses += 1;
    S.wrongInQ = true;
    breakCombo();
    onWrong();
  }
  updateTally();
  showExplanation(result);
  setTimeout(async () => {
    if (S.screen !== 'play') return;
    await wait(1400);
    if (S.screen !== 'play') return;
    quiz.nextQuestion();
    S.questionIndex++;
    if (quiz.isFinished()) {
      await showResults();
    } else {
      setupQuestion();
    }
  }, 1400);
}

// The explanation panel always shows after answering, right or wrong.
// Per-question explanation text comes from the data when present.
function showExplanation(result) {
  const label = $('#step-label');
  const verdict = result.correct ? 'この文は正しい' : 'この文はまちがい';
  label.innerHTML = result.correct
    ? `<b>⭕ 正解！</b>　${verdict}`
    : `<b>❌ 不正解</b>　${verdict}`;
  label.style.color = result.correct ? 'var(--mint)' : 'var(--red)';
  if (result.explanation) {
    label.innerHTML += `<br><span class="explanation">解説　${result.explanation}</span>`;
  }
  if (result.explanationImage) {
    label.innerHTML += `<br><img class="explanation-img" src="${result.explanationImage}" alt="解説画像">`;
  }
}

// ---------------------------------------------------------------- director
function popEl(el, amount = 0.6, dur = 320) {
  if (S.reduced) return;
  tween(dur, (k) => { el.style.transform = `scale(${1 + amount * (1 - k) ** 2})`; }, easeOutCubic).then(() => { el.style.transform = ''; });
}

function burstKinds(E) {
  const k = ['confetti'];
  if (E > 0.18) k.push('star');
  if (E > 0.4) k.push('spark', 'spark');
  if (E > 0.58) k.push('coin');
  if (E > 0.72) k.push('mini', 'heart');
  return k;
}

function onCorrect() {
  const E = S.E;
  const c = centerOf(card);
  popEl(card, 0.7 + E * 0.5);
  hanamaru(E);
  if (!S.reduced) {
    fx.burst(c.x, c.y, { count: Math.round(6 + 22 * E), speed: 260 + 260 * E, kinds: burstKinds(E).filter((k) => k !== 'mini' && k !== 'coin'), up: 120, life: 0.55 });
    if (E > 0.35) fxBack.burst(c.x, c.y, { count: Math.round(30 * E), speed: 700, kinds: burstKinds(E), up: 200 });
    fx.ring(c.x, c.y, { color: E > 0.5 ? '#ffd23f' : '#ff7ab6', radius: 40 + 60 * E, width: 6 });
    if (E > 0.5) S.shake = Math.max(S.shake, 2 + 3 * E);
  }
  audio.correct(S.combo, E);
  if (!S.reduced && performance.now() > S.busyUntil) {
    hero.earL.kick(500); hero.earR.kick(500);
    hero.setFace('happy', E > 0.4 ? 'grin' : 'cat');
    setTimeout(() => hero.resetFace(), 380);
    if (E > 0.3 && chance(0.6)) { S.busyUntil = performance.now() + 450; hero.hop(14 + 30 * E, 300, { audio }); }
  }
  crowd.forEach((m) => { if (chance(0.7)) m.hop(18 + rand(0, 20), 300); });
}

function onWrong() {
  const E = S.E;
  audio.wrong(E);
  const c = centerOf(card);
  if (S.reduced) return;
  tween(360, (k) => { card.style.transform = `translateX(${Math.sin(k * 28) * 7 * (1 - k)}px)`; }).then(() => { card.style.transform = ''; });
  const h = hero.headCenter;
  const t = 0.3;
  fx.add({ kind: 'text', x: c.x, y: c.y, vx: (h.x - c.x) / t, vy: (h.y - c.y) / t - 200, g: 1300, drag: 0, str: '✗', color: '#ff4f6d', size: 34, life: t });
  setTimeout(() => {
    fx.burst(h.x, h.y - 20, { count: 10, kinds: ['star'], speed: 220, up: 60 });
    fx.ring(h.x, h.y, { color: '#fff', radius: 60, width: 7 });
    S.busyUntil = performance.now() + 900;
    hero.hurt(E, c, { audio });
    if (E > 0.5) { S.shake = Math.max(S.shake, 8); S.flash = Math.max(S.flash, 0.12); }
    crowd.forEach((m) => { m.setFace('wide', 'o'); m.sq.kick(-3); setTimeout(() => m.resetFace(), 600); });
  }, t * 1000);
}

// ---------------------------------------------------------------- combo
function addCombo() {
  S.combo += 1;
  S.comboPeak = Math.max(S.comboPeak || 0, S.combo);
  showCombo();
  if (S.combo < 2) return;
  const box = $('#combo-box');
  popEl(box, 0.25 + 0.25 * Math.min(1, S.E), 240);
  if (!comboMilestone(S.combo)) return;
  audio.unit(Math.min(1, 0.3 + S.combo / 100));
  if (S.reduced) return;
  const c = centerOf(box);
  fx.text(c.x, c.y + 26, `${S.combo}コンボ！`, { color: '#ffd23f', size: 26 + Math.min(20, S.combo / 5), vy: -90, life: 1 });
  fx.burst(c.x, c.y, { count: 16 + Math.min(40, S.combo / 2), kinds: ['star', 'spark', 'confetti'], speed: 380, up: 80 });
  fx.ring(c.x, c.y, { color: '#ff7ab6', radius: 50 + Math.min(80, S.combo), width: 6 });
}

function breakCombo(timeout = false) {
  const had = S.combo;
  S.combo = 0;
  showCombo();
  if (had < 5) return;
  const box = $('#combo-box');
  audio.play('blip', audio.now(), { m: 60, v: 0.07 });
  if (S.reduced) return;
  const c = centerOf(box);
  fx.text(c.x, c.y + 20, timeout ? `${had}コンボ おわり` : `${had}コンボ`, { color: '#b9bbd9', size: 15, vy: 40, life: 0.8 });
}

function showCombo() {
  const box = $('#combo-box');
  const on = S.combo >= 2;
  box.classList.toggle('on', on);
  if (!on) return;
  $('#combo').textContent = S.combo;
  const max = comboMaxed(S.combo);
  $('#combo-mult').textContent = max ? 'ドパ×2 MAX' : `ドパ×${comboMult(S.combo).toFixed(2)}`;
  box.classList.toggle('hot', max);
}

function comboGrade() { return 3; }
function armCombo(first) {
  S.comboLimit = comboWindowMs(comboGrade(), first);
  S.comboEnd = now() + S.comboLimit;
}
function comboWindowMs(grade, first) { return 8000; }
function comboMult(combo) { return 1 + Math.min(1, combo / 50); }
function comboMaxed(combo) { return combo >= 50; }
function comboMilestone(combo) { return combo % 10 === 0; }

function tickCombo(t) {
  if (S.screen !== 'play' || S.combo < 2 || S.confirm) return;
  const left = S.comboEnd - t;
  if (!S.ready) { S.comboEnd = t + Math.max(left, 0); return; }
  if (left <= 0) { breakCombo(true); return; }
  const k = clamp(left / S.comboLimit);
  const bar = $('#combo-bar');
  bar.style.transform = `scaleX(${k.toFixed(3)})`;
  $('#combo-box').classList.toggle('hurry', k < 0.3);
}

// ---------------------------------------------------------------- dopa
function bumpDopa() {
  const prev = S.dopa.L;
  const base = 0.02;
  S.dopa.L = prev + base * (1 + S.combo * 0.01);
  const E = S.E;
  if (E > 0.12 && !S.reduced) {
    const c = centerOf(card);
    fx.text(c.x, c.y - 30, '+1', { color: pick(['#ffd23f', '#fff', '#8fd3ff', '#ffb3d6']), size: 16 + 10 * Math.min(1, E), vy: -120 });
  }
  popEl($('#dopa-box'), 0.12 + 0.2 * E, 260);
}

// ---------------------------------------------------------------- results
async function showResults() {
  const results = quiz.getResults();
  $('#result-title').textContent = S.currentSet.title;
  $('#r-score').textContent = results.score;
  $('#r-pass-fail').textContent = results.passed ? '合格！' : '不合格...';
  $('#r-pass-fail').className = results.passed ? 'pass' : 'fail';
  $('#r-ok').textContent = `${results.correct}問`;
  $('#r-ng').textContent = `${results.wrong}回`;
  $('#r-rate').textContent = `${Math.round((results.correct / results.total) * 100)}%`;
  $('#r-time').textContent = fmtTime(results.elapsed * 1000);
  $('#r-dopa').textContent = Math.round(S.dopa.L * 100);
  
  // Save progress
  const st = store.load();
  st.history.push({
    at: Date.now(),
    day: store.dayKey(),
    setId: S.currentSet.id,
    score: results.score,
    correct: results.correct,
    wrong: results.wrong,
    total: results.total,
    maxCombo: results.maxCombo,
    elapsed: results.elapsed,
    passed: results.passed,
  });
  store.save();
  
  // Check trophies
  checkTrophies(results);
  
  showScreen('result');
  audio.clear(S.E);
  celebrate(S.E, true, true);
}

// ---------------------------------------------------------------- trophies
function checkTrophies(results) {
  const st = store.load();
  const got = tr.checkTrophies(st, results);
  if (got.length > 0) {
    setTimeout(() => showTrophyGot(got), 1000);
  }
}

function showTrophyGot(trophies) {
  S.trophyOpen = true;
  $('#tg-sub').innerHTML = `${trophies.length}個 ゲット！`;
  $('#tg-list').innerHTML = trophies.map((t) => `<li><i>${t.icon}</i><div><b>${t.name}</b><small>${t.desc}</small></div></li>`).join('');
  $('#trophy-got').hidden = false;
}

// ---------------------------------------------------------------- calendar & quests
function checkLoginBonus() {
  const st = store.load();
  const today = store.dayKey();
  if (st.lastLogin !== today) {
    st.lastLogin = today;
    st.loginStreak = (st.loginStreak || 0) + 1;
    store.save();
    showBonus(st.loginStreak);
  }
}

function showBonus(streak) {
  S.bonusOpen = true;
  $('#bonus-run').innerHTML = `${streak}日連続 ログイン！`;
  $('#bonus-grid').innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const slot = document.createElement('div');
    slot.className = `bonus-slot${i < streak ? ' got' : ''}${i === streak - 1 ? ' today' : ''}`;
    slot.innerHTML = `<span class="d">${i + 1}</span>`;
    if (i < streak) slot.innerHTML += '✓';
    $('#bonus-grid').appendChild(slot);
  }
  $('#bonus-note').textContent = streak >= 7 ? 'コンプリート！' : `あと${7 - streak}日でコンプリート`;
  $('#bonus').hidden = false;
}

// ---------------------------------------------------------------- crowd & parade
function parade(E, big) {
  if (actors.length > 10 || S.motion < 0.5) return;
  const r = stage.getBoundingClientRect();
  const n = Math.round(3 + 4 * Math.min(1, E) + (big ? 2 : 0));
  const dir = chance(0.5) ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const cl = crowdLook(i);
    const m = new Dopakichi(backLayer, { scale: 0.32 + rand(0, 0.12), palette: cl.pal, front: frontLayer });
    if (cl.costume) m.setCostume(cl.costume);
    const y = r.top + rand(r.height * 0.25, r.height * 0.55);
    const x0 = dir > 0 ? -60 - i * 70 : innerWidth + 60 + i * 70;
    m.place(x0, y);
    m.setFace(pick(['happy', 'star', 'wink']), pick(['grin', 'big', 'cat']), true);
    m.hands.forEach((h) => { h.raise = 1; });
    actors.push(m);
    (async () => {
      const x1 = dir > 0 ? innerWidth + 80 : -80;
      const hops = 5 + Math.floor(rand(0, 3));
      for (let k = 1; k <= hops; k++) {
        const tx = lerp(x0, x1, k / hops);
        await m.hop(30 + rand(0, 40), 300 + rand(0, 80), { to: { x: tx, y }, spin: chance(0.25) ? 360 * dir : 0 });
      }
      m.destroy();
      actors.splice(actors.indexOf(m), 1);
    })();
  }
}

function ensureCrowd(E) {
  const want = [];
  if (E >= 0.45) want.push({ i: 0, side: -1, s: 0.46 });
  if (E >= 0.68) want.push({ i: 1, side: 1, s: 0.46 });
  if (E >= 0.88) want.push({ i: 2, side: -1.9, s: 0.36 }, { i: 3, side: 1.9, s: 0.36 });
  if (S.reduced || S.motion < 0.5) want.length = 0;
  while (crowd.length > want.length) { const m = crowd.pop(); m.destroy(); actors.splice(actors.indexOf(m), 1); }
  for (let i = crowd.length; i < want.length; i++) {
    const w = want[i];
    const cl = crowdLook(w.i);
    const m = new Dopakichi(backLayer, { scale: w.s, palette: cl.pal, front: frontLayer });
    if (cl.costume) m.setCostume(cl.costume);
    m.side = w.side; m.bob = 1;
    crowd.push(m); actors.push(m);
    placeCrowd(m, i);
    const home = { ...m.home };
    m.place(w.side < 0 ? -80 : innerWidth + 80, home.y);
    m.hop(80, 520, { to: home }).then(() => { m.place(home.x, home.y); });
  }
}

function placeCrowd(m, i) {
  const r = stage.getBoundingClientRect();
  const side = m.side || (i % 2 === 0 ? -1 : 1);
  const x = side < 0 ? r.left - 40 - i * 30 : r.right + 40 + i * 30;
  const y = r.bottom - 20;
  m.place(x, y);
}

function crowdLook(i) {
  const style = 'classic';
  if (style === 'costume') { const keys = Object.keys(COSTUMES); return { pal: CROWD_PALS[i % 5], costume: keys[(i * 3 + 1) % keys.length] }; }
  if (style === 'rainbow') return { pal: ['rainbow', 'gold', 'snow', 'rainbow', 'blue'][i % 5], costume: null };
  if (style === 'twins') return { pal: 'blue', costume: hero.costume };
  return { pal: CROWD_PALS[i % 5], costume: null };
}

const CROWD_PALS = ['blue', 'yellow', 'mint', 'violet', 'pink'];

// ---------------------------------------------------------------- celebrate
function celebrate(E, big, lastBasic) {
  const r = card.getBoundingClientRect();
  const cx = r.left + r.width / 2; const cy = r.top + r.height * 0.4;
  const W = innerWidth; const H = innerHeight;
  S.busyUntil = performance.now() + 900;
  if (S.reduced) { hero.setFace('happy', 'grin'); setTimeout(() => hero.resetFace(), 700); return; }
  hero.celebrate(Math.min(1, E), { big: E > 0.5 || big, audio });
  crowd.forEach((m, i) => setTimeout(() => m.celebrate(Math.min(1, E), { big: E > 0.8 }), 60 * i));
  const n = Math.round(18 + 80 * Math.min(1.2, E) + (big ? 50 : 0));
  fx.burst(cx, cy, { count: n, speed: 500 + 500 * E, kinds: burstKinds(E), up: 250, life: 0.6 });
  fx.ring(cx, cy, { color: '#ffd23f', radius: 120 + 200 * E, width: 10 });
  if (E > 0.25) fxBack.burst(cx, cy, { count: Math.round(100 * Math.min(1.2, E)), speed: 900 + 400 * E, kinds: burstKinds(E), up: 400 });
  if (E > 0.3) fx.streamers(W, H, Math.round(2 + 6 * E));
  if (E > 0.5) { fxBack.fireworks(W, H, Math.round(2 + 6 * E) + (big ? 4 : 0), 0.06, 0.3); S.flash = Math.max(S.flash, 0.25 * E); }
  if (E > 0.62) fxBack.rain(W, Math.round(20 + 30 * E), { kinds: ['confetti', 'confetti', 'mini', 'coin'] });
  if (E > 0.74 || big) parade(E, big);
  if (big) { S.flash = 1; fx.burst(cx, cy, { count: 50, speed: 900, kinds: ['spark', 'star', 'coin'], up: 100, life: 0.6 }); fxBack.burst(cx, cy, { count: 120, speed: 1300, kinds: ['spark', 'star', 'mini', 'coin'], up: 300 }); }
  S.shake = Math.max(S.shake, 3 + 9 * E + (big ? 6 : 0));
  tween(260, (k) => { card.style.transform = `scale(${1 + Math.sin(k * Math.PI) * 0.04 * E})`; }).then(() => { card.style.transform = ''; });
}

// ---------------------------------------------------------------- unlockable show
// Hand-drawn "hanamaru" (flower circle) mark, the classic Japanese school "correct".
function hanamaru(E, el = $('#stamp'), style = ul.variant(S.look && S.look.mark)) {
  if (style !== 'hanamaru' && MARKS[style]) { drawMark(el, style, E, { preview: el.id !== 'stamp' }); return; }
  const flower = E >= 0.45;
  const size = flower ? 150 : 110;
  const N = 11; const R = 58;
  let spiral = ''; const turns = flower ? 2.3 : 1.12;
  for (let i = 0; i <= 90; i++) { const t = i / 90; const a = -1.9 + t * turns * Math.PI * 2; const r = flower ? 9 + t * 29 : 44 + t * 7 + Math.sin(t * 9) * 1.2; spiral += `${i ? 'L' : 'M'}${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`; }
  let petals = '';
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2; const a1 = ((i + 1) / N) * Math.PI * 2;
    const p0 = [Math.cos(a0) * R * 0.78, Math.sin(a0) * R * 0.78]; const p1 = [Math.cos(a1) * R * 0.78, Math.sin(a1) * R * 0.78];
    const m = [(Math.cos((a0 + a1) / 2)) * R * 1.12, (Math.sin((a0 + a1) / 2)) * R * 1.12];
    petals += `${i ? '' : `M${p0[0].toFixed(1)} ${p0[1].toFixed(1)}`}Q${m[0].toFixed(1)} ${m[1].toFixed(1)} ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}`;
  }
  const stroke = E > 0.85 ? 'url(#rb)' : '#ff4f6d';
  el.style.cssText = `width:${size}px;height:${size}px;border:none;box-shadow:none;opacity:1;right:${flower ? 6 : 14}px;top:${E >= 0.45 ? 18 : 34}px`;
  el.innerHTML = `<svg viewBox="-70 -70 140 140" width="100%" height="100%"><defs><linearGradient id="rb" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#ff4f6d"/><stop offset=".35" stop-color="#ffb000"/><stop offset=".65" stop-color="#3fdcb0"/><stop offset="1" stop-color="#3b6bff"/></linearGradient></defs>
    <path class="sp" d="${spiral}" fill="none" stroke="${stroke}" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${flower ? `<path class="pt" d="${petals}" fill="none" stroke="${stroke}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}</svg>`;
  const paths = [...el.querySelectorAll('path')];
  // getTotalLength may not exist everywhere; fall back so scoring never breaks.
  paths.forEach((p) => { const L = p.getTotalLength ? p.getTotalLength() : 300; p.style.strokeDasharray = L; p.style.strokeDashoffset = S.reduced ? 0 : L; p.dataset.len = L; });
  if (S.reduced) { setTimeout(() => { el.style.opacity = 0; }, 900); return; }
  const drawDur = 260 + (flower ? 120 : 0);
  const token = String(Number(el.dataset.token || 0) + 1); el.dataset.token = token;
  const mine = () => el.dataset.token === token;
  tween(drawDur, (k) => {
    if (!mine()) return;
    const a = Math.min(1, k * (flower ? 1.6 : 1));
    paths[0].style.strokeDashoffset = paths[0].dataset.len * (1 - a);
    if (paths[1]) paths[1].style.strokeDashoffset = paths[1].dataset.len * (1 - clamp((k - 0.4) / 0.6));
    el.style.transform = `rotate(${-20 + 20 * k}deg) scale(${1.3 - 0.3 * k})`;
  }, easeOutCubic).then(async () => {
    if (!mine()) return;
    if (E > 0.85) tween(900, (k) => { if (mine()) el.style.transform = `rotate(${k * 360}deg)`; }, easeOutQuint);
    await wait(760);
    await tween(200, (k) => { if (mine()) el.style.opacity = 1 - k; });
  });
}

const MARKS = {
  stamp: (c) => `<circle class="sp" r="56" fill="none" stroke="${c}" stroke-width="8"/><circle class="sp" r="45" fill="none" stroke="${c}" stroke-width="2.8"/><text class="fl" y="9" text-anchor="middle" font-family="Dela Gothic One, sans-serif" font-size="24" fill="${c}" transform="rotate(-12)">せいかい</text><path class="fl" d="M-30 -30 l3 6 6 1 -4.5 4 1 6.5 -5.5 -3 -5.5 3 1 -6.5 -4.5 -4 6 -1z M30 26 l3 6 6 1 -4.5 4 1 6.5 -5.5 -3 -5.5 3 1 -6.5 -4.5 -4 6 -1z" fill="${c}"/>`,
  crown: (c) => `<path class="sp" d="M-50 30 L-58 -28 L-26 -2 L0 -46 L26 -2 L58 -28 L50 30 Z" fill="none" stroke="${c}" stroke-width="7" stroke-linejoin="round"/><path class="fl" d="M-50 30 L-58 -28 L-26 -2 L0 -46 L26 -2 L58 -28 L50 30 Z" fill="#ffd23f" opacity=".85"/><path class="sp" d="M-48 44 L48 44" stroke="${c}" stroke-width="7" stroke-linecap="round"/><circle class="fl" cx="0" cy="-46" r="7" fill="#ff4f6d"/><circle class="fl" cx="-58" cy="-28" r="6" fill="#3b6bff"/><circle class="fl" cx="58" cy="-28" r="6" fill="#3fdcb0"/><circle class="fl" cx="0" cy="12" r="9" fill="#ff7ab6"/>`,
  ring: (c) => `${Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return `<path class="sp" d="M${(Math.cos(a) * 20).toFixed(1)} ${(Math.sin(a) * 20).toFixed(1)} L${(Math.cos(a) * 52).toFixed(1)} ${(Math.sin(a) * 52).toFixed(1)}" stroke="${['#ff4f6d', '#ffb000', '#3fdcb0', '#3b6bff'][i % 4]}" stroke-width="7" stroke-linecap="round"/>`; }).join('')}${Array.from({ length: 12 }, (_, i) => { const a = ((i + 0.5) / 12) * Math.PI * 2; return `<circle class="fl" cx="${(Math.cos(a) * 60).toFixed(1)}" cy="${(Math.sin(a) * 60).toFixed(1)}" r="5" fill="${c}"/>`; }).join('')}<circle class="fl" r="12" fill="#ffd23f"/>`,
  medal: (c) => `<path class="fl" d="M-30 -66 L-8 -18 L8 -18 L-14 -66Z" fill="#3b6bff"/><path class="fl" d="M30 -66 L8 -18 L-8 -18 L14 -66Z" fill="#ff4f6d"/><circle class="sp" cy="18" r="40" fill="none" stroke="${c}" stroke-width="8"/><circle class="fl" cy="18" r="34" fill="#ffd23f"/><path class="sp" d="M0 -6 L7 9 L23 10 L11 21 L15 37 L0 28 L-15 37 L-11 21 L-23 10 L-7 9Z" fill="none" stroke="${c}" stroke-width="5" stroke-linejoin="round"/>`,
};

function drawMark(el, style, E, { preview = false } = {}) {
  const size = preview ? 120 : 110 + 50 * Math.min(1, E);
  const col = E > 0.85 ? 'url(#mk-rb)' : '#ff4f6d';
  el.style.cssText = `width:${size}px;height:${size}px;border:none;box-shadow:none;opacity:1;${preview ? '' : `right:${E >= 0.45 ? 6 : 14}px;top:${E >= 0.45 ? 18 : 34}px`}`;
  el.innerHTML = `<svg viewBox="-72 -72 144 144" width="100%" height="100%" overflow="visible"><defs><linearGradient id="mk-rb" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#ff4f6d"/><stop offset=".35" stop-color="#ffb000"/><stop offset=".65" stop-color="#3fdcb0"/><stop offset="1" stop-color="#3b6bff"/></linearGradient></defs>${MARKS[style](col)}</svg>`;
  const sp = [...el.querySelectorAll('.sp')]; const fl = [...el.querySelectorAll('.fl')];
  sp.forEach((q) => { const L = q.getTotalLength ? q.getTotalLength() : 300; q.style.strokeDasharray = L; q.style.strokeDashoffset = S.reduced ? 0 : L; q.dataset.len = L; });
  fl.forEach((q) => { q.style.opacity = S.reduced ? 1 : 0; });
  if (S.reduced) { if (!preview) setTimeout(() => { el.style.opacity = 0; }, 900); return; }
  const spin = E > 0.85;
  const token = String(Number(el.dataset.token || 0) + 1); el.dataset.token = token;
  const mine = () => el.dataset.token === token;
  tween(300 + (E >= 0.45 ? 100 : 0), (k) => {
    if (!mine()) return;
    sp.forEach((q) => { q.style.strokeDashoffset = q.dataset.len * (1 - Math.min(1, k * 1.4)); });
    fl.forEach((q) => { q.style.opacity = clamp((k - 0.45) / 0.4); });
    el.style.transform = `rotate(${-20 + 20 * k}deg) scale(${(style === 'ring' ? 0.5 + 0.5 * k : 1.3 - 0.3 * k)})`;
  }, easeOutCubic).then(async () => {
    if (!mine()) return;
    if (spin) tween(900, (k) => { if (mine()) el.style.transform = `rotate(${k * 360}deg)`; }, easeOutQuint);
    if (style === 'medal' && !spin) tween(700, (k) => { if (mine()) el.style.transform = `rotate(${Math.sin(k * Math.PI * 3) * 10 * (1 - k)}deg)`; });
    await wait(preview ? 1400 : 760);
    await tween(200, (k) => { if (mine()) el.style.opacity = 1 - k; });
  });
}

// ---------------------------------------------------------------- settings & UI bindings
function bindUI() {
  $('#open-settings').addEventListener('click', () => {
    S.settingsOpen = true;
    $('#settings').hidden = false;
  });
  $('#close-settings').addEventListener('click', async () => {
    S.settingsOpen = false;
    $('#settings').hidden = true;
    const url = $('#data-url').value.trim();
    if (url !== (store.settings().dataUrl || '')) {
      store.updateSettings({ dataUrl: url });
      await initSets();
    }
  });
  $('#open-guide').addEventListener('click', () => openGuide(true));
  $('#start').addEventListener('click', () => {
    if (S.sets.length > 0) startQuiz(S.sets[0].id);
  });
  $('#go-again').addEventListener('click', () => {
    if (S.selectedSetId) startQuiz(S.selectedSetId);
  });
  $('#go-title').addEventListener('click', () => showScreen('title'));
  $('#trophy-back').addEventListener('click', () => showScreen('title'));
  $('#collect-back').addEventListener('click', () => showScreen('title'));
  $('#open-trophy').addEventListener('click', () => showScreen('trophy'));
  $('#open-collect').addEventListener('click', () => showScreen('collect'));
  $('#mute').addEventListener('click', () => {
    S.muted = !S.muted;
    audio.setMuted(S.muted);
    $('#mute').setAttribute('aria-pressed', S.muted);
  });
  $('#reset-data').addEventListener('click', () => {
    if (confirm('すべてのデータをリセットしますか？')) {
      store.reset();
      location.reload();
    }
  });
  $('#bonus-ok').addEventListener('click', () => {
    S.bonusOpen = false;
    $('#bonus').hidden = true;
  });
  $('#tg-ok').addEventListener('click', () => {
    S.trophyOpen = false;
    $('#trophy-got').hidden = true;
  });
  $('#confirm-no').addEventListener('click', () => {
    S.confirm = false;
    $('#confirm').hidden = true;
  });
  $('#confirm-yes').addEventListener('click', () => {
    S.confirm = false;
    $('#confirm').hidden = true;
  });
  $('#close-day').addEventListener('click', () => {
    $('#day-log').hidden = true;
  });
  
  // Settings toggles
  $$('.toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.toggle;
      const st = store.load();
      st.settings[key] = !st.settings[key];
      store.save();
      btn.setAttribute('aria-pressed', st.settings[key]);
      if (key === 'sound') audio.setMuted(!st.settings[key]);
    });
  });
  
  // Volume slider
  $('#volume').addEventListener('input', (e) => {
    const st = store.load();
    st.settings.volume = Number(e.target.value) / 100;
    store.save();
    audio.setVolume(st.settings.volume);
  });
  
  // Motion slider
  $('#motion').addEventListener('input', (e) => {
    const st = store.load();
    st.settings.motion = Number(e.target.value) / 100;
    store.save();
    S.motion = st.settings.motion;
    $('#motion-val').textContent = `${e.target.value}%`;
  });
}

// ---------------------------------------------------------------- init
async function init() {
  startClock();
  bindUI();
  
  // Load settings
  const st = store.load();
  S.muted = !st.settings.sound;
  S.motion = st.settings.motion ?? 1;
  audio.setMuted(S.muted);
  audio.setVolume(st.settings.volume);
  $('#mute').setAttribute('aria-pressed', S.muted);
  $('#volume').value = st.settings.volume * 100;
  $('#motion').value = (st.settings.motion ?? 1) * 100;
  $('#motion-val').textContent = `${Math.round((st.settings.motion ?? 1) * 100)}%`;
  $('#data-url').value = st.settings.dataUrl || '';
  
  // Load sets
  await initSets();
  
  // Check guide
  if (!store.hasSeenGuide()) {
    setTimeout(() => openGuide(false), 500);
  }
  
  // Start render loop
  onFrame((dt, t) => {
    tickCombo(t);
    // Update clock
    if (S.screen === 'play' && S.currentSet) {
      const remaining = quiz.getRemainingTime();
      $('#clock').textContent = fmtTime(remaining * 1000);
      if (remaining < 60) $('.clock').classList.add('hurry');
    }
  });
  
  requestAnimationFrame(layoutActors);
}

init().catch(console.error);
