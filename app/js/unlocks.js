// Unlockable show (id041): backgrounds, correct marks, particles, music,
// Dopakichi's costume and colour, the crowd and the finale. Each item is the
// reward of one trophy (never random), so what is unlocked follows from the
// trophies earned; only the player's choice per category is saved.
import { TROPHIES } from './trophies.js';

export const CATS = [
  { key: 'bg', name: 'はいけい' },
  { key: 'mark', name: 'せいかいの しるし' },
  { key: 'particle', name: 'かみふぶき' },
  { key: 'music', name: 'おんがく' },
  { key: 'costume', name: 'きせかえ' },
  { key: 'color', name: 'ドパキチの いろ' },
  { key: 'crowd', name: 'おきゃくさん' },
  { key: 'finale', name: 'フィナーレ' },
];

// base: available from the start. trophy: the trophy whose reward it is.
export const ITEMS = [];
export const ITEM = {};
export function addItems(list) {
  for (const it of list) {
    ITEMS.push(it); ITEM[it.id] = it;
    if (it.trophy) { const t = TROPHIES.find((x) => x.id === it.trophy); if (t) t.reward = it.id; }
  }
}
addItems([
  { id: 'bg:classic', cat: 'bg', name: 'ほうしゃせん', base: true },
  { id: 'mark:hanamaru', cat: 'mark', name: 'はなまる', base: true },
  { id: 'particle:classic', cat: 'particle', name: 'かみふぶき', base: true },
  { id: 'music:classic', cat: 'music', name: 'マリンバ マーチ', base: true },
  { id: 'costume:none', cat: 'costume', name: 'なし', base: true },
  { id: 'color:pink', cat: 'color', name: 'ピンク', base: true },
  { id: 'crowd:classic', cat: 'crowd', name: 'いろちがい', base: true },
  { id: 'finale:classic', cat: 'finale', name: 'きょだい ドパキチ', base: true },
]);
// id041: one sample per category, to prove the pipeline end to end.
// Rewards follow effort and coming back (plays, days, streaks, stars earned by
// practice), not the placement check, which can master many skills at once.
addItems([
  { id: 'costume:cap', cat: 'costume', name: 'ぼうし', trophy: 'days-1' },
  { id: 'particle:note', cat: 'particle', name: 'おんぷ', trophy: 'days-3' },
  { id: 'mark:stamp', cat: 'mark', name: 'せいかいスタンプ', trophy: 'questions-30' },
  { id: 'bg:night', cat: 'bg', name: 'よぞら', trophy: 'streak-3' },
  { id: 'color:blue', cat: 'color', name: 'あお', trophy: 'questions-50' },
  { id: 'finale:fireworks', cat: 'finale', name: 'はなびたいかい', trophy: 'score-85' },
  { id: 'music:chip', cat: 'music', name: '8ビット', trophy: 'questions-100' },
  { id: 'crowd:costume', cat: 'crowd', name: 'きせかえ おきゃくさん', trophy: 'combo-20' },
]);
// id042: backgrounds, correct marks and particles.
addItems([
  { id: 'bg:sea', cat: 'bg', name: 'うみと あわ', trophy: 'questions-200' },
  { id: 'bg:festival', cat: 'bg', name: 'おまつり', trophy: 'days-10' },
  { id: 'bg:paper', cat: 'bg', name: 'かみの こうさく', trophy: 'questions-500' },
  { id: 'bg:space', cat: 'bg', name: 'うちゅう', trophy: 'score-90' },
  { id: 'mark:medal', cat: 'mark', name: 'メダル', trophy: 'streak-7' },
  { id: 'mark:crown', cat: 'mark', name: 'おうかん', trophy: 'perfect-3' },
  { id: 'mark:ring', cat: 'mark', name: 'はなびの わ', trophy: 'combo-50' },
  { id: 'particle:petal', cat: 'particle', name: 'はなびら', trophy: 'days-7' },
  { id: 'particle:digit', cat: 'particle', name: 'すうじ', trophy: 'questions-1000' },
  { id: 'particle:bubble', cat: 'particle', name: 'あわ', trophy: 'questions-300' },
  { id: 'particle:candy', cat: 'particle', name: 'おかし', trophy: 'score-95' },
]);
// id043: songs (8ビット is the id041 sample).
addItems([
  { id: 'music:matsuri', cat: 'music', name: 'おまつり ばやし', trophy: 'streak-5' },
  { id: 'music:brass', cat: 'music', name: 'ブラスバンド', trophy: 'days-5' },
  { id: 'music:electro', cat: 'music', name: 'エレクトロ', trophy: 'combo-30' },
]);
// id044: costumes, colours, crowd and finales (id045 moved three rewards to the new series).
addItems([
  { id: 'costume:hachimaki', cat: 'costume', name: 'はちまき', trophy: 'questions-50' },
  { id: 'costume:cape', cat: 'costume', name: 'マント', trophy: 'combo-20' },
  { id: 'costume:glasses', cat: 'costume', name: 'まるめがね', trophy: 'perfect-5' },
  { id: 'costume:ribbon', cat: 'costume', name: 'リボン', trophy: 'days-15' },
  { id: 'costume:crown', cat: 'costume', name: 'おうかん', trophy: 'streak-14' },
  { id: 'costume:wizard', cat: 'costume', name: 'まほうの ぼうし', trophy: 'perfect-10' },
  { id: 'costume:headphones', cat: 'costume', name: 'ヘッドホン', trophy: 'score-100' },
  { id: 'color:mint', cat: 'color', name: 'みどり', trophy: 'days-7' },
  { id: 'color:snow', cat: 'color', name: 'ゆきいろ', trophy: 'days-20' },
  { id: 'color:yellow', cat: 'color', name: 'きいろ', trophy: 'questions-750' },
  { id: 'color:violet', cat: 'color', name: 'むらさき', trophy: 'combo-100' },
  { id: 'color:gold', cat: 'color', name: 'きんいろ', trophy: 'streak-30' },
  { id: 'color:rainbow', cat: 'color', name: 'にじいろ', trophy: 'days-100' },
  { id: 'crowd:rainbow', cat: 'crowd', name: 'にじいろ おきゃくさん', trophy: 'days-30' },
  { id: 'crowd:twins', cat: 'crowd', name: 'おそろい おきゃくさん', trophy: 'perfect-20' },
  { id: 'finale:parade', cat: 'finale', name: 'パレード', trophy: 'streak-10' },
  { id: 'finale:rocket', cat: 'finale', name: 'ロケット', trophy: 'combo-75' },
]);

export const isUnlocked = (it, got = {}) => !!(it && (it.base || (it.trophy && got[it.trophy])));
export const unlockedIn = (cat, got) => ITEMS.filter((it) => it.cat === cat && isUnlocked(it, got));
export const defaultEquip = () => Object.fromEntries(CATS.map((c) => [c.key, 'auto']));

// The look for one play: fixed choices stay; "auto" picks among the unlocked
// ones so every play can look and sound a little different.
export function pickLook(equip = {}, got = {}, rng = Math.random) {
  const look = {};
  for (const { key } of CATS) {
    const want = equip[key];
    const own = unlockedIn(key, got);
    if (want && want !== 'auto' && own.some((it) => it.id === want)) look[key] = want;
    else look[key] = own[Math.floor(rng() * own.length)].id;
  }
  return look;
}
// The part after "cat:" (what the show modules switch on).
export const variant = (id) => (id ? id.split(':')[1] : 'classic');
