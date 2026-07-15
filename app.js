/**
 * app.js — Logique de l'interface "Veille Scientifique"
 * Charger en dernier (après config.js et data.js).
 * Toutes les fonctions appelées depuis les attributs onclick de index.html
 * (setMode, doSearch, switchTab, exportCSV) sont volontairement globales.
 */

let mode = "local";
let currentArticles = [];
let currentStats = null;
let libsMapChargees = false;

/* ---------------------------------------------------------------- */
/* Utilitaires                                                       */
/* ---------------------------------------------------------------- */

function echapperHtml(texte) {
  const div = document.createElement("div");
  div.textContent = texte == null ? "" : String(texte);
  return div.innerHTML;
}

function afficherToast(message, duree = 3000) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(afficherToast._timer);
  afficherToast._timer = setTimeout(() => toast.classList.remove("show"), duree);
}

function chargerScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Échec du chargement : ${src}`));
    document.head.appendChild(s);
  });
}

/* ---------------------------------------------------------------- */
/* Mode local (Flask/bdd.db) vs mode API (Semantic Scholar)          */
/* ---------------------------------------------------------------- */

function setMode(nouveauMode) {
  mode = nouveauMode;

  document.getElementById("btnModeLocal").classList.toggle("active", mode === "local");
  document.getElementById("btnModeApi").classList.toggle("active", mode === "api");
  document.getElementById("localModeArea").classList.toggle("active", mode === "local");
  document.getElementById("apiModeArea").classList.toggle("active", mode === "api");

  const sourceTag = document.getElementById("sourceTag");
  if (sourceTag) {
    sourceTag.textContent = mode === "local" ? "OpenAlex · arXiv (base locale)" : "Semantic Scholar";
  }
}

/* ---------------------------------------------------------------- */
/* Recherche                                                         */
/* ---------------------------------------------------------------- */

async function doSearch() {
  const q = document.getElementById("searchInput").value.trim();
  const pays = document.getElementById("fPays").value;
  const langue = document.getElementById("fLang").value;
  const sort = document.getElementById("fSort").value;
  const limit = document.getElementById("fLimit").value;

  const btn = document.getElementById("btnSearch");
  const zone = document.getElementById("results-zone");
  const tabsSection = document.getElementById("tabs-section");

  btn.disabled = true;
  btn.textContent = "Recherche…";
  zone.innerHTML = `<div class="state-box"><div class="state-icon">⏳</div><p>Interrogation en cours…</p></div>`;

  try {
    let resultat;
    if (mode === "local") {
      resultat = await fetchLocalArticles({ q, pays, langue, sort, limit });
    } else {
      const year = document.getElementById("fYear").value;
      const field = document.getElementById("fField").value;
      resultat = await fetchSemanticScholar({ q, year, field, limit });
    }

    currentArticles = resultat.articles || [];
    currentStats = resultat.stats || calculerStatsLocales(currentArticles);

    if (currentArticles.length === 0) {
      zone.innerHTML = `<div class="state-box"><div class="state-icon">🕳️</div><p>Aucun résultat pour cette recherche. Essaie d'autres filtres.</p></div>`;
      tabsSection.style.display = "none";
    } else {
      zone.innerHTML = "";
      tabsSection.style.display = "block";
      mettreAJourEntete();
      renderArticles();
      renderStats();
      renderAuteurs();
      renderPays();
    }
  } catch (err) {
    console.error(err);
    zone.innerHTML = `<div class="state-box"><div class="state-icon">⚠️</div><p>${echapperHtml(err.message)}</p></div>`;
    tabsSection.style.display = "none";
    afficherToast("Erreur lors de la recherche");
  } finally {
    btn.disabled = false;
    btn.textContent = "Rechercher →";
  }
}

