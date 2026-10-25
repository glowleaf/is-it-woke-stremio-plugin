<?php
/**
 * MetaWokeCritic — PHP + SQLite front end.
 *
 * Renders from data/site.db (written by tools/build_site_db.js) and caches each URL as a static HTML
 * fragment in data/cache. The cache is invalidated whenever the database is rebuilt: the build stamp
 * is part of the cache key, so a new build is live on the next request without clearing anything.
 */
declare(strict_types=1);

const APP_NAME = 'MetaWokeCritic';
const INSTALL = 'https://metawokecritic.com/install';
const CACHE_TTL = 600;                       // seconds a rendered page stays warm
const PER_PAGE = 48;

$root = dirname(__DIR__);
$dbPath = getenv('SITE_DB') ?: $root . '/data/site.db';
$cacheDir = getenv('SITE_CACHE') ?: $root . '/data/cache';

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$uri = rtrim($uri, '/') ?: '/';

/* ---------------------------------------------------------------- cache ---- */
@mkdir($cacheDir, 0775, true);
$pdo = null;
function db(): PDO {
    global $pdo, $dbPath;
    if ($pdo === null) {
        $pdo = new PDO('sqlite:' . $dbPath, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec('PRAGMA query_only = ON');
    }
    return $pdo;
}

$built = '0';
try { $built = (string) db()->query("select value from meta where key='built_at'")->fetchColumn(); } catch (Throwable $e) {}
$cacheFile = $cacheDir . '/' . $built . '-' . md5($uri) . '.html';
if (is_file($cacheFile) && (time() - filemtime($cacheFile)) < CACHE_TTL) {
    header('Content-Type: text/html; charset=utf-8');
    header('X-Cache: hit');
    header('Cache-Control: public, max-age=300');
    readfile($cacheFile);
    exit;
}
ob_start();

/* -------------------------------------------------------------- helpers ---- */
function h(?string $s): string { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); }

function slugish(string $s): string {
    $s = strtolower(trim($s));
    $s = strtr($s, ['á'=>'a','à'=>'a','ä'=>'a','é'=>'e','è'=>'e','ê'=>'e','í'=>'i','ó'=>'o','ö'=>'o','ú'=>'u','ñ'=>'n','’'=>"", "'"=>"", '&'=>'and']);
    $s = preg_replace('/[^a-z0-9]+/', '-', $s) ?? '';
    return trim($s, '-');
}

function source_url(string $key, array $t): string {
    $name = rawurlencode($t['name']);
    $slug = slugish($t['name']);
    $yr = $t['year'] ? '-' . (int) $t['year'] : '';
    switch ($key) {
        case 'iiwon': return "https://isitwokeornot.com/search?q={$name}";
        case 'iio': return $t['tmdb']
            ? 'https://isitwoke.io/' . ($t['type'] === 'series' ? 'tv' : 'movie') . '/' . (int) $t['tmdb']
            : "https://isitwoke.io/search?q={$name}";
        case 'wokeometer': return "https://wokeometer.app/search?q={$name}";
        case 'wokealyzer': return 'https://wokealyzer.com/movie/' . rawurlencode($t['tt']);
        case 'wokemovie': return 'https://wokemoviescore.com/movie/' . $slug . $yr . '/';
        case 'wokenessratings': return 'https://wokenessratings.com/media/' . $slug . $yr . '-' . ($t['type'] === 'series' ? 'series' : 'movie');
        case 'virtuevigil': return 'https://virtuevigil.com/reviews/' . $slug . $yr . '/';
    }
    return '#';
}

const SOURCE_LABEL = [
    'iiwon' => ['Is It Woke or Not?', 'Human editorial score', ['movie', 'series']],
    'iio' => ['Is it Woke (isitwoke.io)', 'AI verdict and score', ['movie', 'series']],
    'wokeometer' => ['Wokeometer', 'AI score, 0 to 10', ['movie', 'series', 'game']],
    'wokealyzer' => ['Wokealyzer', 'AI score with a 5-part rubric', ['movie', 'series']],
    'wokemovie' => ['Woke Movie Score', 'AI score plus ten markers', ['movie']],
    'wokenessratings' => ['Wokeness Ratings', 'wokeness, feminism, chick flick', ['movie', 'series']],
    'virtuevigil' => ['Virtue Vigil', 'woke score out of 50', ['movie']],
];
const THEME_LABEL = [
    'lgbtq' => 'LGBT Themes',
    'feminism' => 'Feminism',
    'identityPolitics' => 'Identity Politics',
    'oikophobia' => 'Anti-Western / Oikophobia',
    'antiTheism' => 'Anti-Theism',
];

