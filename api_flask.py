"""
Nom........ : api_flask.py
Description : API Flask pour "Tendances Scientifiques" (nuage de mots par mois,
               carte mondiale par pays, évolution temporelle d'un mot-clé,
               articles les plus cités).
"""

import json
import os
import sqlite3
import time

from flask import Flask, jsonify, request
from flask_cors import CORS

application = Flask(__name__)
CORS(application)


_cache = {}
CACHE_TTL = 600  # 10 minutes — la base ne change pas entre deux déploiements,
# donc mettre en cache les endpoints coûteux évite de refaire le même calcul
# lourd à chaque rechargement de page.


def cache_get(cle):
    entree = _cache.get(cle)
    if entree and (time.time() - entree[0]) < CACHE_TTL:
        return entree[1]
    return None


def cache_set(cle, valeur):
    _cache[cle] = (time.time(), valeur)


@application.after_request
def ajouter_entetes_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    return response


@application.errorhandler(Exception)
def gerer_erreur(e):
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return e
    application.logger.exception("Erreur non gérée")
    return jsonify({"error": str(e)}), 500


STOPWORDS = {
    # Mots grammaticaux / connecteurs génériques (ne sont jamais des mots-clés scientifiques)
    "about", "above", "across", "after", "again", "against", "all", "almost",
    "along", "already", "also", "although", "always", "among", "amongst",
    "another", "any", "anyone", "anything", "around", "back", "became",
    "because", "become", "becomes", "before", "being", "below", "between",
    "beyond", "both", "cannot", "could", "does", "doing", "done", "down",
    "during", "each", "either", "else", "enough", "even", "ever", "every",
    "few", "first", "found", "further", "given", "gives", "goes", "having",
    "here", "herself", "himself", "however", "including", "into", "itself",
    "just", "large", "last", "later", "least", "less", "like", "made",
    "make", "makes", "many", "might", "more", "most", "mostly", "much",
    "must", "myself", "near", "need", "needs", "neither", "next", "none",
    "often", "once", "onto", "other", "others", "ourselves", "over", "part",
    "perhaps", "please", "quite", "rather", "recent", "recently", "same",
    "second", "seen", "several", "shall", "should", "show", "shown", "shows",
    "since", "some", "someone", "something", "still", "such", "take",
    "taken", "than", "then", "there", "therefore", "these", "they", "this",
    "those", "though", "three", "through", "throughout", "thus", "together",
    "toward", "towards", "under", "unless", "until", "upon", "various",
    "very", "went", "were", "than", "what", "when", "whenever", "where", "whereas",
    "wherever", "whether", "which", "while", "whose", "will", "within",
    "without", "would", "yourself", "yourselves",
    # Déjà présents précédemment
    "the", "and", "for", "with", "that", "this", "from", "are", "was",
    "have", "has", "been", "such", "using", "used", "based", "these",
    "then", "also", "which", "their", "our", "des", "les", "une", "dans",
    "pour", "avec", "sur", "par", "est", "sont", "que", "qui", "aux", "nous",
}

# Nombre d'articles échantillonnés (les plus cités) pour calculer les nuages
# de mots / évolutions, plutôt que de scanner toute la base à chaque requête.
TAILLE_ECHANTILLON_MOIS = 250
TAILLE_ECHANTILLON_PAYS = 100
TAILLE_ECHANTILLON_EVOLUTION = 100
TAILLE_ECHANTILLON_SUGGESTIONS = 250


def connecter_bdd():
    connexion = sqlite3.connect("bdd.db")
    connexion.row_factory = sqlite3.Row
    return connexion


def initialiser_index():
    """Crée les index nécessaires pour que les requêtes restent rapides sur
    une base de ~1,4 Go. Exécuté une fois au démarrage du service."""
    try:
        connexion = connecter_bdd()
        curseur = connexion.cursor()
        curseur.execute("CREATE INDEX IF NOT EXISTS idx_articles_citations ON articles(citations)")
        curseur.execute("CREATE INDEX IF NOT EXISTS idx_articles_date ON articles(date)")
        curseur.execute("CREATE INDEX IF NOT EXISTS idx_articles_langue ON articles(langue)")
        curseur.execute("CREATE INDEX IF NOT EXISTS idx_auteurs_id_article ON auteurs(id_article)")
        curseur.execute("CREATE INDEX IF NOT EXISTS idx_auteurs_pays ON auteurs(pays)")
        connexion.commit()
        connexion.close()
        application.logger.info("Index SQLite vérifiés/créés avec succès.")
    except Exception:
        application.logger.exception("Erreur lors de la création des index SQLite")