function mettreAJourEntete() {
  const totalBadge = document.getElementById("totalBadge");
  const countLine = document.getElementById("countLine");
  const statStrip = document.getElementById("statStrip");

  if (totalBadge) totalBadge.textContent = `${currentArticles.length} articles`;
  if (countLine) countLine.textContent = `${currentArticles.length} article(s) trouvé(s)`;

  if (statStrip) {
    const totalCitations = currentArticles.reduce((s, a) => s + (a.citations || 0), 0);
    statStrip.style.display = "flex";
    statStrip.innerHTML = [
      { label: "Articles", valeur: currentArticles.length },
      { label: "Citations cumulées", valeur: totalCitations },
      { label: "Auteurs uniques", valeur: currentStats.total_auteurs || 0 },
      { label: "Pays représentés", valeur: Object.keys(currentStats.pays || {}).length },
    ]
      .map(
        (s) => `
        <div class="stat-chip" style="padding:.6rem 1rem;border:1px solid rgba(160,130,90,.25);border-radius:10px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.6;">${s.label}</div>
          <div style="font-family:'Playfair Display',serif;font-size:1.4rem;font-weight:700;">${s.valeur}</div>
        </div>`
      )
      .join("");
  }
}

/* ---------------------------------------------------------------- */
/* Onglets                                                           */
/* ---------------------------------------------------------------- */

function switchTab(nom, btnEl) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));

  if (btnEl) btnEl.classList.add("active");
  const panel = document.getElementById(`panel-${nom}`);
  if (panel) panel.classList.add("active");
}

/* ---------------------------------------------------------------- */
/* Panneau Articles                                                  */
/* ---------------------------------------------------------------- */

function renderArticles() {
  const container = document.getElementById("articleList");
  if (!container) return;

  container.innerHTML = currentArticles
    .map((a) => {
      const auteursTexte = (a.auteurs || [])
        .slice(0, 4)
        .map((au) => echapperHtml(au.nom))
        .join(", ");
      const pluAuteurs = (a.auteurs || []).length > 4 ? ` +${a.auteurs.length - 4}` : "";

      return `
        <article class="article-card" style="padding:1rem 0;border-bottom:1px solid rgba(160,130,90,.15);">
          <h3 style="font-family:'Playfair Display',serif;font-size:1.05rem;margin:0 0 .35rem;">
            ${echapperHtml(a.titre)}
          </h3>
          <div style="font-size:12px;opacity:.65;display:flex;gap:12px;flex-wrap:wrap;">
            <span>📅 ${echapperHtml(a.date || "date inconnue")}</span>
            <span>🌐 ${echapperHtml((a.langue || "?").toUpperCase())}</span>
            <span>🔖 ${a.citations || 0} citation(s)</span>
            ${auteursTexte ? `<span>✍️ ${auteursTexte}${pluAuteurs}</span>` : ""}
          </div>
        </article>`;
    })
    .join("");
}

function exportCSV() {
  if (currentArticles.length === 0) {
    afficherToast("Rien à exporter pour le moment");
    return;
  }

  const entetes = ["id", "titre", "date", "langue", "citations", "auteurs"];
  const lignes = currentArticles.map((a) => {
    const auteurs = (a.auteurs || []).map((au) => au.nom).join(" | ");
    return [a.id, a.titre, a.date, a.langue, a.citations, auteurs]
      .map((val) => `"${String(val ?? "").replace(/"/g, '""')}"`)
      .join(",");
  });

  const csv = [entetes.join(","), ...lignes].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "veille_scientifique_export.csv";
  a.click();
  URL.revokeObjectURL(url);

  afficherToast("Export CSV téléchargé");
}

/* ---------------------------------------------------------------- */
/* Panneau Statistiques                                              */
/* ---------------------------------------------------------------- */

function barreHorizontale(label, valeur, max, unite = "") {
  const largeur = max > 0 ? Math.max(4, Math.round((valeur / max) * 100)) : 0;
  return `
    <div class="bar-row" style="display:flex;align-items:center;gap:10px;margin:6px 0;">
      <div class="bar-label" style="width:140px;font-size:12px;opacity:.8;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${echapperHtml(label)}
      </div>
      <div class="bar-track" style="flex:1;background:rgba(160,130,90,.12);border-radius:6px;height:10px;overflow:hidden;">
        <div class="bar-fill" style="width:${largeur}%;height:100%;background:${CONFIG.ACCENT};border-radius:6px;"></div>
      </div>
      <div class="bar-value" style="width:52px;text-align:right;font-size:12px;opacity:.75;">${valeur}${unite}</div>
    </div>`;
}

