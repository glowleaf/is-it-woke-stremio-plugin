'use strict';
// Seed the Games category. Wokeometer scores games (media_type 'game', keyed by Steam app id, 0-10),
// which is the only scorer in the set that covers them, so games carry one source each and say so.
//
//   node tools/seed_games.js [out.json]
//
// The list is written by hand because games are not in any of the film/TV indexes we crawl; each
// entry is matched against the site's own search and only kept when the title, year and media type
// agree, so nothing is guessed.
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.resolve(process.argv[2] || path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'games.json'));
const API = 'https://wokeometer.app/api/search?q=';

// A spread across the spectrum, not a list of favourites: consensus-woke, consensus-not, and the
// flashpoints where the argument actually happened.
const GAMES = [
  ['The Last of Us Part II', 2020],
  ["Baldur's Gate 3", 2023],
  ['Dragon Age: The Veilguard', 2024],
  ['Starfield', 2023],
  ['Hogwarts Legacy', 2023],
  ['Dustborn', 2024],
  ['Concord', 2024],
  ['Stellar Blade', 2024],
  ['Black Myth: Wukong', 2024],
  ['Kingdom Come: Deliverance II', 2025],
  ['Cyberpunk 2077', 2020],
  ['God of War Ragnarök', 2022],
  ['Elden Ring', 2022],
  ['Red Dead Redemption 2', 2018],
  ['The Witcher 3: Wild Hunt', 2015],
  ['Mass Effect Legendary Edition', 2021],
  ["Marvel's Spider-Man 2", 2023],
  ['Assassin\u2019s Creed Shadows', 2025],
  ['Avowed', 2025],
  ['Indiana Jones and the Great Circle', 2024],
  ['Grand Theft Auto V', 2013],
  ['Life is Strange: Double Exposure', 2024],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

(async () => {
  const out = [];
  for (const [name, year] of GAMES) {
    let rows = [];
    try {
      const res = await fetch(API + encodeURIComponent(name), { headers: { 'user-agent': 'Mozilla/5.0 Chrome/154' } });
      const data = await res.json();
      rows = Array.isArray(data.results) ? data.results : [];
    } catch (e) {
      console.log(`  ${name}: search failed ${e.message.slice(0, 40)}`);
      await sleep(1200);
      continue;
    }
    const games = rows.filter((r) => r.media_type === 'game' && typeof r.woke_score === 'number');
    const hit =
      games.find((r) => norm(r.title) === norm(name) && String(r.release_date || '').slice(0, 4) === String(year)) ||
      games.find((r) => norm(r.title) === norm(name)) ||
      games.find((r) => norm(r.title).includes(norm(name)) && String(r.release_date || '').slice(0, 4) === String(year));
    if (!hit) {
      console.log(`  ${name} (${year}): not on the source`);
      await sleep(1200);
      continue;
    }
    out.push({
      tt: `game-${hit.external_id}`,
      type: 'game',
      name: hit.title,
      year: hit.release_date ? Number(String(hit.release_date).slice(0, 4)) : year,
      steam: String(hit.external_id),
      wokeometer: Math.max(0, Math.min(100, Math.round(hit.woke_score * 10))),
      details: {},
    });
    console.log(`  ${hit.title} (${String(hit.release_date || '').slice(0, 4)}): ${hit.woke_score}/10`);
    await sleep(1200);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`written ${out.length} games -> ${OUT}`);
})();