initialiser_index()


def extraire_mots(index_json_str, cible):
    """Ajoute au dictionnaire `cible` les mots-clés (et leur poids) trouvés
    dans une colonne index_inverse_compte (JSON : {mot: [positions]})."""
    if not index_json_str:
        return
    try:
        index_inverse = json.loads(index_json_str)
    except (json.JSONDecodeError, TypeError):
        return

    for mot, positions in index_inverse.items():
        mot_normalise = mot.lower().strip()
        if len(mot_normalise) < 4 or mot_normalise in STOPWORDS:
            continue
        if not mot_normalise.replace("-", "").isalpha():
            continue
        poids = len(positions) if isinstance(positions, list) else 1
        cible[mot_normalise] = cible.get(mot_normalise, 0) + poids


def bornes_du_mois(mois):
    """'2025-03' -> ('2025-03-01', '2025-04-01') pour filtrer par plage de date
    (permet d'utiliser l'index sur `date`, contrairement à substr(date,1,7))."""
    annee, mois_num = mois.split("-")
    annee, mois_num = int(annee), int(mois_num)
    debut = f"{annee:04d}-{mois_num:02d}-01"
    if mois_num == 12:
        fin = f"{annee + 1:04d}-01-01"
    else:
        fin = f"{annee:04d}-{mois_num + 1:02d}-01"
    return debut, fin


@application.route("/health")
def health():
    return jsonify({"status": "ok"})


@application.route("/api/mois")
def api_mois():
    connexion = connecter_bdd()
    curseur = connexion.cursor()
    curseur.execute("""
        SELECT DISTINCT substr(date, 1, 7) AS mois
        FROM articles
        WHERE date IS NOT NULL AND date != ''
        ORDER BY mois
    """)
    mois = [ligne["mois"] for ligne in curseur.fetchall() if ligne["mois"]]
    connexion.close()
    return jsonify({"mois": mois})


@application.route("/api/mots-cles")
def api_mots_cles():
    mois = request.args.get("mois", "").strip()
    try:
        limite_mots = min(max(int(request.args.get("limit", 40)), 5), 100)
    except ValueError:
        limite_mots = 40

    cle_cache = f"mots-cles:{mois}:{limite_mots}"
    en_cache = cache_get(cle_cache)
    if en_cache is not None:
        return jsonify(en_cache)

    connexion = connecter_bdd()
    curseur = connexion.cursor()

    if mois:
        try:
            debut, fin = bornes_du_mois(mois)
            curseur.execute("""
                SELECT index_inverse_compte
                FROM articles
                WHERE date >= ? AND date < ?
                ORDER BY citations DESC
                LIMIT ?
            """, (debut, fin, TAILLE_ECHANTILLON_MOIS))
        except ValueError:
            mois = ""
            curseur.execute("""
                SELECT index_inverse_compte FROM articles
                ORDER BY citations DESC LIMIT ?
            """, (TAILLE_ECHANTILLON_MOIS,))
    else:
        curseur.execute("""
            SELECT index_inverse_compte FROM articles
            ORDER BY citations DESC LIMIT ?
        """, (TAILLE_ECHANTILLON_MOIS,))

    lignes = curseur.fetchall()
    connexion.close()

    compteur = {}
    for ligne in lignes:
        extraire_mots(ligne["index_inverse_compte"], compteur)

    mots = sorted(compteur.items(), key=lambda item: item[1], reverse=True)[:limite_mots]

    resultat = {
        "mois": mois or "tous",
        "mots": [{"mot": m, "poids": p} for m, p in mots],
        "echantillon": len(lignes),
    }
    cache_set(cle_cache, resultat)
    return jsonify(resultat)


