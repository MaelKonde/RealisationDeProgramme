"""
Nom........ : api_flask.py
Description : Renvoie les données de la base de données par le biais d'une API Flask
"""

import json
import os
import sqlite3

from flask import Flask, jsonify, request
from flask_cors import CORS

application = Flask(__name__)
CORS(application)

STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "are", "was", "were",
    "have", "has", "been", "into", "such", "using", "used", "based", "these",
    "than", "then", "also", "which", "their", "our", "des", "les", "une", "dans",
    "pour", "avec", "sur", "par", "est", "sont", "que", "qui", "aux", "nous",
}


def connecter_bdd():
    connexion = sqlite3.connect("bdd.db")
    connexion.row_factory = sqlite3.Row
    return connexion


@application.route("/health")
def health():
    """Utilisé par Render pour vérifier que le service est prêt (healthCheckPath)."""
    return jsonify({"status": "ok"})


@application.route("/articles/<int:limite>")
def liste_articles(limite):
    connexion = connecter_bdd()
    curseur = connexion.cursor()

    curseur.execute("""
        SELECT id, titre, date, langue, citations
        FROM articles
        ORDER BY date DESC
        LIMIT ?
    """, (limite,))

    lignes = curseur.fetchall()
    connexion.close()

    articles = [
        {
            "id": ligne["id"],
            "titre": ligne["titre"],
            "date": ligne["date"],
            "langue": ligne["langue"],
            "citations": ligne["citations"]
        }
        for ligne in lignes
    ]

    return jsonify(articles)


@application.route("/auteurs/<id_article>")
def liste_auteurs(id_article):
    connexion = connecter_bdd()
    curseur = connexion.cursor()

    curseur.execute("""
        SELECT nom, pays
        FROM auteurs
        WHERE id_article = ?
    """, (id_article,))

    lignes = curseur.fetchall()
    connexion.close()

    auteurs = [
        {"nom": ligne["nom"], "pays": ligne["pays"]}
        for ligne in lignes
    ]

    return jsonify(auteurs)


@application.route("/api/search")
def api_search():
    """
    Endpoint principal utilisé par le front-end (mode 'Fichiers locaux').

    Paramètres de requête :
      q      : mot-clé dans le titre
      pays   : code pays (ex: FR, US)
      langue : code langue (en, fr)
      sort   : citations | date | alpha
      limit  : nombre d'articles à renvoyer (max 200)
    """
    q = request.args.get("q", "").strip()
    pays = request.args.get("pays", "").strip().upper()
    langue = request.args.get("langue", "").strip()
    sort = request.args.get("sort", "citations")

    try:
        limite = min(max(int(request.args.get("limit", 20)), 1), 200)
    except ValueError:
        limite = 20

    connexion = connecter_bdd()
    curseur = connexion.cursor()

    conditions = []
    params = []

    if q:
        conditions.append("articles.titre LIKE ?")
        params.append(f"%{q}%")
    if langue:
        conditions.append("articles.langue = ?")
        params.append(langue)
    if pays:
        conditions.append("articles.id IN (SELECT id_article FROM auteurs WHERE pays = ?)")
        params.append(pays)

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    ordre = {
        "citations": "articles.citations DESC",
        "date": "articles.date DESC",
        "alpha": "articles.titre COLLATE NOCASE ASC",
    }.get(sort, "articles.citations DESC")

    curseur.execute(f"""
        SELECT id, titre, date, langue, citations, index_inverse_compte
        FROM articles
        {where_clause}
        ORDER BY {ordre}
        LIMIT ?
    """, (*params, limite))

    lignes = curseur.fetchall()

    articles = []
    mois_compte = {}
    langues_compte = {}
    mots_compte = {}
    pays_compte = {}
    auteurs_total = set()

    for ligne in lignes:
        id_article = ligne["id"]

        curseur.execute(
            "SELECT nom, pays FROM auteurs WHERE id_article = ?", (id_article,)
        )
        auteurs = []
        for ligne_auteur in curseur.fetchall():
            auteurs.append({"nom": ligne_auteur["nom"], "pays": ligne_auteur["pays"]})
            auteurs_total.add(ligne_auteur["nom"])
            if ligne_auteur["pays"]:
                pays_compte[ligne_auteur["pays"]] = pays_compte.get(ligne_auteur["pays"], 0) + 1

        articles.append({
            "id": id_article,
            "titre": ligne["titre"],
            "date": ligne["date"],
            "langue": ligne["langue"],
            "citations": ligne["citations"],
            "auteurs": auteurs,
        })

        if ligne["date"]:
            mois = ligne["date"][:7]
            mois_compte[mois] = mois_compte.get(mois, 0) + 1

        if ligne["langue"]:
            langues_compte[ligne["langue"]] = langues_compte.get(ligne["langue"], 0) + 1

        if ligne["index_inverse_compte"]:
            try:
                index_inverse = json.loads(ligne["index_inverse_compte"])
                for mot, positions in index_inverse.items():
                    mot_normalise = mot.lower().strip()
                    if len(mot_normalise) < 4 or mot_normalise in STOPWORDS:
                        continue
                    poids = len(positions) if isinstance(positions, list) else 1
                    mots_compte[mot_normalise] = mots_compte.get(mot_normalise, 0) + poids
            except (json.JSONDecodeError, TypeError):
                pass

    connexion.close()

    top_citations = sorted(articles, key=lambda a: a["citations"] or 0, reverse=True)[:10]
    mots_cles = sorted(mots_compte.items(), key=lambda item: item[1], reverse=True)[:40]

    return jsonify({
        "articles": articles,
        "total": len(articles),
        "stats": {
            "par_mois": dict(sorted(mois_compte.items())),
            "top_citations": [
                {"titre": a["titre"], "citations": a["citations"]} for a in top_citations
            ],
            "langues": langues_compte,
            "mots_cles": [{"mot": m, "poids": p} for m, p in mots_cles],
            "pays": pays_compte,
            "total_auteurs": len(auteurs_total),
        },
    })


if __name__ == "__main__":
    # Utilisé uniquement en local (`python3 api_flask.py`).
    # En production sur Render, c'est gunicorn qui démarre l'app (voir render.yaml).
    port = int(os.environ.get("PORT", 5000))
    application.run(host="0.0.0.0", port=port, debug=True)