/* ---------------------------------------------------------------- layout ---- */
function page(string $title, string $desc, string $body, string $canonical): string {
    $nav = '<a href="/movies">Movies</a><a href="/series">Series</a><a href="/games">Games</a>'
         . '<a href="/methodology">Methodology</a><a href="' . INSTALL . '">Install in Stremio</a>';
    $install = '<a class="cta" href="' . INSTALL . '">Install in Stremio</a>';
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>' . h($title) . ' | ' . APP_NAME . '</title>'
        . '<meta name="description" content="' . h($desc) . '">'
        . '<link rel="canonical" href="' . h($canonical) . '">'
        . '<meta property="og:title" content="' . h($title) . '">'
        . '<meta property="og:description" content="' . h($desc) . '">'
        . '<link rel="stylesheet" href="/style.css"></head><body><div class="wrap">'
        . '<header class="site"><a class="logo" href="/"><span>Meta</span>WokeCritic</a><nav>' . $nav . '</nav></header>'
        . $body
        . '<footer><p>Aggregated from published scorers; the theme analysis, the summaries and the script analysis are ours. '
        . '<a href="/methodology">Methodology</a>.</p></footer></div></body></html>';
}

function card(array $t): string {
    $cats = json_decode($t['themes'] ?? '{}', true) ?: [];
    $chips = '';
    if (!empty($cats['cats'])) {
        $sorted = $cats['cats'];
        arsort($sorted);
        foreach (array_slice($sorted, 0, 3, true) as $k => $v) {
            $chips .= '<span class="pchip">' . h(explode(' /', THEME_LABEL[$k] ?? $k)[0]) . ' ' . (int) $v . '/10</span>';
        }
    }
    return '<a class="pcard" href="/t/' . h($t['tt']) . '"><div class="thumb">'
        . ($t['poster'] ? '<img src="/' . h($t['poster']) . '" loading="lazy" alt="' . h($t['name']) . '">' : '')
        . '<span class="badge" style="color:' . h($t['colour']) . '">' . (int) $t['score'] . '</span></div>'
        . '<div class="pbody"><div class="pname">' . h($t['name']) . '</div>'
        . '<div class="pmeta">' . ($t['year'] ? (int) $t['year'] . ' · ' : '') . h($t['band']) . '</div>'
        . ($chips ? '<div class="pchips">' . $chips . '</div>' : '') . '</div></a>';
}

function grid(array $rows): string {
    if (!$rows) return '<p class="note">Nothing here yet.</p>';
    return '<div class="grid">' . implode('', array_map('card', $rows)) . '</div>';
}

