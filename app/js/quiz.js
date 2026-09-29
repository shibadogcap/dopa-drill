// Quiz engine: loads question sets, manages game state, scoring, and progression.

export class QuizEngine {
  constructor() {
    // Base URL for question data. Same-origin 'questions/' is the fallback
    // (local dev / bundled data); set an http(s) URL to load from the web.
    this.base = 'questions/';
    this.sets = [];
    // In-memory question bundles (e.g. imported from a file), keyed by set id.
    this.bundles = {};
    this.paused = false;
    this.pauseStart = 0;
    this.currentSet = null;
    this.currentQuestionIndex = 0;
    this.score = 0;
    this.correctCount = 0;
    this.wrongCount = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.answers = [];
    this.startTime = 0;
    this.endTime = 0;
    this.timeLimit = 0;
    this.passScore = 0;
  }

  setBase(url) {
    if (!url) return;
    this.base = url.endsWith('/') ? url : `${url}/`;
  }

  get dataSource() {
    return this.base;
  }

  async loadSets() {
    const res = await fetch(`${this.base}index.json`);
    if (!res.ok) throw new Error('Failed to load question index');
    const index = await res.json();
    this.sets = index.sets;
    return this.sets;
  }

  // Register a full set object loaded from elsewhere (file import).
  // Returns the normalized set id.
  addBundle(raw, hint = '') {
    const norm = (s) => ({
      id: '',
      title: hint,
      passScore: 85,
      timeLimit: 2700,
      type: 'truefalse',
      ...s,
    });
    const set = norm(raw);
    let id = String(set.id || hint || `imported-${Date.now()}`).toLowerCase().replace(/[^a-z0-9-]+/g, '-') || `imported-${Date.now()}`;
    let n = 1;
    const taken = new Set([...this.sets.map((s) => s.id), ...Object.keys(this.bundles)]);
    let uid = id;
    while (taken.has(uid)) uid = `${id}-${++n}`;
    set.id = uid;
    if (!Array.isArray(set.questions) || !set.questions.length) throw new Error('no questions');
    set.questions = set.questions.map((q, i) => ({
      id: q.id || `q${i + 1}`,
      type: q.type || 'truefalse',
      text: q.text || '',
      options: Array.isArray(q.options) && q.options.length >= 2 ? q.options.slice(0, 4) : ['正解', '不正解'],
      answer: Math.min(Math.max(0, q.answer | 0), 3),
      explanation: q.explanation || '',
      ...(q.image ? { image: q.image } : {}),
      ...(q.explanationImage ? { explanationImage: q.explanationImage } : {}),
    }));
    this.bundles[uid] = set;
    return set;
  }

  async loadSet(setId) {
    if (this.bundles[setId]) {
      this.currentSet = this.bundles[setId];
      this.resetRun();
      return this.currentSet;
    }
    const res = await fetch(`${this.base}${setId}.json`);
    if (!res.ok) throw new Error(`Failed to load set ${setId}`);
    this.currentSet = await res.json();
    this.resetRun();
    return this.currentSet;
  }

  resetRun() {
    this.currentQuestionIndex = 0;
    this.score = 0;
    this.correctCount = 0;
    this.wrongCount = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.answers = [];
    this.startTime = Date.now();
    this.paused = false;
    this.pauseStart = 0;
    this.timeLimit = this.currentSet.timeLimit;
    this.passScore = this.currentSet.passScore;
  }

  pause() {
    if (this.paused || !this.currentSet) return;
    this.paused = true;
    this.pauseStart = Date.now();
  }

  resume() {
    if (!this.paused) return;
    this.startTime += Date.now() - this.pauseStart;
    this.paused = false;
    this.pauseStart = 0;
  }

  getCurrentQuestion() {
    if (!this.currentSet) return null;
    return this.currentSet.questions[this.currentQuestionIndex] || null;
  }

  answer(questionIndex, answerIndex) {
    const q = this.currentSet.questions[questionIndex];
    if (!q) return null;
    const correct = answerIndex === q.answer;
    this.answers.push({
      questionId: q.id,
      answer: answerIndex,
      correct,
    });
    if (correct) {
      this.correctCount++;
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score = Math.min(100, Math.round((this.correctCount / this.currentSet.questions.length) * 100));
    } else {
      this.wrongCount++;
      this.combo = 0;
    }
    return {
      correct,
      correctAnswer: q.answer,
      explanation: q.explanation,
      explanationImage: q.explanationImage,
    };
  }

  nextQuestion() {
    this.currentQuestionIndex++;
    return this.getCurrentQuestion();
  }

  isFinished() {
    return this.currentQuestionIndex >= this.currentSet.questions.length;
  }

  getResults() {
    this.endTime = Date.now();
    const total = this.currentSet.questions.length;
    const elapsed = Math.floor((this.endTime - this.startTime) / 1000);
    return {
      score: this.score,
      correct: this.correctCount,
      wrong: this.wrongCount,
      total,
      maxCombo: this.maxCombo,
      elapsed,
      passed: this.score >= this.passScore,
      passScore: this.passScore,
      timeLimit: this.timeLimit,
    };
  }

  getRemainingTime() {
    if (!this.timeLimit) return 0;
    const now = this.paused ? this.pauseStart : Date.now();
    const elapsed = Math.floor((now - this.startTime) / 1000);
    return Math.max(0, this.timeLimit - elapsed);
  }

  elapsedSec() {
    const now = this.paused ? this.pauseStart : Date.now();
    return Math.max(0, Math.floor((now - this.startTime) / 1000));
  }

  // Snapshot for interrupted runs (retire / relaunch). The full set is
  // embedded so resume works offline and for imported bundles.
  snapshot() {
    if (!this.currentSet) return null;
    return {
      v: 1,
      set: this.currentSet,
      index: this.currentQuestionIndex,
      answers: this.answers,
      score: this.score,
      correct: this.correctCount,
      wrong: this.wrongCount,
      maxCombo: this.maxCombo,
      elapsed: this.elapsedSec(),
      timeLimit: this.timeLimit,
      passScore: this.passScore,
      at: Date.now(),
    };
  }

  restore(snap) {
    if (!snap || snap.v !== 1 || !snap.set || !Array.isArray(snap.set.questions)) {
      throw new Error('bad snapshot');
    }
    const set = this.addBundle(snap.set, snap.set.title || '');
    this.currentSet = set;
    this.currentQuestionIndex = Math.min(snap.index | 0, set.questions.length);
    this.answers = Array.isArray(snap.answers) ? snap.answers : [];
    this.score = snap.score | 0;
    this.correctCount = snap.correct | 0;
    this.wrongCount = snap.wrong | 0;
    this.maxCombo = snap.maxCombo | 0;
    this.timeLimit = snap.timeLimit | 0;
    this.passScore = snap.passScore | 0;
    this.startTime = Date.now() - (snap.elapsed | 0) * 1000;
    this.paused = false;
    this.pauseStart = 0;
    return set;
  }
}
