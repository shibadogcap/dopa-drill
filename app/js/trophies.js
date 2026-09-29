// Trophies: achievements for the quiz app.
// Simple implementation that tracks milestones and unlocks.

export const CATS = ['つづける', 'たくさん', 'せいかく', 'コンボ', 'ひみつ'];

const fmt = (n) => (n >= 10000 && n % 10000 === 0 ? `${n / 10000}万` : n.toLocaleString('ja-JP'));
const RANKS = ['bronze', 'silver', 'gold', 'rainbow'];
export const RANK_NAME = { bronze: 'どう', silver: 'ぎん', gold: 'きん', rainbow: 'にじ', secret: 'ひみつ' };

function rankAt(i, n) {
  if (n === 1) return 'gold';
  if (i === n - 1) return 'rainbow';
  return RANKS[Math.min(2, Math.floor((i / (n - 1)) * 3.3))];
}

const SERIES_DEFS = [
  { key: 'streak', cat: 'つづける', title: 'れんぞくで あそぶ', metric: 'bestStreak', steps: [3, 5, 7, 10, 14, 21, 30, 50, 75, 100], name: (v) => `${v}日 れんぞく`, desc: (v) => `${v}日 つづけて あそぶ` },
  { key: 'days', cat: 'つづける', title: 'あそんだ日', metric: 'days', steps: [1, 3, 5, 7, 10, 15, 20, 30, 50, 75, 100], name: (v) => `あそんだ日 ${fmt(v)}日`, desc: (v) => `あそんだ日が ぜんぶで ${fmt(v)}日` },
  { key: 'questions', cat: 'たくさん', title: 'といた もんだい', metric: 'questions', steps: [10, 30, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000], name: (v) => `${fmt(v)}もん とく`, desc: (v) => `もんだいを ぜんぶで ${fmt(v)}もん とく` },
  { key: 'perfect', cat: 'せいかく', title: 'パーフェクト', metric: 'perfects', steps: [1, 3, 5, 10, 20, 50, 100], name: (v) => `パーフェクト ${v}かい`, desc: (v) => `まちがえなしで ${v}かい クリア` },
  { key: 'combo', cat: 'コンボ', title: 'コンボ', metric: 'maxCombo', steps: [10, 20, 30, 50, 75, 100, 150, 200, 300, 500], name: (v) => `${v}コンボ`, desc: (v) => `${v}コンボ たてる` },
  { key: 'score', cat: 'せいかく', title: 'スコア', metric: 'bestScore', steps: [50, 60, 70, 80, 85, 90, 95, 100], name: (v) => `スコア ${v}てん`, desc: (v) => `スコア ${v}てん たてる` },
];

export const TROPHIES = [];
for (const def of SERIES_DEFS) {
  def.steps.forEach((v, i) => {
    TROPHIES.push({
      id: `${def.key}-${v}`,
      cat: def.cat,
      series: def.title,
      name: def.name(v),
      desc: def.desc(v),
      metric: def.metric,
      value: v,
      rank: rankAt(i, def.steps.length),
      icon: `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" stroke-width="3"/><text x="20" y="26" text-anchor="middle" font-size="14" font-weight="900" fill="currentColor">${v}</text></svg>`,
    });
  });
}

export function checkTrophies(state, results) {
  const got = [];
  const stats = state.stats || {};
  
  for (const t of TROPHIES) {
    if (state.trophies?.includes(t.id)) continue;
    
    let value = 0;
    if (t.metric === 'bestStreak') value = stats.bestStreak || 0;
    else if (t.metric === 'days') value = stats.days || 0;
    else if (t.metric === 'questions') value = stats.questions || 0;
    else if (t.metric === 'perfects') value = stats.perfects || 0;
    else if (t.metric === 'maxCombo') value = results.maxCombo || 0;
    else if (t.metric === 'bestScore') value = Math.max(stats.bestScore || 0, results.score);
    
    if (value >= t.value) {
      got.push(t);
    }
  }
  
  return got;
}

export function trophyState() {
  const st = JSON.parse(localStorage.getItem('dopa-drill:v1') || '{}');
  return { got: st.trophies || [] };
}