function renderStats() {
  if (!currentStats) return;

  const barMonths = document.getElementById("barMonths");
  const barCitations = document.getElementById("barCitations");
  const barLangs = document.getElementById("barLangs");
  const cloud = document.getElementById("cloud");

  // Articles par mois
  if (barMonths) {
    const entrees = Object.entries(currentStats.par_mois || {});
    const max = Math.max(1, ...entrees.map(([, v]) => v));
    barMonths.innerHTML = entrees.length
      ? entrees.map(([mois, v]) => barreHorizontale(mois, v, max)).join("")
      : `<p style="opacity:.6;font-size:13px;">Pas assez de données.</p>`;
  }

  // Top 10 citations
  if (barCitations) {
    const entrees = (currentStats.top_citations || []).map((a) => [a.titre, a.citations || 0]);
    const max = Math.max(1, ...entrees.map(([, v]) => v));
    barCitations.innerHTML = entrees.length
      ? entrees.map(([titre, v]) => barreHorizontale(titre, v, max)).join("")
      : `<p style="opacity:.6;font-size:13px;">Pas assez de données.</p>`;
  }

  // Langues
  if (barLangs) {
    const entrees = Object.entries(currentStats.langues || {});
    const max = Math.max(1, ...entrees.map(([, v]) => v));
    barLangs.innerHTML = entrees.length
      ? entrees.map(([langue, v]) => barreHorizontale(langue.toUpperCase(), v, max)).join("")
      : `<p style="opacity:.6;font-size:13px;">Pas assez de données.</p>`;
  }

  // Nuage de mots-clés
  if (cloud) {
    const mots = currentStats.mots_cles || [];
    if (mots.length === 0) {
      cloud.innerHTML = `<p style="opacity:.6;font-size:13px;">Nuage de mots-clés indisponible pour cette source.</p>`;
    } else {
      const maxPoids = Math.max(...mots.map((m) => m.poids));
      cloud.innerHTML = mots
        .map((m) => {
          const taille = 12 + Math.round((m.poids / maxPoids) * 20);
          const opacite = 0.55 + 0.45 * (m.poids / maxPoids);
          return `<span class="tag" style="display:inline-block;margin:4px 6px;font-size:${taille}px;opacity:${opacite.toFixed(2)};color:${CONFIG.ACCENT};font-weight:600;">${echapperHtml(m.mot)}</span>`;
        })
        .join("");
    }
  }
}

/* ---------------------------------------------------------------- */
/* Panneau Auteurs                                                   */
/* ---------------------------------------------------------------- */

function renderAuteurs() {
  const container = document.getElementById("auteurList");
  if (!container) return;

  const compte = {};
  currentArticles.forEach((a) => {
    (a.auteurs || []).forEach((au) => {
      if (!au.nom) return;
      if (!compte[au.nom]) compte[au.nom] = { nom: au.nom, pays: new Set(), articles: 0 };
      compte[au.nom].articles += 1;
      if (au.pays) compte[au.nom].pays.add(au.pays);
    });
  });

  const auteurs = Object.values(compte).sort((a, b) => b.articles - a.articles);

  if (auteurs.length === 0) {
    container.innerHTML = `<div class="state-box"><div class="state-icon">🧑‍🔬</div><p>Aucun auteur pour cette recherche.</p></div>`;
    return;
  }

  container.innerHTML = auteurs
    .map(
      (au) => `
      <div class="author-row" style="display:flex;justify-content:space-between;align-items:center;padding:.6rem 0;border-bottom:1px solid rgba(160,130,90,.12);">
        <span style="font-weight:600;">${echapperHtml(au.nom)}</span>
        <span style="font-size:12px;opacity:.7;">${au.articles} article(s) · ${[...au.pays].map(nomPays).join(", ") || "pays inconnu"}</span>
      </div>`
    )
    .join("");
}

/* ---------------------------------------------------------------- */
/* Panneau Pays (barres + carte D3)                                  */
/* ---------------------------------------------------------------- */