@application.route("/api/pays")
def api_pays():
    try:
        limite_pays = min(max(int(request.args.get("limit_pays", 25)), 1), 50)
    except ValueError:
        limite_pays = 25
    try:
        limite_mots = min(max(int(request.args.get("mots_par_pays", 8)), 1), 20)
    except ValueError:
        limite_mots = 8

    cle_cache = f"pays:{limite_pays}:{limite_mots}"
    en_cache = cache_get(cle_cache)
    if en_cache is not None:
        return jsonify(en_cache)

    connexion = connecter_bdd()
    curseur = connexion.cursor()

    curseur.execute("""
        SELECT pays, COUNT(DISTINCT id_article) AS total
        FROM auteurs
        WHERE pays IS NOT NULL AND pays != ''
        GROUP BY pays
        ORDER BY total DESC
        LIMIT ?
    """, (limite_pays,))
    lignes_pays = curseur.fetchall()

    resultat = []
    for ligne_pays in lignes_pays:
        code = ligne_pays["pays"]
        curseur.execute("""
            SELECT articles.index_inverse_compte
            FROM articles
            JOIN auteurs ON auteurs.id_article = articles.id
            WHERE auteurs.pays = ?
            ORDER BY articles.citations DESC
            LIMIT ?
        """, (code, TAILLE_ECHANTILLON_PAYS))

        compteur = {}
        for ligne in curseur.fetchall():
            extraire_mots(ligne["index_inverse_compte"], compteur)
        mots = sorted(compteur.items(), key=lambda item: item[1], reverse=True)[:limite_mots]

        resultat.append({
            "code": code,
            "total": ligne_pays["total"],
            "mots": [{"mot": m, "poids": p} for m, p in mots],
        })

    connexion.close()
    resultat = {"pays": resultat}
    cache_set(cle_cache, resultat)
    return jsonify(resultat)


@application.route("/api/evolution")
def api_evolution():
    mot = request.args.get("mot", "").strip().lower()
    if not mot:
        return jsonify({"error": "Paramètre 'mot' requis."}), 400

    connexion = connecter_bdd()
    curseur = connexion.cursor()

    curseur.execute("""
        SELECT DISTINCT substr(date, 1, 7) AS mois
        FROM articles
        WHERE date IS NOT NULL AND date != ''
        ORDER BY mois
    """)
    tous_les_mois = [l["mois"] for l in curseur.fetchall() if l["mois"]]

    serie = []
    for mois in tous_les_mois:
        try:
            debut, fin = bornes_du_mois(mois)
        except ValueError:
            continue

        curseur.execute("""
            SELECT index_inverse_compte
            FROM articles
            WHERE date >= ? AND date < ?
            ORDER BY citations DESC
            LIMIT ?
        """, (debut, fin, TAILLE_ECHANTILLON_EVOLUTION))

        poids_mois = 0
        for ligne in curseur.fetchall():
            if not ligne["index_inverse_compte"]:
                continue
            try:
                index_inverse = json.loads(ligne["index_inverse_compte"])
            except (json.JSONDecodeError, TypeError):
                continue
            for cle, positions in index_inverse.items():
                if cle.lower().strip() == mot:
                    poids_mois += len(positions) if isinstance(positions, list) else 1
                    break

        serie.append({"mois": mois, "poids": poids_mois})

    connexion.close()
    return jsonify({"mot": mot, "serie": serie})


