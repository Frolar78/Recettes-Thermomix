"""
Récupère sur cookidoo.fr la durée réelle de chaque recette du catalogue (index.html)
et l'ajoute dans index.html sous la forme d:<minutes totales>, p:<minutes de préparation>.

Usage : python scripts/cookidoo_durees.py          (relance possible : reprend le cache)
"""
import json, re, sys, time, urllib.request
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
INDEX = RACINE / "index.html"
CACHE = RACINE / "scripts" / "cookidoo_durees.json"
BASE = "https://cookidoo.fr/recipes/recipe/fr-FR/"


def minutes(iso):
    """PT1H25M -> 85"""
    if not iso:
        return None
    m = re.fullmatch(r"P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?", iso)
    if not m:
        return None
    return int(m.group(1) or 0) * 60 + int(m.group(2) or 0)


def lire(uid):
    req = urllib.request.Request(BASE + uid, headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "fr-FR"})
    html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    def champ(k):
        m = re.search(r'"%s"\s*:\s*"([^"]*)"' % k, html)
        return m.group(1) if m else None
    return {"total": minutes(champ("totalTime")), "prep": minutes(champ("prepTime")), "nom": champ("name")}


def main():
    src = INDEX.read_text(encoding="utf-8")
    ids = list(dict.fromkeys(re.findall(r'\{u:"(r\d+)"', src)))
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    for n, uid in enumerate(ids, 1):
        if uid in cache and cache[uid].get("total") is not None:
            continue
        try:
            cache[uid] = lire(uid)
        except Exception as e:
            cache[uid] = {"erreur": str(e)}
        print(n, "/", len(ids), uid, cache[uid], flush=True)
        CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
        time.sleep(0.6)

    # injection dans index.html : {u:"r123",...,n:"4.8"} -> ...,n:"4.8",d:25,p:10}
    def ajoute(m):
        bloc, uid = m.group(0), m.group(1)
        bloc = re.sub(r',d:\d+,p:\d+\}$', '}', bloc)
        info = cache.get(uid, {})
        if info.get("total"):
            bloc = bloc[:-1] + ",d:%d,p:%d}" % (info["total"], info.get("prep") or info["total"])
        return bloc
    src = re.sub(r'\{u:"(r\d+)"[^\n]*?\}(?=,?\s*\n)', ajoute, src)
    INDEX.write_text(src, encoding="utf-8")
    manquants = [u for u in ids if not cache.get(u, {}).get("total")]
    print("Terminé :", len(ids) - len(manquants), "durées /", len(ids), "— sans durée :", manquants)


if __name__ == "__main__":
    sys.exit(main())