/* ----------------------------------------------------------------- route ---- */
$type = null;
$listTitle = null;
if ($uri === '/') {
    $rows = db()->query('select * from titles order by score desc, popularity desc limit 24')->fetchAll();
    $counts = ['movie' => 0, 'series' => 0, 'game' => 0];
    foreach (db()->query('select type, count(*) c from titles group by type') as $r) $counts[$r['type']] = (int) $r['c'];
    $body = '<h1><span>Meta</span>WokeCritic</h1>'
        . '<p class="meta">One number per title, from scorers that work independently, plus the themes behind it.</p>'
        . '<a class="cta" href="' . INSTALL . '">Install in Stremio</a>'
        . '<div class="catbar"><a href="/movies">Movies<b>' . $counts['movie'] . '</b></a>'
        . '<a href="/series">Series<b>' . $counts['series'] . '</b></a>'
        . '<a href="/games">Games<b>' . $counts['game'] . '</b></a></div>'
        . '<h2>Highest scores</h2>' . grid($rows);
    $out = page('Aggregated woke scores for films, TV and games',
        'Woke scores from independent scorers combined into one number per title, with themes, summaries and script analysis.',
        $body, 'https://metawokecritic.com/');
} elseif (in_array($uri, ['/movies', '/series', '/games'], true)) {
    $type = ['/movies' => 'movie', '/series' => 'series', '/games' => 'game'][$uri];
    $listTitle = ['movie' => 'Movies', 'series' => 'Series', 'game' => 'Games'][$type];
    $pageNo = max(1, (int) ($_GET['p'] ?? 1));
    $stmt = db()->prepare('select * from titles where type = ? order by score desc, popularity desc limit ? offset ?');
    $stmt->execute([$type, PER_PAGE, ($pageNo - 1) * PER_PAGE]);
    $rows = $stmt->fetchAll();
    $total = (int) db()->query("select count(*) from titles where type = '" . $type . "'")->fetchColumn();
    $pager = '';
    if ($total > PER_PAGE) {
        $pages = (int) ceil($total / PER_PAGE);
        $links = [];
        for ($i = 1; $i <= $pages; $i++) {
            $links[] = $i === $pageNo ? '<b>' . $i . '</b>' : '<a href="?p=' . $i . '">' . $i . '</a>';
        }
        $pager = '<p class="pager">' . implode(' ', array_slice($links, max(0, $pageNo - 4), 9)) . '</p>';
    }
    $body = '<h1>' . h($listTitle) . '</h1><p class="meta">' . $total . ' titles, highest score first.</p>'
        . ($type === 'game' ? '' : '<a class="cta" href="' . INSTALL . '">Install in Stremio</a>')
        . grid($rows) . $pager;
    $out = page($listTitle . ' ranked by woke score', $listTitle . ' with an aggregated woke score.', $body,
        'https://metawokecritic.com' . $uri);
} elseif (preg_match('#^/t/([A-Za-z0-9_-]+)$#', $uri, $m)) {
    $stmt = db()->prepare('select * from titles where tt = ?');
    $stmt->execute([$m[1]]);
    $t = $stmt->fetch();
    if (!$t) { http_response_code(404); $out = page('Not found', 'No such title.', '<h1>Not found</h1><p class="note"><a href="/">Back to the index</a>.</p>', 'https://metawokecritic.com/'); }
    else {
        $scores = json_decode($t['scores'] ?? '{}', true) ?: [];
        $themes = json_decode($t['themes'] ?? '{}', true) ?: [];
        $script = $t['script'] ? json_decode($t['script'], true) : null;
        $isGame = $t['type'] === 'game';

        $hero = '<div class="hero">';
        if ($t['poster']) $hero .= '<div class="art"><img src="/' . h($t['poster']) . '" alt="' . h($t['name']) . ' poster"></div>';
        $hero .= '<div class="heroText">';
        if ($t['verdict']) $hero .= '<p class="verdict" style="border-color:' . h($t['colour']) . '">' . h($t['verdict']) . '</p>';
        $hero .= '<div class="score"><div class="num" style="color:' . h($t['colour']) . '">' . (int) $t['score'] . '</div>'
              . '<div><div class="band" style="color:' . h($t['colour']) . '">' . h($t['band']) . '</div>'
              . '<div class="sub">' . ($t['n'] > 1
                    ? 'weighted average of ' . (int) $t['n'] . ' scorers, ' . (int) $t['spread'] . ' point spread'
                    : 'scored by <a href="' . h(source_url((string) $t['single_source'], $t)) . '" rel="nofollow noopener" target="_blank">'
                      . h(SOURCE_LABEL[$t['single_source']][0] ?? 'one source') . '</a>') . '</div></div></div>';
        $hero .= '</div></div>';

        $body = '<h1>' . h($t['name']) . ($t['year'] ? ' (' . (int) $t['year'] . ')' : '') . ' woke score</h1>'
              . '<p class="meta">' . ($t['type'] === 'series' ? 'TV series' : ($isGame ? 'Game' : 'Film')) . '</p>'
              . $hero
              . ($isGame ? '' : '<p><a class="cta" href="' . INSTALL . '">Get this on every title in Stremio</a></p>');

        if ($t['summary']) {
            $body .= '<h2>What is woke about it</h2><div class="aiwoke">' . h($t['summary'])
                   . '<span class="ainote">Our analysis, written from the synopsis and the published scores</span></div>';
        }
        if ($script && !empty($script['analysis'])) {
            $body .= '<h2>Script analysis <span class="tag">screenplay</span></h2>';
            if (!empty($script['verdict'])) $body .= '<p class="verdict" style="border-color:#7b5cff">' . h($script['verdict']) . '</p>';
            $body .= '<div class="aiwoke">' . h($script['analysis'])
                   . '<span class="ainote">Read from the screenplay itself'
                   . (!empty($script['scriptWords']) ? ' (' . number_format((int) $script['scriptWords']) . ' words sampled)' : '')
                   . '</span></div>';
            if (!empty($script['evidence'])) {
                $body .= '<ul class="flags">';
                foreach (array_slice($script['evidence'], 0, 3) as $e) $body .= '<li>' . h($e) . '</li>';
                $body .= '</ul>';
            }
        }

        // theme table: rubric categories plus the AI judgement on the two derived ones
        $ai = $themes['ai'] ?? null;
        $cats = $themes['cats'] ?? [];
        $rows = '';
        if ($cats) {
            arsort($cats);
            foreach ($cats as $k => $v) {
                $pct = (int) round($v * 10);
                $col = $pct <= 19 ? '#22c55e' : ($pct <= 39 ? '#84cc16' : ($pct <= 59 ? '#f59e0b' : ($pct <= 79 ? '#f97316' : '#ef4444')));
                $rows .= '<tr><td>' . h(THEME_LABEL[$k] ?? $k) . '</td><td class="n" style="color:' . $col . '">' . $pct . '</td>'
                       . '<td style="width:46%"><div class="bar"><span style="width:' . $pct . '%;background:' . $col . '"></span></div></td>'
                       . '<td class="note">Wokealyzer ' . h((string) $v) . '/10</td></tr>';
            }
        }
        foreach ([['Bossbabes', 'bossbabes'], ['Emasculation', 'emasculation']] as [$label, $key]) {
            $val = is_array($ai) && isset($ai[$key]) ? (int) $ai[$key] : null;
            if ($val === null) continue;
            $col = $val <= 19 ? '#22c55e' : ($val <= 39 ? '#84cc16' : ($val <= 59 ? '#f59e0b' : ($val <= 79 ? '#f97316' : '#ef4444')));
            $rows .= '<tr><td>' . $label . ' <span class="tag">AI</span></td><td class="n" style="color:' . $col . '">' . $val . '</td>'
                   . '<td style="width:46%"><div class="bar"><span style="width:' . $val . '%;background:' . $col . '"></span></div></td>'
                   . '<td class="note">judged by AI from the synopsis and the notes</td></tr>';
        }
        if ($rows) {
            $body .= '<h2>Theme scores</h2><table><thead><tr><th>Theme</th><th>0 to 100</th><th></th><th>Carried by</th></tr></thead><tbody>'
                   . $rows . '</tbody></table>';
        }

        // bottom line
        $drivers = [];
        if ($cats) { $c = $cats; arsort($c); foreach (array_slice($c, 0, 2, true) as $k => $v) $drivers[] = (THEME_LABEL[$k] ?? $k) . ' (' . (int) round($v * 10) . ')'; }
        if (is_array($ai)) {
            if (($ai['bossbabes'] ?? 0) >= 60) $drivers[] = 'Bossbabes (' . (int) $ai['bossbabes'] . ')';
            if (($ai['emasculation'] ?? 0) >= 60) $drivers[] = 'Emasculation (' . (int) $ai['emasculation'] . ')';
        }
        $body .= '<h2>Bottom line</h2><p><b>' . (int) $t['score'] . '/100, ' . h(strtolower($t['band'])) . '.</b> '
               . ($drivers ? 'Main drivers: ' . h(implode(', ', $drivers)) . '. ' : '')
               . 'Averaged from ' . (int) $t['n'] . ' scorers' . ($t['n'] > 1 ? ', who differ by ' . (int) $t['spread'] . ' points' : '') . '.</p>';

        // source table
        $srows = '';
        foreach (SOURCE_LABEL as $key => [$label, $kind, $types]) {
            if (!in_array($t['type'], $types, true)) continue;
            $v = $scores[$key] ?? null;
            if ($v === null) {
                $srows .= '<tr><td>' . h($label) . '<div class="note">' . h($kind) . '</div></td><td class="n" colspan="3" style="color:var(--mut)">not scored</td></tr>';
                continue;
            }
            $band = $v <= 19 ? ['Absolute Cinema', '#22c55e'] : ($v <= 39 ? ['Very Little Woke', '#84cc16'] : ($v <= 59 ? ['Slightly Woke', '#f59e0b'] : ($v <= 79 ? ['Very Woke', '#f97316'] : ['Certified Woke', '#ef4444'])));
            $srows .= '<tr><td><a href="' . h(source_url($key, $t)) . '" rel="nofollow noopener" target="_blank">' . h($label) . '</a>'
                    . '<div class="note">' . h($kind) . '</div></td>'
                    . '<td class="n" style="color:' . $band[1] . '">' . (int) $v . '</td>'
                    . '<td style="width:40%"><div class="bar"><span style="width:' . (int) $v . '%;background:' . $band[1] . '"></span></div></td>'
                    . '<td class="n" style="color:' . $band[1] . ';font-weight:600">' . h($band[0]) . '</td></tr>';
        }
        $body .= '<h2>Where the number comes from</h2><p class="note">Each score below is published by that site. The weighting, the theme analysis and the summary are ours.</p>'
               . '<table><thead><tr><th>Source</th><th>Score</th><th></th><th>Band</th></tr></thead><tbody>' . $srows . '</tbody></table>';

        if (!$isGame) {
            $body .= '<h2>See it inside Stremio</h2><p>The aggregate, each source and these theme scores on the movie or series page: chips on desktop, the first line of the description on phones and TVs, and an entry at the top of the sources list.</p>'
                   . '<a class="cta" href="' . INSTALL . '">Install the Stremio addon</a>';
        }
        $out = page($t['name'] . ($t['year'] ? ' (' . (int) $t['year'] . ')' : '') . ' woke score',
            $t['name'] . ' scores ' . (int) $t['score'] . ' out of 100 on woke score.',
            '<article>' . $body . '</article>', 'https://metawokecritic.com' . $uri);
    }
} elseif ($uri === '/methodology') {
    $body = '<h1>Methodology</h1>'
        . '<p>Independent scorers disagree, sometimes by 60 points on the same film. This index keeps every score visible, adds one weighted average, and writes the analysis the individual scorers do not.</p>'
        . '<h2>Normalisation</h2><p>Sources publishing 0 to 10 are multiplied by ten; Woke Movie Score publishes 0 to 100; Virtue Vigil publishes out of 50 and is doubled. Nothing else is changed.</p>'
        . '<h2>Theme scores</h2><p>Five themes come from a published rubric rescaled to 0 to 100. Bossbabes and Emasculation are judged by AI from the synopsis and the scorers notes, because no source publishes those as fields.</p>'
        . '<h2>Script analysis</h2><p>Where a screenplay is available it is read directly: sampled scenes, quoted lines, and the two judgements made from the script rather than a blurb.</p>'
        . '<h2>Weights</h2><p>Across 22 films and series every scorer was compared with the others. Is It Woke or Not? is the only human editorial source, so it is the reference.</p>'
        . '<table><thead><tr><th>Pair</th><th>Titles</th><th>Avg gap</th><th>Rank correlation</th></tr></thead><tbody>'
        . '<tr><td>Wokealyzer vs Is It Woke or Not?</td><td class="n">11</td><td class="n">10.7</td><td class="n">0.90</td></tr>'
        . '<tr><td>Wokeometer vs Is It Woke or Not?</td><td class="n">11</td><td class="n">15.9</td><td class="n">0.66</td></tr>'
        . '<tr><td>isitwoke.io vs Is It Woke or Not?</td><td class="n">11</td><td class="n">19.0</td><td class="n">0.27</td></tr>'
        . '<tr><td>isitwoke.io vs Wokeometer</td><td class="n">22</td><td class="n">7.2</td><td class="n">0.67</td></tr></tbody></table>'
        . '<p>Wokealyzer reproduces the human ranking most closely, so it counts double.</p>';
    $out = page('Methodology', 'How the aggregate, the theme scores and the script analysis are produced.',
        $body, 'https://metawokecritic.com/methodology');
} elseif ($uri === '/sitemap.xml') {
    $urls = db()->query('select tt from titles')->fetchAll();
    $xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
    $xml .= '<url><loc>https://metawokecritic.com/</loc></url>';
    foreach (['movies', 'series', 'games', 'methodology'] as $p2) $xml .= '<url><loc>https://metawokecritic.com/' . $p2 . '</loc></url>';
    foreach ($urls as $u) $xml .= '<url><loc>https://metawokecritic.com/t/' . h($u['tt']) . '</loc></url>';
    $xml .= '</urlset>';
    header('Content-Type: application/xml; charset=utf-8');
    header('X-Cache: miss');
    @file_put_contents($cacheFile, $xml, LOCK_EX);
    echo $xml;
    exit;
} elseif ($uri === '/robots.txt') {
    header('Content-Type: text/plain; charset=utf-8');
    echo "User-agent: *
Allow: /
Sitemap: https://metawokecritic.com/sitemap.xml
";
    exit;
} else {
    http_response_code(404);
    $out = page('Not found', 'No such page.', '<h1>Not found</h1><p class="note"><a href="/">Back to the index</a>.</p>', 'https://metawokecritic.com/');
}

/* ------------------------------------------------------------- respond ---- */
$out = ob_get_clean() . $out;
@file_put_contents($cacheFile, $out, LOCK_EX);
header('Content-Type: text/html; charset=utf-8');
header('X-Cache: miss');
header('Cache-Control: public, max-age=300');
echo $out;