@application.route("/api/articles-top")
def api_articles_top():
    mot = request.args.get("mot", "").strip().lower()
    try:
        limite = min(max(int(request.args.get("limit", 20)), 1), 100)
    except ValueError:
        limite = 20

    connexion = connecter_bdd()
    curseur = connexion.cursor()

    if mot:
        # NB : LIKE sur une colonne JSON non indexée = scan complet, donc plus
        # lent qu'un tri par citations classique. Acceptable pour ce volume,
        # mais une vraie recherche plein texte (FTS5) serait la suite logique.
        curseur.execute("""
            SELECT id, titre, date, langue, citations, index_inverse_compte
            FROM articles
            WHERE index_inverse_compte LIKE ?
            ORDER BY citations DESC
            LIMIT ?
        """, (f'%"{mot}"%', limite * 5))

        lignes = []
        for ligne in curseur.fetchall():
            try:
                index_inverse = json.loads(ligne["index_inverse_compte"] or "{}")
            except (json.JSONDecodeError, TypeError):
                continue
            if any(cle.lower().strip() == mot for cle in index_inverse.keys()):
                lignes.append(ligne)
            if len(lignes) >= limite:
                break
    else:
        curseur.execute("""
            SELECT id, titre, date, langue, citations, index_inverse_compte
            FROM articles
            ORDER BY citations DESC
            LIMIT ?
        """, (limite,))
        lignes = curseur.fetchall()

    articles = []
    if lignes:
        ids = [ligne["id"] for ligne in lignes]
        marqueurs = ",".join("?" for _ in ids)
        curseur.execute(f"""
            SELECT id_article, nom, pays FROM auteurs
            WHERE id_article IN ({marqueurs})
        """, ids)
        auteurs_par_article = {}
        for ligne_auteur in curseur.fetchall():
            auteurs_par_article.setdefault(ligne_auteur["id_article"], []).append(
                {"nom": ligne_auteur["nom"], "pays": ligne_auteur["pays"]}
            )

        for ligne in lignes:
            compteur_mots = {}
            extraire_mots(ligne["index_inverse_compte"], compteur_mots)
            mots_article = sorted(compteur_mots.items(), key=lambda item: item[1], reverse=True)[:10]

            articles.append({
                "id": ligne["id"],
                "titre": ligne["titre"],
                "date": ligne["date"],
                "langue": ligne["langue"],
                "citations": ligne["citations"],
                "auteurs": auteurs_par_article.get(ligne["id"], []),
                "mots_cles": [m for m, _ in mots_article],
            })

    connexion.close()
    return jsonify({"articles": articles, "mot": mot or None})


@application.route("/api/suggestions")
def api_suggestions():
    try:
        limite = min(max(int(request.args.get("limit", 12)), 1), 30)
    except ValueError:
        limite = 12

    cle_cache = f"suggestions:{limite}"
    en_cache = cache_get(cle_cache)
    if en_cache is not None:
        return jsonify(en_cache)

    connexion = connecter_bdd()
    curseur = connexion.cursor()
    curseur.execute("""
        SELECT index_inverse_compte FROM articles
        ORDER BY citations DESC LIMIT ?
    """, (TAILLE_ECHANTILLON_SUGGESTIONS,))

    compteur = {}
    for ligne in curseur.fetchall():
        extraire_mots(ligne["index_inverse_compte"], compteur)
    connexion.close()

    mots = sorted(compteur.items(), key=lambda item: item[1], reverse=True)[:limite]
    resultat = {"suggestions": [m for m, _ in mots]}
    cache_set(cle_cache, resultat)
    return jsonify(resultat)


@application.route("/api/stats-globales")
def api_stats_globales():
    en_cache = cache_get("stats-globales")
    if en_cache is not None:
        return jsonify(en_cache)

    connexion = connecter_bdd()
    curseur = connexion.cursor()

    curseur.execute("SELECT COUNT(*) AS n, SUM(citations) AS total_citations FROM articles")
    ligne = curseur.fetchone()
    total_articles = ligne["n"] or 0
    total_citations = ligne["total_citations"] or 0

    curseur.execute("SELECT COUNT(DISTINCT pays) AS n FROM auteurs WHERE pays IS NOT NULL AND pays != ''")
    total_pays = curseur.fetchone()["n"] or 0

    curseur.execute("""
        SELECT COUNT(DISTINCT substr(date, 1, 7)) AS n
        FROM articles WHERE date IS NOT NULL AND date != ''
    """)
    total_mois = curseur.fetchone()["n"] or 0

    connexion.close()
    resultat = {
        "total_articles": total_articles,
        "total_citations": total_citations,
        "total_pays": total_pays,
        "total_mois": total_mois,
    }
    cache_set("stats-globales", resultat)
    return jsonify(resultat)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    application.run(host="0.0.0.0", port=port, debug=True)
