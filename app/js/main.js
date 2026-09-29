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
import { fmtDopa } from './scoring.js';
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
  if (name === 'title') {
    try { refreshLook(); } catch { /* look modules optional */ }
    try { refreshResume(); } catch { /* storage optional */ }
    setTimeout(flushPendingBonus, 600);
  }
  $$('.screen').forEach((s) => s.classList.toggle('is-active', s.id === `screen-${name}`));
  const el = $(`#screen-${name}`);
  if (!S.reduced) tween(260, (k) => { el.style.opacity = k; el.style.transform = `translateY(${(1 - k) * 18}px)`; }).then(() => { el.style.transform = ''; });
  requestAnimationFrame(layoutActors);
}

function layoutActors(soft = false) {
  if (S.scene || S.guideOpen) return;
  // Soft relayouts (scroll) must not interrupt hops and celebrations.
  if (!soft) hero.begin();
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
    S.sets = [];
    S.setsError = `問題データを読み込めませんでした（${quiz.dataSource}）。せっていのURLかファイル追加を確認してください`;
  }
}

function renderSetList() {
  const list = $('#set-select-list');
  list.innerHTML = '';
  S.sets.forEach((set) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    if (set.imported) btn.className = 'imported';
    const count = set.questionCount ?? quiz.bundles[set.id]?.questions.length ?? '?';
    btn.innerHTML = `${set.title}<small>${count}問・${set.passScore ?? 85}点合格${set.imported ? '・取込分' : ''}</small>`;
    btn.addEventListener('click', () => {
      $('#set-select').hidden = true;
      S.setSelectOpen = false;
      startQuiz(set.id);
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
}

// ---------------------------------------------------------------- interrupted runs
const RUN_KEY = 'dopa-drill:run';
function saveRun() {
  try {
    const snap = quiz.snapshot();
    if (snap && snap.index < snap.set.questions.length) localStorage.setItem(RUN_KEY, JSON.stringify(snap));
  } catch { /* storage unavailable or run finished */ }
}
function loadRun() {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function clearRun() {
  try { localStorage.removeItem(RUN_KEY); } catch { /* ignore */ }
}
function refreshResume() {
  const snap = loadRun();
  const btn = $('#resume');
  if (snap && snap.set && (snap.index | 0) < (snap.set.questions || []).length) {
    btn.hidden = false;
    $('#resume-info').textContent = `${snap.set.title || ''} ${snap.index + 1}問目〜`;
  } else {
    btn.hidden = true;
    if (snap) clearRun();
  }
}
async function resumeRun() {
  const snap = loadRun();
  if (!snap) return;
  try {
    quiz.restore(snap);
    clearRun();
    enterPlay(false);
  } catch (err) {
    console.error('resume failed:', err);
    clearRun();
    refreshResume();
  }
}

function openSetSelect() {
  if (S.guideOpen) {
    S.guideOpen = false;
    guide.close();
  }
  if (!$('#bonus').hidden) { $('#bonus').hidden = true; S.bonusOpen = false; }
  if (!S.sets.length) {
    $('#set-select-list').innerHTML = `<li><p class="hint">${S.setsError || '問題データがありません。URLかファイルで追加してください'}</p></li>`;
  } else renderSetList();
  S.setSelectOpen = true;
  $('#set-select').hidden = false;
}

async function importFile(file) {
  const note = $('#import-note');
  try {
    const data = JSON.parse(await file.text());
    const raws = Array.isArray(data) ? data : data.sets || [data];
    let added = 0;
    for (const raw of raws) {
      try {
        const set = quiz.addBundle(raw, file.name.replace(/\.json$/i, ''));
        if (!S.sets.some((s) => s.id === set.id)) {
          S.sets.push({ id: set.id, title: set.title, passScore: set.passScore, timeLimit: set.timeLimit, questionCount: set.questions.length, imported: true });
          added += 1;
        }
      } catch { /* skip invalid entries */ }
    }
    note.textContent = added ? `${added}セット追加しました` : '追加できるセットがありませんでした';
    renderSetList();
  } catch {
    note.textContent = 'JSONを読み込めませんでした';
  }
}

// ---------------------------------------------------------------- quiz flow
async function startQuiz(setId) {
  audio.unlock();
  if (S.bonusOpen) { $('#bonus').hidden = true; S.bonusOpen = false; }

  try {
    S.currentSet = await quiz.loadSet(setId);
  } catch (err) {
    console.error('Failed to load set:', err);
    return;
  }

  clearRun();
  S.selectedSetId = setId;
  S.questionIndex = 0;
  S.solved = 0;
  S.misses = 0;
  S.combo = 0;
  S.comboPeak = 0;
  S.dopa = { L: 0, shown: 0, unit: '' };
  enterPlay();
}

function enterPlay(countPlay = true) {
  S.run += 1;
  audio.unlock();
  S.selectedSetId = S.currentSet.id;
  S.questionIndex = quiz.currentQuestionIndex;
  S.solved = quiz.correctCount;
  S.misses = quiz.wrongCount;
  S.combo = 0;
  S.comboPeak = quiz.maxCombo;
  S.dopa = { L: 0, shown: 0, unit: '' };
  $('#dopa').textContent = '0';
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
  try { refreshLook(); } catch { /* look modules optional */ }
  audio.key = 0;
  audio.startMusic();
  audio.jingle();
  if (countPlay) questNote({ type: 'play' });
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
  clearTimeout(S.explainTimer);
  S.explaining = false;
  card.classList.remove('explaining');
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
  const last = S.questionIndex === S.currentSet.questions.length - 1;
  const run = S.run;
  if (last) cutin('ラスト1問', E);
  else if (E > 0.22) cutin(`第${S.questionIndex + 1}問`, E);
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
  if (S.screen !== 'play' || !S.ready || S.paused) return;
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
    questNote({ type: 'solve', firstTry: true });
    onCorrect();
  } else {
    S.misses += 1;
    S.wrongInQ = true;
    breakCombo();
    questNote({ type: 'solve', firstTry: false });
    onWrong();
  }
  updateTally();
  showExplanation(result);
  // Tapping the card during the explanation jumps ahead immediately.
  clearTimeout(S.explainTimer);
  S.explaining = true;
  card.classList.add('explaining');
  $$('#pad button').forEach((b) => { b.disabled = true; });
  S.explainTimer = setTimeout(() => advance(), 2600);
}

async function advance() {
  if (!S.explaining) return;
  clearTimeout(S.explainTimer);
  S.explaining = false;
  card.classList.remove('explaining');
  $$('#pad button').forEach((b) => { b.disabled = false; });
  if (S.screen !== 'play') return;
  quiz.nextQuestion();
  S.questionIndex++;
  if (quiz.isFinished()) {
    await showResults();
  } else {
    setupQuestion();
  }
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
  questNote({ type: 'combo', value: S.combo });
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
  // Choice questions need reading time: generous windows (15s first, 10s after).
  S.comboLimit = first ? 15000 : 10000;
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
async function showResults({ finish = true } = {}) {
  if (finish) clearRun();
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
  renderQuestMini($('#r-quests'));

  showScreen('result');
  audio.clear(S.E);
  celebrate(S.E, true, true);
}

// ---------------------------------------------------------------- daily quests
function questCtx() {
  return { count: 90, review: 0, placed: true, hasNew: false, hasLearning: false, extraOk: false, avgCells: 2, rusty: [], polishWeek: 0, now: Date.now() };
}
const quests = () => {
  const st = store.load();
  if (!st.quests) st.quests = {};
  if (qs.ensureDay(st.quests, store.dayKey(), questCtx())) store.save();
  return st.quests;
};
function questNote(ev) {
  const q = quests();
  const done = qs.questEvent(q, ev);
  done.forEach((d, i) => setTimeout(() => questPop(d), i * 700));
  if (done.length && qs.claimReward(q)) {
    S.dopa.L += 0.3;
    setTimeout(() => questPop(null), done.length * 700 + 200);
  }
  if (done.length) { store.save(); renderQuests(); }
}
const CHECK_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5 L8.5 15 L16 5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function questRows(list) {
  return list.map((q) => {
    const k = Math.min(1, q.prog / q.goal);
    return `<li class="${q.done ? 'done' : ''}"><i class="qchk">${q.done ? CHECK_SVG : ''}</i><span class="qt">${qs.questText(q)}</span><span class="qp">${Math.min(q.prog, q.goal)}/${q.goal}</span><i class="qbar" style="--p:${k.toFixed(3)}"></i></li>`;
  }).join('');
}
function questRewardText(q) {
  if (q.rewarded) return '<b class="qdone">コンプリート！</b>';
  return 'ぜんぶで ドパ+ボーナス';
}
function renderQuests() {
  const q = quests();
  $('#quest-list').innerHTML = questRows(q.list);
  $('#quest-reward').innerHTML = questRewardText(q);
  $('#quests').classList.toggle('complete', !!q.rewarded);
}
function renderQuestMini(el) {
  const q = quests();
  el.innerHTML = `<p class="qm-head">きょうの クエスト <span>${questRewardText(q)}</span></p><ol class="quest-list">${questRows(q.list)}</ol>`;
}
function questPop(q) {
  audio.play('coin', audio.now(), { v: 0.12, m: 88 });
  const el = document.createElement('div');
  el.className = `quest-pop${q ? '' : ' all'}`;
  el.innerHTML = q ? `<b>クエスト クリア！</b><span>${qs.questText(q)}</span>` : '<b>クエスト コンプリート！</b>';
  $('#cutins').appendChild(el);
  const y = Math.max(8, $('#app').getBoundingClientRect().top + 6);
  el.style.top = `${y}px`;
  (async () => {
    if (!S.reduced) await tween(260, (k) => { el.style.transform = `translate(-50%, ${(1 - k) * -60}px) scale(${0.8 + 0.2 * k})`; el.style.opacity = k; }, easeOutBack);
    else { el.style.transform = 'translate(-50%, 0)'; el.style.opacity = 1; }
    await wait(1500);
    await tween(220, (k) => { el.style.opacity = 1 - k; });
    el.remove();
  })();
}

// ---------------------------------------------------------------- trophies
const gotTrophies = () => store.load().trophies || [];
const gotMap = () => Object.fromEntries(gotTrophies().map((id) => [id, true]));

// ---------------------------------------------------------------- collection & look
const equipState = () => {
  const st = store.load();
  if (!st.equip) st.equip = ul.defaultEquip();
  return st.equip;
};

function applyLook(look) {
  const v = (c) => ul.variant(look[c]);
  try { bg.setTheme(v('bg')); } catch { /* theme unknown, keep current */ }
  const pt = v('particle');
  fx.theme = fxBack.theme = pt === 'classic' ? null : pt;
  try { audio.setSong(v('music')); } catch { /* keep current song */ }
  try { hero.setPalette(v('color')); } catch { /* keep palette */ }
  try { hero.setCostume(v('costume') === 'none' ? null : v('costume')); } catch { /* keep costume */ }
  while (crowd.length) { const m = crowd.pop(); m.destroy(); actors.splice(actors.indexOf(m), 1); }
}

function refreshLook() {
  applyLook(ul.pickLook(equipState(), gotMap(), S.rng || Math.random));
}

let collectCat = 'bg';
function renderCollect() {
  const got = gotMap();
  const tabs = $('#co-tabs');
  tabs.innerHTML = '';
  ul.CATS.forEach(({ key, name }) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.setAttribute('aria-pressed', key === collectCat);
    b.addEventListener('click', () => { collectCat = key; renderCollect(); });
    tabs.appendChild(b);
  });
  const eq = equipState();
  const items = ul.unlockedIn(collectCat, got);
  const catName = ul.CATS.find((c) => c.key === collectCat)?.name || '';
  $('#co-note').textContent = items.length ? `${catName}（タップで きせかえ）` : 'まだないよ。トロフィーを ゲットしよう！';
  const grid = $('#co-grid');
  grid.innerHTML = '';
  items.forEach((it) => {
    const b = document.createElement('button');
    b.className = `co-item${eq[collectCat] === it.id || (eq[collectCat] === 'auto' && it.base) ? ' got' : ''}`;
    b.textContent = it.name;
    b.addEventListener('click', () => {
      equipState()[collectCat] = it.id;
      store.save();
      refreshLook();
      renderCollect();
    });
    grid.appendChild(b);
  });
  const n = gotTrophies().length;
  const cc = $('#collect-count');
  if (cc) cc.textContent = `${n}トロフィー`;
  const badge = $('#collect-badge');
  if (badge) badge.textContent = '';
}

function checkTrophies(results) {
  const st = store.load();
  if (!st.stats) st.stats = {};
  const s = st.stats;
  s.questions = (s.questions || 0) + results.total;
  if (results.wrong === 0) s.perfects = (s.perfects || 0) + 1;
  s.maxCombo = Math.max(s.maxCombo || 0, results.maxCombo);
  s.bestScore = Math.max(s.bestScore || 0, results.score);
  s.days = store.playedDays().size;
  try { s.bestStreak = store.bestStreak(); } catch { /* older saves */ }
  const fresh = tr.checkTrophies(st, results).filter((t) => !(st.trophies || []).includes(t.id));
  if (!st.trophies) st.trophies = [];
  fresh.forEach((t) => st.trophies.push(t.id));
  store.save();
  renderTrophyBadge();
  if (fresh.length > 0) {
    setTimeout(() => showTrophyGot(fresh), 1000);
  }
}

function renderTrophyBadge() {
  const n = gotTrophies().length;
  const b = $('#trophy-badge');
  if (b) b.textContent = n ? `${n}` : '';
  const c = $('#trophy-count');
  if (c) c.textContent = `${n}/${tr.TROPHIES.length}`;
}

let trophyFilter = 'all';
function renderTrophyList() {
  const got = new Set(gotTrophies());
  const list = $('#tr-list');
  const items = tr.TROPHIES.filter((t) => {
    if (trophyFilter === 'got') return got.has(t.id);
    if (trophyFilter === 'next' || trophyFilter === 'soon') return !got.has(t.id);
    return true;
  });
  if (!items.length) {
    list.innerHTML = '<p class="tr-empty">まだないよ。あそんで ゲットしよう！</p>';
    return;
  }
  const cats = [...new Set(items.map((t) => t.cat))];
  list.innerHTML = cats.map((c) => {
    const ts = items.filter((t) => t.cat === c);
    const rows = ts.map((t) => {
      const state = got.has(t.id) ? ' done' : '';
      const sub = got.has(t.id) ? 'ゲットずみ！' : t.desc;
      return `<div class="tr-series"><div style="display:grid;grid-template-columns:40px 1fr;gap:10px;align-items:center;padding:7px 12px 8px 7px;"><span class="tr-icon">${t.icon}</span><span class="tr-t"><b>${t.name}</b><span class="tr-next${state}">${sub}</span></span></div></div>`;
    }).join('');
    return `<h3 class="tr-cat">${c}</h3>${rows}`;
  }).join('');
  renderTrophyBadge();
}

function showTrophyGot(trophies) {
  S.trophyOpen = true;
  $('#tg-sub').innerHTML = `${trophies.length}個 ゲット！`;
  $('#tg-list').innerHTML = trophies.map((t) => `<li><i>${t.icon}</i><div><b>${t.name}</b><small>${t.desc}</small></div></li>`).join('');
  $('#trophy-got').hidden = false;
}

// ---------------------------------------------------------------- calendar & quests
const MODAL_IDS = ['#settings', '#set-select', '#pause-menu', '#confirm', '#day-log', '#trophy-got', '#bonus'];
function anyModalOpen() {
  return MODAL_IDS.some((id) => {
    const el = $(id);
    return el && !el.hidden;
  });
}

function checkLoginBonus() {
  const st = store.load();
  const today = store.dayKey();
  if (st.lastLogin !== today) {
    st.lastLogin = today;
    st.loginStreak = (st.loginStreak || 0) + 1;
    store.save();
  }
  // Never stack over another modal; show when the title is clear.
  if (anyModalOpen()) { S.pendingBonus = true; return; }
  showBonus(st.loginStreak || 1);
}

function flushPendingBonus() {
  if (S.pendingBonus && S.screen === 'title' && !anyModalOpen()) {
    S.pendingBonus = false;
    showBonus(store.load().loginStreak || 1);
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

// ---------------------------------------------------------------- calendar
let calCursor = null;
function renderCalendar() {
  const today = new Date();
  if (!calCursor) calCursor = { y: today.getFullYear(), m: today.getMonth() };
  const { y, m } = calCursor;
  const first = new Date(y, m, 1);
  $('#cal-title').textContent = `${y}年${m + 1}月`;
  $('#cal-prev').disabled = false;
  $('#cal-next').disabled = y > today.getFullYear() || (y === today.getFullYear() && m >= today.getMonth());
  let stk = 0, best = 0;
  try { stk = store.streak(); best = store.bestStreak(); } catch { /* older saves */ }
  $('#cal-badges').innerHTML =
    `<span class="cal-badge stk">れんぞく <b>${stk}</b>日</span>` +
    `<span class="cal-badge best">さいちょう <b>${best}</b>日</span>`;
  const summary = store.monthSummary(y, m);
  const grid = $('#cal-grid');
  grid.innerHTML = '';
  const blanks = first.getDay();
  for (let i = 0; i < blanks; i++) {
    const s = document.createElement('span');
    s.className = 'cal-day blank';
    grid.appendChild(s);
  }
  const days = new Date(y, m + 1, 0).getDate();
  const todayKey = store.dayKey();
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const b = document.createElement('button');
    b.className = 'cal-day' + (key === todayKey ? ' today' : '') + (summary[key] ? ' played' : '');
    b.innerHTML = `<span class="n">${d}</span>${summary[key] ? `<span class="sc">${summary[key].best}点</span>` : ''}`;
    if (summary[key]) {
      b.addEventListener('click', () => {
        const list = $('#day-list');
        list.innerHTML = summary[key].entries.slice(-8).reverse().map((h) =>
          `<li><span class="t">${new Date(h.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span><span class="m">${h.setId || ''}</span><span class="s">${h.score}点</span><span class="d">正解 ${h.correct}/${h.total}・${h.passed ? '合格' : '不合格'}</span></li>`).join('');
        $('#day-title').textContent = `${m + 1}月${d}日の きろく`;
        $('#day-log').hidden = false;
      });
    }
    grid.appendChild(b);
  }
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

function cutin(text, E) {
  if (S.reduced) return;
  audio.cutin();
  const r = stage.getBoundingClientRect();
  const band = document.createElement('div');
  band.className = 'cutin-band';
  const h = 58 + 26 * Math.min(1, E);
  const palettes = [['#3b6bff', '#5b8cff'], ['#ff7ab6', '#ff9ccc'], ['#ffb000', '#ffd23f'], ['#1b1d4d', '#3b3f8f']];
  const pal = palettes[Math.min(3, Math.floor(E * 3.6))];
  band.style.cssText = `top:${r.top + r.height / 2 - h / 2}px;height:${h}px;--c1:${pal[0]};--c2:${pal[1]}`;
  band.innerHTML = `<div class="band-bg"></div><div class="band-text" style="font-size:${34 + 16 * Math.min(1, E)}px">${text}</div>`;
  $('#cutins').appendChild(band);
  const rot = -6;
  (async () => {
    await tween(240, (k) => { band.style.transform = `translateX(${(1 - k) * 110}%) rotate(${rot}deg) scaleY(${0.6 + 0.4 * k})`; }, easeOutBack);
    await wait(360 + 160 * E);
    await tween(200, (k) => { band.style.transform = `translateX(${-k * 110}%) rotate(${rot}deg)`; }, easeInCubic);
    band.remove();
  })();
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
    // The guide overlay sits above modals; close it first so settings win.
    if (S.guideOpen) {
      S.guideOpen = false;
      guide.close();
      requestAnimationFrame(layoutActors);
    }
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
  $('#start').addEventListener('click', () => openSetSelect());
  $('#set-select-close').addEventListener('click', () => {
    S.setSelectOpen = false;
    $('#set-select').hidden = true;
  });
  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importFile(e.target.files[0]);
    e.target.value = '';
  });
  $('#go-again').addEventListener('click', () => {
    if (S.selectedSetId) startQuiz(S.selectedSetId);
  });
  $('#go-title').addEventListener('click', () => showScreen('title'));
  $('#trophy-back').addEventListener('click', () => showScreen('title'));
  $('#collect-back').addEventListener('click', () => showScreen('title'));
  $('#open-trophy').addEventListener('click', () => { renderTrophyList(); showScreen('trophy'); });
  $('#open-collect').addEventListener('click', () => { renderCollect(); showScreen('collect'); });
  $$('.tr-filter button').forEach((b) => b.addEventListener('click', () => {
    trophyFilter = b.dataset.f;
    $$('.tr-filter button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    renderTrophyList();
  }));
  $('#mute').addEventListener('click', () => {
    S.muted = !S.muted;
    audio.setMuted(S.muted);
    $('#mute').setAttribute('aria-pressed', S.muted);
  });
  card.addEventListener('click', () => { if (S.explaining) advance(); });
  $('#pause').addEventListener('click', () => {
    if (S.screen !== 'play' || !S.currentSet) return;
    quiz.pause();
    audio.stopMusic();
    S.paused = true;
    $('#pause-time').textContent = `第${S.questionIndex + 1}問 / ${S.currentSet.questions.length}問`;
    $('#pause-menu').hidden = false;
  });
  $('#pause-resume').addEventListener('click', () => {
    $('#pause-menu').hidden = true;
    S.paused = false;
    quiz.resume();
    audio.startMusic();
  });
  $('#pause-retire').addEventListener('click', async () => {
    $('#pause-menu').hidden = true;
    S.paused = false;
    S.explaining = false;
    clearTimeout(S.explainTimer);
    card.classList.remove('explaining');
    // Grade the run so far, but keep the snapshot for つづきから.
    saveRun();
    audio.stopMusic();
    await showResults({ finish: false });
  });
  $('#resume').addEventListener('click', () => resumeRun());
  $('#reset-data').addEventListener('click', () => {
    if (confirm('すべてのデータをリセットしますか？')) {
      store.reset();
      location.reload();
    }
  });
  // Every modal close restores the mascot (it shrinks to the dialog corner
  // while a modal is open; without this it stays small on the screen behind).
  const modalClosed = () => requestAnimationFrame(() => layoutActors());
  $('#bonus-ok').addEventListener('click', () => {
    S.bonusOpen = false;
    $('#bonus').hidden = true;
    modalClosed();
  });
  $('#tg-ok').addEventListener('click', () => {
    S.trophyOpen = false;
    $('#trophy-got').hidden = true;
    modalClosed();
  });
  $('#confirm-no').addEventListener('click', () => {
    S.confirm = false;
    $('#confirm').hidden = true;
    modalClosed();
  });
  $('#confirm-yes').addEventListener('click', () => {
    S.confirm = false;
    $('#confirm').hidden = true;
    modalClosed();
  });
  $('#close-day').addEventListener('click', () => {
    $('#day-log').hidden = true;
    modalClosed();
  });
  $('#set-select-close').addEventListener('click', () => {
    S.setSelectOpen = false;
    $('#set-select').hidden = true;
    modalClosed();
  });
  $('#cal-prev').addEventListener('click', () => {
    calCursor.m -= 1;
    if (calCursor.m < 0) { calCursor.m = 11; calCursor.y -= 1; }
    renderCalendar();
  });
  $('#cal-next').addEventListener('click', () => {
    calCursor.m += 1;
    if (calCursor.m > 11) { calCursor.m = 0; calCursor.y += 1; }
    renderCalendar();
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

addEventListener('resize', () => requestAnimationFrame(() => {
  layoutActors();
}));
addEventListener('pointermove', (e) => {
  if (S.screen !== 'play' && !S.guideOpen && !heroBusy()) hero.lookAt({ x: e.clientX, y: e.clientY });
});

// Tapping the mascot always answers with an animation.
function pokeHero() {
  if (S.guideOpen || S.settingsOpen || S.bonusOpen) return;
  if (heroBusy()) {
    hero.setFace('happy', 'grin');
    setTimeout(() => hero.resetFace(), 600);
    return;
  }
  audio.unlock();
  const roll = Math.random();
  if (roll < 0.35) hero.hop(46, 420, { audio });
  else if (roll < 0.6) hero.hop(70, 560, { spin: 360, audio });
  else if (roll < 0.8) hero.celebrate(0.5, { variant: 'earflap', audio });
  else hero.clap(3, audio);
  S.busyUntil = performance.now() + 700;
}

// Keep the mascot glued to its anchor while scrollable screens move.
// Never reposition mid-action: placing during a hop/arm job teleports it.
// A delayed retry catches the idle moment right after.
let scrollRaf = 0;
let scrollRetry = 0;
function heroBusy() {
  return hero.lift !== 0 || hero.hands.some((h) => h.job);
}
function onScrollLayout() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    if (heroBusy()) {
      clearTimeout(scrollRetry);
      scrollRetry = setTimeout(() => layoutActors(true), 600);
      return;
    }
    layoutActors(true);
  });
}
function watchScroll() {
  $$('.screen, .modal-card').forEach((el) => {
    if (!el.dataset.scrollWatched) {
      el.dataset.scrollWatched = '1';
      el.addEventListener('scroll', onScrollLayout, { passive: true });
    }
  });
}

// ---------------------------------------------------------------- init
async function init() {
  // Dev-only annotation toolbar (never bundled into production builds).
  if (import.meta.env.DEV) {
    import('agent-ui-annotation').then(({ createAnnotation }) => createAnnotation()).catch(() => {});
  }
  startClock();
  bindUI();
  watchScroll();
  hero.root.style.pointerEvents = 'auto';
  hero.root.style.cursor = 'pointer';
  hero.root.addEventListener('click', pokeHero);
  
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
  renderQuests();
  renderCalendar();
  renderTrophyBadge();
  refreshResume();
  
  // Check guide (its onClose shows the bonus); otherwise daily bonus now.
  if (!store.hasSeenGuide()) {
    setTimeout(() => openGuide(false), 500);
  } else {
    checkLoginBonus();
  }
  
  // Start render loop: clocks, shake/flash, backdrop, particles, actors.
  onFrame((dt, t) => {
    audio.update();
    tickCombo(t);
    const pulse = audio.pulse();
    const targetKick = audio.playing ? pulse.kick * (S.level >= 1 ? 1 : 0.2) : 0;
    S.kick = S.reduced ? 0 : targetKick;
    body.style.setProperty('--kick', S.kick.toFixed(3));

    // Dopa counter rolls up.
    const d = S.dopa;
    if (d.shown < d.L) {
      d.shown = Math.min(d.L, d.shown + Math.max(0.02, (d.L - d.shown) * Math.min(1, dt * 7)));
      $('#dopa').textContent = fmtDopa(d.shown);
    }

    // Quiz countdown clock.
    if (S.screen === 'play' && S.currentSet) {
      const remaining = quiz.getRemainingTime();
      $('#clock').textContent = fmtTime(remaining * 1000);
      $('.clock').classList.toggle('hurry', remaining < 60);
    }

    // Hero wanders around the stage between actions.
    if (S.screen === 'play' && !S.reduced && S.motion >= 0.35 && S.E > 0.3
        && t > S.idleAt && t > S.busyUntil && !hero.hands.some((h) => h.job)) {
      S.idleAt = t + rand(2200, 4200) / (0.6 + S.E);
      const r = stage.getBoundingClientRect();
      const x = clamp(r.left + r.width / 2 + rand(-0.28, 0.28) * r.width, r.left + 50, r.right - 50);
      hero.hop(20 + 40 * S.E, 420, { to: { x, y: hero.home.y }, spin: S.E > 0.6 && chance(0.3) ? 360 : 0 })
        .then((ok) => { if (ok) hero.x = x; });
    }

    // Screen shake (keypad stays still to keep tap targets stable).
    S.shake = Math.max(0, S.shake - dt * 30);
    const shk = S.shake * S.motion;
    const sx = shk > 0.1 && !S.reduced ? rand(-shk, shk) : 0;
    const sy = shk > 0.1 && !S.reduced ? rand(-shk, shk) : 0;
    stage.style.translate = shk > 0.1 ? `${sx}px ${sy}px` : '';
    $('.hud').style.translate = shk > 0.1 ? `${sx * 0.5}px ${sy * 0.5}px` : '';
    S.flash = Math.max(0, S.flash - dt * 3.2);
    $('#flash').style.opacity = S.reduced ? 0 : ((S.flash * S.motion) ** 1.5 * 0.6).toFixed(3);

    // Backdrop follows the excitement level.
    const vE = S.screen === 'title' ? 0.04 : lerp(Math.min(S.E, 0.3), S.E, S.motion);
    S.visualE = lerp(S.visualE, vE, Math.min(1, dt * 2.2));
    const st = bg.state;
    st.E = S.visualE;
    st.kick = S.kick;
    st.flash = S.reduced ? 0 : S.flash * S.motion;
    const hc = hero.headCenter;
    st.cx = lerp(st.cx || hc.x, S.screen === 'play' ? stage.getBoundingClientRect().left + stage.clientWidth / 2 : innerWidth / 2, Math.min(1, dt * 3));
    st.cy = lerp(st.cy || hc.y, S.screen === 'play' ? stage.getBoundingClientRect().top + stage.clientHeight * 0.55 : innerHeight * 0.4, Math.min(1, dt * 3));
    bg.render(t);
    fx.update(dt);
    fx.draw();
    fxBack.update(dt);
    fxBack.draw();
    const ctx = { beat: S.kick };
    for (const a of actors) {
      if (a === hero && S.guideOpen && S.reduced) a.update(0, 0);
      else a.update(dt, t, ctx);
    }
  });

  // Title screen idle performance.
  onFrame((dt, t) => {
    if (S.screen !== 'title' || S.guideOpen || S.reduced || S.settingsOpen || S.confirm || S.bonusOpen || S.trophyOpen) return;
    if (t > S.idleAt && t > S.busyUntil) {
      S.idleAt = t + rand(1600, 2800);
      const r = $('#title-stage').getBoundingClientRect();
      const x = r.left + r.width / 2 + rand(-0.25, 0.25) * r.width;
      const roll = Math.random();
      if (roll < 0.35) hero.hop(40, 420, { to: { x, y: hero.home.y } }).then((ok) => { if (ok) hero.x = x; });
      else if (roll < 0.55) hero.hop(70, 560, { spin: 360 });
      else if (roll < 0.75) hero.celebrate(0.4, { variant: 'earflap' });
      else hero.clap(3);
    }
  });
  
  requestAnimationFrame(layoutActors);
}

init().catch(console.error);
