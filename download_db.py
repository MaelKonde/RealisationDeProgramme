"""
Nom........ : download_db.py
Description : Télécharge bdd.db (~1 Go) depuis une Release GitHub au moment du build Render.
              Le disque de Render est reconstruit à chaque déploiement, donc ce
              script s'exécute avant chaque démarrage du service.
Usage...... : python download_db.py
HELP : https://stackoverflow.com/questions/58731187/how-to-download-a-github-release-asset-from-a-private-repository-in-python 
       https://blog.pythonlibrary.org/2025/04/07/how-to-download-the-latest-release-assets-from-github-with-python/
       https://gist.github.com/pdashford/2e4bcd4fc2343e2fd03efe4da17f577d
       https://pypi.org/project/PyGithub/
"""
import os
import sys
import urllib.request

DB_URL = os.environ.get(
    "DB_DOWNLOAD_URL",
    "https://github.com/MaelKonde/RealisationDeProgramme/releases/download/v1-db/bdd.db",
)
OUTPUT = "bdd.db"


def main() -> None:
    print(f"Téléchargement de {OUTPUT} depuis {DB_URL} ...")

    try:
        # GitHub Releases redirige vers un lien de stockage signé (302) ;
        # urllib suit les redirections automatiquement.
        req = urllib.request.Request(DB_URL, headers={"User-Agent": "render-build"})
        with urllib.request.urlopen(req) as reponse, open(OUTPUT, "wb") as fichier:
            taille_totale = reponse.getheader("Content-Length")
            taille_totale = int(taille_totale) if taille_totale else None
            telecharge = 0
            bloc = 1024 * 1024  # 1 Mo

            while True:
                morceau = reponse.read(bloc)
                if not morceau:
                    break
                fichier.write(morceau)
                telecharge += len(morceau)
                if taille_totale:
                    pourcent = telecharge / taille_totale * 100
                    print(f"  {telecharge / (1024*1024):.0f} Mo / {taille_totale / (1024*1024):.0f} Mo ({pourcent:.0f}%)", end="\r")

        print()
    except Exception as exc:
        print(f"ERREUR : le téléchargement a échoué : {exc}", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(OUTPUT) or os.path.getsize(OUTPUT) < 1024:
        print("ERREUR : le fichier téléchargé est vide ou introuvable.", file=sys.stderr)
        sys.exit(1)

    taille_mo = os.path.getsize(OUTPUT) / (1024 * 1024)
    print(f"OK : {OUTPUT} téléchargé ({taille_mo:.1f} Mo).")


if __name__ == "__main__":
    main()