function renderPays() {
  const barPaysMain = document.getElementById("barPaysMain");
  const paysGrid = document.getElementById("paysGrid");
  if (!currentStats) return;

  const entrees = Object.entries(currentStats.pays || {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entrees.map(([, v]) => v));

  if (barPaysMain) {
    barPaysMain.innerHTML = entrees.length
      ? entrees.map(([code, v]) => barreHorizontale(nomPays(code), v, max)).join("")
      : `<p style="opacity:.6;font-size:13px;">Pas de données géographiques.</p>`;
  }

  if (paysGrid) {
    const cartes = entrees
      .map(
        ([code, v]) => `
        <div class="country-card" style="padding:.75rem 1rem;border:1px solid rgba(160,130,90,.2);border-radius:10px;">
          <div style="font-weight:600;">${echapperHtml(nomPays(code))}</div>
          <div style="font-size:12px;opacity:.65;">${code} · ${v} auteur(s)</div>
        </div>`
      )
      .join("");

    paysGrid.innerHTML = `<div id="mapContainer" style="margin-bottom:1rem;"></div><div class="pays-cards-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;">${cartes}</div>`;

    dessinerCarteMonde(Object.fromEntries(entrees));
  }
}

async function dessinerCarteMonde(comptesParPays) {
  const container = document.getElementById("mapContainer");
  if (!container) return;

  try {
    if (!libsMapChargees) {
      await chargerScript("https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js");
      await chargerScript("https://cdnjs.cloudflare.com/ajax/libs/topojson-client/3.1.0/topojson-client.min.js");
      libsMapChargees = true;
    }

    const monde = await fetch("https://unpkg.com/world-atlas@2/countries-110m.json").then((r) => r.json());
    const pays = topojson.feature(monde, monde.objects.countries).features;

    const largeur = container.clientWidth || 700;
    const hauteur = Math.round(largeur * 0.52);

    const projection = d3.geoNaturalEarth1().fitSize([largeur, hauteur], { type: "Sphere" });
    const chemin = d3.geoPath(projection);

    // Table numeric ISO -> code alpha-2, dérivée de PAYS_INFO
    const numeriqueVersAlpha2 = {};
    Object.entries(PAYS_INFO).forEach(([alpha2, info]) => {
      numeriqueVersAlpha2[String(Number(info.numeric))] = alpha2;
    });

    const maxCompte = Math.max(1, ...Object.values(comptesParPays));
    const echelleCouleur = d3.scaleSequential(d3.interpolateOranges).domain([0, maxCompte]);

    const svg = d3
      .select(container)
      .html("")
      .append("svg")
      .attr("viewBox", `0 0 ${largeur} ${hauteur}`)
      .attr("width", "100%")
      .attr("height", "auto")
      .style("background", "transparent");

    svg
      .append("path")
      .attr("d", chemin({ type: "Sphere" }))
      .attr("fill", "rgba(160,130,90,.06)")
      .attr("stroke", "rgba(160,130,90,.2)");

    svg
      .selectAll("path.pays")
      .data(pays)
      .join("path")
      .attr("class", "pays")
      .attr("d", chemin)
      .attr("stroke", "rgba(20,15,10,.4)")
      .attr("stroke-width", 0.4)
      .attr("fill", (d) => {
        const alpha2 = numeriqueVersAlpha2[String(Number(d.id))];
        const compte = alpha2 ? comptesParPays[alpha2] : 0;
        return compte ? echelleCouleur(compte) : "rgba(160,130,90,.1)";
      })
      .append("title")
      .text((d) => {
        const alpha2 = numeriqueVersAlpha2[String(Number(d.id))];
        const compte = (alpha2 && comptesParPays[alpha2]) || 0;
        return `${d.properties.name} : ${compte} auteur(s)`;
      });
  } catch (err) {
    console.error("Carte indisponible :", err);
    container.innerHTML = `<p style="opacity:.6;font-size:13px;">Carte indisponible (${echapperHtml(err.message)}).</p>`;
  }
}

/* ---------------------------------------------------------------- */
/* Animation étoiles du hero (canvas)                                */
/* ---------------------------------------------------------------- */

function initEtoiles() {
  const canvas = document.getElementById("starCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let etoiles = [];

  function redimensionner() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    const nb = Math.floor((canvas.width * canvas.height) / 9000);
    etoiles = Array.from({ length: nb }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.4 + 0.2,
      phase: Math.random() * Math.PI * 2,
      vitesse: 0.005 + Math.random() * 0.01,
    }));
  }

  function animer(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    etoiles.forEach((e) => {
      const scintillement = 0.5 + 0.5 * Math.sin(t * e.vitesse + e.phase);
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(245,239,230,${0.15 + 0.6 * scintillement})`;
      ctx.fill();
    });
    requestAnimationFrame(animer);
  }

  window.addEventListener("resize", redimensionner);
  redimensionner();
  requestAnimationFrame(animer);
}

/* ---------------------------------------------------------------- */
/* Initialisation                                                    */
/* ---------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  initEtoiles();
  setMode("local");
});
