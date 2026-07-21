/* ══════════════════════════════════════════════════════════════════════
   LOGIQUE APPLICATIVE — Tendances Scientifiques
   ══════════════════════════════════════════════════════════════════════
   Dépend de : config.js (CONFIG) et data_AccessAPI_Flask.js (PAYS_INFO,
   nomPays, fetchMois, fetchMotsCles, fetchPays, fetchEvolution,
   fetchArticlesTop, fetchSuggestions, fetchStatsGlobales).
   Ces deux fichiers doivent être chargés AVANT celui-ci dans index.html.

   ⚠ Contrairement à une version précédente qui reconstruisait un gros objet
   TD (toutes les données de tous les mois) une seule fois côté client à
   partir de fichiers JSON locaux, cette version appelle l'API Flask à la
   demande (par mois, par mot, par pays...). C'est plus léger et évite de
   dupliquer côté client la logique de pondération déjà faite par le
   backend (extraire_mots / référentiel de mots-clés).
   ══════════════════════════════════════════════════════════════════════ */

/* État global */
let MONTH_ORDER      = [];   // ["2025-02", "2025-03", ...] — rempli par fetchMois()
let STATS_GLOBALES   = { total_articles: 0, total_citations: 0, total_pays: 0, total_mois: 0 };
let ACTIVE_MONTH     = '';   // '' = "tous les mois" (comme /api/mots-cles sans paramètre)
let ACTIVE_COUNTRY   = null;
let EVO_WORD         = null;
let currentCloudMots = [];   // dernier tableau [{mot, poids}] chargé pour le mois actif
let currentEvoSerie  = [];   // dernier tableau [{mois, poids}] pour EVO_WORD
let CURRENT_ARTICLES = [];   // articles actuellement affichés — utilisé par l'export CSV

/* ══ Utilitaires ═══════════════════════════════════════════════════════ */

/** Emoji drapeau à partir d'un code alpha-2 (ex. "FR" -> 🇫🇷), sans avoir
 *  besoin d'une table de drapeaux : les "regional indicator symbols"
 *  Unicode se calculent directement à partir des lettres du code ISO. */
function flagEmoji(code) {
  if (!code || code.length !== 2) return '🌐';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
}

const MOIS_FR = ['Janv', 'Fév', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];

/** '2025-03' -> 'Mars 2025' (le backend renvoie les mois au format YYYY-MM). */
function formatMonthLabel(moisIso) {
  if (!moisIso) return moisIso;
  const [annee, m] = moisIso.split('-');
  const idx = parseInt(m, 10) - 1;
  if (!annee || Number.isNaN(idx) || idx < 0 || idx > 11) return moisIso;
  return `${MOIS_FR[idx]} ${annee}`;
}

