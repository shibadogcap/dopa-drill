// Quiz engine: loads question sets, manages game state, scoring, and progression.

export class QuizEngine {
  constructor() {
    // Base URL for question data. Same-origin 'questions/' is the fallback
    // (local dev / bundled data); set an http(s) URL to load from the web.
    this.base = 'questions/';
    this.sets = [];
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

  async loadSet(setId) {
    const res = await fetch(`${this.base}${setId}.json`);
    if (!res.ok) throw new Error(`Failed to load set ${setId}`);
    this.currentSet = await res.json();
    this.currentQuestionIndex = 0;
    this.score = 0;
    this.correctCount = 0;
    this.wrongCount = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.answers = [];
    this.startTime = Date.now();
    this.timeLimit = this.currentSet.timeLimit;
    this.passScore = this.currentSet.passScore;
    return this.currentSet;
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
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    return Math.max(0, this.timeLimit - elapsed);
  }
}