/* ══ Particules (fond du hero) ═════════════════════════════════════════ */
(function () {
  const c = document.getElementById('starCanvas'); if (!c) return;
  const ctx = c.getContext('2d'); let P = [], W, H;
  function resize() {
    W = c.width = c.offsetWidth; H = c.height = c.offsetHeight;
    P = Array.from({ length: 30 }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.2 + .3, vx: (Math.random() - .5) * .12, vy: (Math.random() - .5) * .08,
      alpha: Math.random() * .28 + .08, phase: Math.random() * Math.PI * 2, speed: Math.random() * .012 + .004,
    }));
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    P.forEach((s) => {
      s.phase += s.speed; s.x += s.vx; s.y += s.vy;
      if (s.x < 0) s.x = W; if (s.x > W) s.x = 0; if (s.y < 0) s.y = H; if (s.y > H) s.y = 0;
      const a = s.alpha * (.55 + .45 * Math.sin(s.phase));
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180,140,60,${a})`; ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  window.addEventListener('resize', resize); resize(); draw();
})();
window.addEventListener('scroll', () => {
  document.getElementById('header').classList.toggle('scrolled', window.scrollY > 10);
}, { passive: true });

/* Scroll reveal */
const revObs = new IntersectionObserver((entries) => {
  entries.forEach((e, i) => {
    if (e.isIntersecting) {
      e.target.style.animationDelay = (i * 50) + 'ms';
      e.target.classList.add('visible'); revObs.unobserve(e.target);
    }
  });
}, { threshold: .07 });

/* Toast */
function toast(msg, d = 2400) {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), d);
}
// Alias : certaines parties du code appellent showToast(...)
function showToast(msg, d) { toast(msg, d); }

/* Compteur animé */
function animCount(el, v, d = 650) {
  if (!el) return;
  const s = performance.now();
  (function step(n) {
    const p = Math.min((n - s) / d, 1);
    el.textContent = Math.round(v * (1 - Math.pow(1 - p, 3))).toLocaleString('fr-FR');
    if (p < 1) requestAnimationFrame(step);
  })(performance.now());
}

/* Animer barres */
function animBars() {
  setTimeout(() => {
    document.querySelectorAll('.bar-fill').forEach((el) => {
      requestAnimationFrame(() => el.style.width = el.dataset.w + '%');
    });
  }, 60);
}

/* Navigation (single page — pas d'onglets) */
function showTab(name, btn) { /* single page — no-op */ }

/* ══ Bandeau de statistiques globales ═════════════════════════════════ */
function renderStatStrip() {
  const container = document.getElementById('statStrip');
  if (!container) return;
  const topKW = currentCloudMots[0]?.mot || '—';
  container.innerHTML = `
    <div class="stat-card"><div class="stat-label">Articles collectés</div>
      <div class="stat-val g" id="sc-tot">0</div><div class="stat-note">arXiv via OpenAlex</div></div>
    <div class="stat-card"><div class="stat-label">Mois couverts</div>
      <div class="stat-val">${STATS_GLOBALES.total_mois}</div></div>
    <div class="stat-card"><div class="stat-label">Pays représentés</div>
      <div class="stat-val">${STATS_GLOBALES.total_pays}</div></div>
    <div class="stat-card"><div class="stat-label">Mot top (${ACTIVE_MONTH ? formatMonthLabel(ACTIVE_MONTH) : 'tous les mois'})</div>
      <div class="stat-val" style="font-size:1rem;padding-top:3px;font-style:italic;">${topKW}</div></div>
  `;
  setTimeout(() => animCount(document.getElementById('sc-tot'), STATS_GLOBALES.total_articles), 80);
}

/* ══ Nuage de mots-clés ════════════════════════════════════════════════ */
async function renderCloud(mois) {
  const wrap = document.getElementById('cloudMain');
  if (!wrap) return;
  wrap.classList.add('fading');
  try {
    const data = await fetchMotsCles(mois);
    currentCloudMots = data.mots || [];
    setTimeout(() => {
      if (!currentCloudMots.length) {
        wrap.innerHTML = '<p style="color:var(--text-3);font-size:13px;">Aucune donnée.</p>';
        wrap.classList.remove('fading');
        return;
      }
      const maxF = currentCloudMots[0].poids;
      wrap.innerHTML = currentCloudMots.map(({ mot: w, poids: f }) => {
        const size = 11 + Math.round((f / maxF) * 20);
        const op = (.38 + (f / maxF) * .62).toFixed(2);
        const isEvo = w === EVO_WORD;
        return `<span class="cloud-word${isEvo ? ' selected' : ''}" style="font-size:${size}px;opacity:${op}"
          onclick="onCloudClick('${w.replace(/'/g, "\\'")}')" title="${w} : score ${Math.round(f)}">${w}</span>`;
      }).join('');
      wrap.classList.remove('fading');
    }, 180);
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p style="color:var(--text-3);font-size:13px;">Erreur de chargement du nuage.</p>';
    wrap.classList.remove('fading');
  }
}

function onCloudClick(word) {
  EVO_WORD = word;
  document.querySelectorAll('.cloud-word').forEach((el) => {
    el.classList.toggle('selected', el.textContent === word);
  });
  traceEvolution(word);
  const input = document.getElementById('evoInput');
  if (input) input.value = word;
  renderTopArticles(word);
  setTimeout(() => {
    const el = document.getElementById('topArticlesList');
    if (el) el.closest('.section-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 200);
  toast(`Évolution de "${word}" tracée — onglet Évolution`);
}

/* ══ Pastilles de mois ═════════════════════════════════════════════════ */
function initMonthPills() {
  const c = document.getElementById('monthPills');
  if (!c) return;
  c.innerHTML = '';

  const bTous = document.createElement('button');
  bTous.className = 'm-pill' + (ACTIVE_MONTH === '' ? ' active' : '');
  bTous.textContent = 'Tous les mois';
  bTous.onclick = () => setMonth('', -1);
  c.appendChild(bTous);

  MONTH_ORDER.forEach((m, i) => {
    const b = document.createElement('button');
    b.className = 'm-pill' + (m === ACTIVE_MONTH ? ' active' : '');
    b.textContent = formatMonthLabel(m);
    b.onclick = () => setMonth(m, i);
    c.appendChild(b);
  });
}

function setMonth(m, i) {
  ACTIVE_MONTH = m;
  document.querySelectorAll('.m-pill').forEach((b, j) => b.classList.toggle('active', j === i + 1));
  renderCloud(m).then(renderStatStrip);
  // Pas besoin de rappeler l'API d'évolution : seule la colonne "active" change.
  if (EVO_WORD) renderEvoChart();
}

/* ══ CARTE DU MONDE D3 ═════════════════════════════════════════════════ */
let mapInitialized = false;
let mapProjection, mapPath, mapG, mapZoom;
let countryMap = {};   // { code: { total, mots: [{mot, poids}] } } — depuis /api/pays
let NUM_TO_A2 = {};    // code numérique ISO (world-atlas) -> alpha-2, dérivé de PAYS_INFO

function construireNumToA2() {
  NUM_TO_A2 = {};
  Object.entries(PAYS_INFO).forEach(([a2, info]) => {
    if (info.numeric) NUM_TO_A2[String(Number(info.numeric))] = a2;
  });
}

async function loadPaysEtCarte() {
  try {
    const data = await fetchPays();
    countryMap = {};
    (data.pays || []).forEach((p) => { countryMap[p.code] = { total: p.total, mots: p.mots || [] }; });
    if (!ACTIVE_COUNTRY) {
      const premier = (data.pays || [])[0];
      if (premier) ACTIVE_COUNTRY = premier.code;
    }
  } catch (err) {
    console.error(err);
    toast('Impossible de charger la carte des pays');
  }
}

function renderMap() {
  if (mapInitialized) { updateMapBubbles(); return; }
  mapInitialized = true;

  const container = document.getElementById('mapContainer');
  if (!container) return;
  const W = container.clientWidth || 700;
  const H = Math.round(W * 0.52);

  const svg = d3.select('#worldMapSvg')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('width', W).attr('height', H);

  mapProjection = d3.geoNaturalEarth1().scale(W / 6.5).translate([W / 2, H / 2]);
  mapPath = d3.geoPath().projection(mapProjection);

  mapZoom = d3.zoom().scaleExtent([1, 8]).on('zoom', (event) => mapG.attr('transform', event.transform));
  svg.call(mapZoom);

  mapG = svg.append('g');

  mapG.append('rect').attr('width', W).attr('height', H).attr('fill', '#c8e6f5');

  const graticule = d3.geoGraticule().step([20, 20]);
  mapG.append('path').datum(graticule()).attr('d', mapPath)
    .attr('fill', 'none').attr('stroke', 'rgba(255,255,255,.25)').attr('stroke-width', .3);

  d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then((world) => {
    const countries = topojson.feature(world, world.objects.countries);

    const maxVol = Math.max(...Object.values(countryMap).map((c) => c.total), 1);
    const colorScale = d3.scaleSequential().domain([0, maxVol]).interpolator(d3.interpolate('#e8dcc8', '#c9963a'));

    mapG.selectAll('.country')
      .data(countries.features)
      .join('path')
      .attr('class', (d) => {
        const a2 = NUM_TO_A2[String(d.id)];
        return 'country' + (a2 && countryMap[a2] ? ' has-data' : '');
      })
      .attr('d', mapPath)
      .attr('fill', (d) => {
        const a2 = NUM_TO_A2[String(d.id)];
        if (!a2 || !countryMap[a2]) return '#e8dcc8';
        return colorScale(countryMap[a2].total);
      })
      .attr('stroke', '#c0aa88').attr('stroke-width', .3)
      .on('click', (event, d) => {
        const a2 = NUM_TO_A2[String(d.id)];
        if (a2 && countryMap[a2]) selectCountry(a2, event);
      })
      .on('mouseover', (event, d) => {
        const a2 = NUM_TO_A2[String(d.id)];
        if (!a2 || !countryMap[a2]) return;
        showMapTooltip(event, a2);
      })
      .on('mousemove', (event) => moveMapTooltip(event))
      .on('mouseleave', () => hideMapTooltip());

    mapG.append('path')
      .datum(topojson.mesh(world, world.objects.countries, (a, b) => a !== b))
      .attr('d', mapPath).attr('fill', 'none').attr('stroke', 'rgba(255,255,255,.55)').attr('stroke-width', .4);

    // Centroïdes calculés directement depuis la géométrie (pas de table statique
    // à maintenir) : on ne garde que les pays pour lesquels /api/pays a des données.
    mapG._features = countries.features;
    updateMapBubbles();
  }).catch((err) => {
    console.error('Erreur chargement carte:', err);
    const t = document.getElementById('sidebarTitle');
    if (t) t.textContent = 'Erreur chargement carte';
  });
}

function updateMapBubbles() {
  if (!mapG || !mapG._features) return;
  mapG.selectAll('.bubble-group').remove();

  const maxVol = Math.max(...Object.values(countryMap).map((c) => c.total), 1);

  const bubbleData = mapG._features
    .map((f) => {
      const a2 = NUM_TO_A2[String(f.id)];
      if (!a2 || !countryMap[a2]) return null;
      const centre = mapPath.centroid(f);
      if (!centre || Number.isNaN(centre[0])) return null;
      return { code: a2, vol: countryMap[a2].total, xy: centre };
    })
    .filter(Boolean);

  const rScale = d3.scaleSqrt().domain([0, maxVol]).range([4, 28]);

  const groups = mapG.selectAll('.bubble-group')
    .data(bubbleData, (d) => d.code)
    .join('g')
    .attr('class', 'bubble-group')
    .style('cursor', 'pointer');

  groups.append('circle')
    .attr('class', 'bubble')
    .attr('cx', (d) => d.xy[0]).attr('cy', (d) => d.xy[1])
    .attr('r', 0)
    .attr('fill', (d) => d.code === ACTIVE_COUNTRY ? 'rgba(201,150,58,.9)' : 'rgba(139,58,42,.72)')
    .attr('stroke', 'rgba(255,255,255,.7)').attr('stroke-width', 1.2)
    .transition().duration(600).ease(d3.easeCubicOut)
    .attr('r', (d) => rScale(d.vol));

  groups.append('text')
    .attr('class', 'bubble-label')
    .attr('x', (d) => d.xy[0]).attr('y', (d) => d.xy[1])
    .text((d) => rScale(d.vol) > 13 ? d.code : '')
    .attr('font-size', (d) => rScale(d.vol) > 18 ? '8' : '6')
    .attr('fill', '#fff').attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
    .attr('pointer-events', 'none');

  groups
    .on('mouseover', (event, d) => showMapTooltip(event, d.code))
    .on('mousemove', (event) => moveMapTooltip(event))
    .on('mouseleave', () => hideMapTooltip())
    .on('click', (event, d) => selectCountry(d.code, event));
}

function showMapTooltip(event, code) {
  const infos = countryMap[code] || { mots: [] };
  const top3 = infos.mots.slice(0, 4).map((m) => m.mot);
  const tt = document.getElementById('mapTooltip');
  if (!tt) return;
  tt.innerHTML = `<div class="tt-country">${flagEmoji(code)} ${nomPays(code)}</div>
    <div class="tt-kw">🔑 ${top3.join(' &nbsp;·&nbsp; ')}</div>`;
  moveMapTooltip(event);
  tt.classList.add('show');
}
function moveMapTooltip(event) {
  const container = document.getElementById('mapContainer');
  const tt = document.getElementById('mapTooltip');
  if (!container || !tt) return;
  const rect = container.getBoundingClientRect();
  let x = event.clientX - rect.left + 14;
  let y = event.clientY - rect.top - 10;
  if (x + 220 > rect.width) x -= 240;
  if (y + 80 > rect.height) y -= 90;
  tt.style.left = x + 'px'; tt.style.top = y + 'px';
}
function hideMapTooltip() {
  const tt = document.getElementById('mapTooltip');
  if (tt) tt.classList.remove('show');
}

function selectCountry(code, event) {
  if (event) event.stopPropagation();
  ACTIVE_COUNTRY = code;
  const infos = countryMap[code] || { mots: [] };
  const sorted = infos.mots.slice(0, 14);
  const maxV = sorted[0]?.poids || 1;

  const titre = document.getElementById('sidebarTitle');
  if (titre) titre.textContent = `${flagEmoji(code)} ${nomPays(code)}`;
  const barres = document.getElementById('sidebarBars');
  if (barres) {
    barres.innerHTML = sorted.map(({ mot: w, poids: v }) => `
      <div class="bar-row">
        <span class="bar-label" title="${w}">${w}</span>
        <div class="bar-track"><div class="bar-fill" style="background:var(--teal)" data-w="${Math.round(v / maxV * 100)}"></div></div>
        <span class="bar-count">${Math.round(v)}</span>
      </div>`).join('');
    animBars();
  }

  if (mapG) {
    mapG.selectAll('.bubble').attr('fill', (d) => d.code === code ? 'rgba(201,150,58,.9)' : 'rgba(139,58,42,.72)');
    mapG.selectAll('.country').classed('active', (d) => NUM_TO_A2[String(d.id)] === code);
  }
  toast(`${flagEmoji(code)} ${nomPays(code)} — ${sorted.length} mots-clés`);
}

function resetMapZoom() {
  if (mapZoom) {
    d3.select('#worldMapSvg').transition().duration(600).call(mapZoom.transform, d3.zoomIdentity);
  }
}

/* ══ ÉVOLUTION ═════════════════════════════════════════════════════════ */
async function traceEvolution(word) {
  if (!word) return;
  EVO_WORD = word.toLowerCase().trim();
  const input = document.getElementById('evoInput');
  if (input) input.value = EVO_WORD;

  const chart = document.getElementById('evoChart');
  if (chart) chart.innerHTML = '<p style="opacity:.6;font-size:13px;">Chargement…</p>';

  try {
    const data = await fetchEvolution(EVO_WORD);
    currentEvoSerie = data.serie || [];
    renderEvoChart();
    await renderTopArticles(EVO_WORD);
  } catch (err) {
    console.error(err);
    toast("Erreur lors du calcul de l'évolution");
  }
}

function renderEvoChart() {
  const label = document.getElementById('evoLabel');
  const chart = document.getElementById('evoChart');
  const note = document.getElementById('evoNote');
  if (!chart) return;

  const vals = currentEvoSerie.map((s) => s.poids);
  const maxV = Math.max(...vals, 1);
  const hasData = vals.some((v) => v > 0);

  if (label) label.innerHTML = hasData
    ? `Évolution de <strong style="color:var(--gold)">"${EVO_WORD}"</strong> sur ${currentEvoSerie.length} mois`
    : `<span style="color:var(--rust)">Mot "<strong>${EVO_WORD}</strong>" non trouvé dans les données.</span>`;

  chart.innerHTML = currentEvoSerie.map((s, i) => {
    const h = Math.max(4, Math.round((s.poids / maxV) * 100));
    const isActive = s.mois === ACTIVE_MONTH;
    return `<div class="tl-col${isActive ? ' hi' : ''}" onclick="setMonth('${s.mois}',${i})">
      <div class="tl-val" style="font-size:9px;color:var(--text-3);">${s.poids > 0 ? Math.round(s.poids) : '—'}</div>
      <div class="tl-bar" style="height:${h}px;${s.poids > 0 ? 'background:var(--gold)' : ''}"></div>
      <div class="tl-lbl">${formatMonthLabel(s.mois).slice(0, 7)}</div>
    </div>`;
  }).join('');

  if (note) note.textContent = hasData
    ? 'Score = fréquence cumulée du mot dans les articles les plus cités du mois (échantillon)'
    : "Ce mot n'apparaît pas dans les mois disponibles. Essayez un synonyme.";
}

async function renderEvoSuggestions() {
  const container = document.getElementById('evoSuggestions');
  if (!container) return;
  try {
    const data = await fetchSuggestions();
    const top = data.suggestions || [];
    container.innerHTML =
      `<span style="font-size:12px;color:var(--text-3);margin-right:4px;">Suggestions :</span>` +
      top.map((w) => `<span class="kw-tag" onclick="traceEvolution('${w.replace(/'/g, "\\'")}')">${w}</span>`).join('');
  } catch (err) {
    console.error(err);
  }
}

/* ══ ARTICLES ══════════════════════════════════════════════════════════ */
async function renderTopArticles(keyword) {
  const sub = document.getElementById('articlesSub');
  if (sub) sub.textContent = 'Chargement…';
  try {
    const data = await fetchArticlesTop(keyword, 20);
    CURRENT_ARTICLES = data.articles || [];
    updateArticlesHeader(keyword, CURRENT_ARTICLES.length);
    displayArticles(CURRENT_ARTICLES, keyword);
  } catch (err) {
    console.error(err);
    if (sub) sub.innerHTML = `<span style="color:var(--rust);">Erreur API : ${err.message}</span>`;
    displayArticles([], keyword);
  }
}

function updateArticlesHeader(keyword, count) {
  const sub = document.getElementById('articlesSub');
  const btn = document.getElementById('resetArticlesBtn');
  if (keyword) {
    if (sub) sub.innerHTML = `Articles contenant <strong style="color:var(--gold)">"${keyword}"</strong> · ${count} résultat${count !== 1 ? 's' : ''}`;
    if (btn) btn.style.display = 'inline-block';
  } else {
    if (sub) sub.textContent = 'Sélection des articles à fort impact · cliquez sur un mot du nuage pour filtrer';
    if (btn) btn.style.display = 'none';
  }
}

/** Devine une URL utilisable à partir de l'id renvoyé par /api/articles-top
 *  (id interne SQLite, parfois un identifiant arXiv/OpenAlex selon la source). */
function urlArticle(id) {
  if (!id) return null;
  const valeur = String(id).trim();
  if (/^https?:\/\//i.test(valeur)) return valeur;
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(valeur)) return `https://arxiv.org/abs/${valeur}`;
  if (/^[a-z-]+\/\d{7}$/i.test(valeur)) return `https://arxiv.org/abs/${valeur}`;
  if (/^W\d+$/i.test(valeur)) return `https://openalex.org/${valeur}`;
  return null; // id purement interne (entier SQLite) : pas de lien OpenAlex fiable
}

function displayArticles(arts, keyword) {
  const container = document.getElementById('topArticlesList');
  if (!container) return;
  if (!arts.length) {
    container.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--text-3);font-size:14px;">
        <div style="font-size:32px;opacity:.35;margin-bottom:10px;">🔍</div>
        Aucun article trouvé${keyword ? ` pour <strong>"${keyword}"</strong>` : ''} dans les données chargées.
        <div style="margin-top:8px;font-size:12px;">Essayez un autre mot du nuage.</div>
      </div>`;
    return;
  }
  container.innerHTML = arts.map((a) => {
    const oa = urlArticle(a.id);
    const ax = `https://arxiv.org/search/?searchtype=all&query=${encodeURIComponent(a.titre || '')}`;
    const auths = (a.auteurs || []).slice(0, 3).map((au) => `<strong>${au.nom || '?'}</strong>`).join(', ');
    const paysUniques = [...new Set((a.auteurs || []).map((au) => au.pays).filter(Boolean))].slice(0, 3);
    const paysHtml = paysUniques.map((p) => `<span class="meta-pill">${flagEmoji(p)} ${p}</span>`).join('');

    return `<div class="article-card">
      <div class="article-title"><a href="${oa || ax}" target="_blank" rel="noopener">${a.titre || 'Sans titre'}</a></div>
      <div class="article-authors">${auths}</div>
      <div class="meta-row">
        <span class="meta-pill date">📅 ${(a.date || '').slice(0, 7) || 'date inconnue'}</span>
        ${a.citations > 0 ? `<span class="meta-pill cit">⭐ ${a.citations} citations</span>` : ''}
        ${paysHtml}
      </div>
      <div class="link-row">
        ${oa ? `<a class="link-btn oa" href="${oa}" target="_blank" rel="noopener">🔗 OpenAlex</a>` : ''}
        <a class="link-btn ax" href="${ax}" target="_blank" rel="noopener">📄 arXiv</a>
      </div>
      ${(a.mots_cles || []).length ? `<div class="kw-row">${a.mots_cles.map((kw) => {
        const isMatch = keyword && kw.toLowerCase().includes(keyword.toLowerCase());
        return `<span class="kw-tag" style="${isMatch ? 'background:var(--gold);color:#fff;border-color:var(--gold);' : ''}" onclick="onCloudClick('${kw.replace(/'/g, "\\'")}')">${kw}</span>`;
      }).join('')}</div>` : ''}
    </div>`;
  }).join('');
  setTimeout(() => document.querySelectorAll('.article-card:not(.visible)').forEach((el) => revObs.observe(el)), 50);
}

function resetArticles() {
  EVO_WORD = null;
  document.querySelectorAll('.cloud-word').forEach((el) => el.classList.remove('selected'));
  const btn = document.getElementById('resetArticlesBtn');
  if (btn) btn.style.display = 'none';
  const label = document.getElementById('evoLabel');
  if (label) label.textContent = 'Saisissez un mot-clé ci-dessus ou cliquez sur le nuage.';
  const chart = document.getElementById('evoChart');
  if (chart) chart.innerHTML = '';
  const note = document.getElementById('evoNote');
  if (note) note.textContent = '';
  currentEvoSerie = [];
  renderTopArticles(null);
}

/* ══ Export CSV des articles ═══════════════════════════════════════════ */
function exportArticlesCSV() {
  if (!CURRENT_ARTICLES.length) {
    toast('Aucun article à exporter');
    return;
  }
  const headers = ['Titre', 'Date', 'Auteurs', 'Pays', 'Citations', 'Mots-clés', 'URL OpenAlex', 'URL arXiv'];
  const rows = CURRENT_ARTICLES.map((a) => [
    `"${(a.titre || '').replace(/"/g, '""')}"`,
    a.date || '',
    `"${(a.auteurs || []).map((au) => au.nom || '?').join(';')}"`,
    `"${[...new Set((a.auteurs || []).map((au) => au.pays).filter(Boolean))].join(';')}"`,
    a.citations || 0,
    `"${(a.mots_cles || []).join(';')}"`,
    urlArticle(a.id) || '',
    `"https://arxiv.org/search/?searchtype=all&query=${encodeURIComponent(a.titre || '')}"`,
  ]);
  const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = url;
  el.download = `articles_${EVO_WORD ? EVO_WORD + '_' : ''}${new Date().toISOString().slice(0, 10)}.csv`;
  el.click();
  URL.revokeObjectURL(url);
  toast(`✓ ${CURRENT_ARTICLES.length} articles exportés en CSV`);
}

/* ══ Init (page unique) ════════════════════════════════════════════════ */
async function initApp() {
  toast('Chargement des données…', 1800);
  construireNumToA2();

  try {
    const [moisData, statsData] = await Promise.all([fetchMois(), fetchStatsGlobales()]);
    MONTH_ORDER = moisData.mois || [];
    STATS_GLOBALES = statsData;
  } catch (e) {
    console.error('Erreur lors du chargement initial', e);
    toast('⚠ Erreur de chargement de l’API — vérifie que le backend est démarré');
  }

  initMonthPills();
  await renderCloud(ACTIVE_MONTH);
  renderStatStrip();
  await loadPaysEtCarte();
  renderEvoSuggestions();
  await renderTopArticles();
  setTimeout(renderMap, 100);
}
initApp();
