# Récupère, pour chaque candidat, la photo principale de sa fiche Wikidata (image libre de droits hébergée
# sur Wikimedia Commons), ses informations de crédit et de licence, et quelques autres photos libres pour comparaison.
# Lancé par GitHub Actions (le réseau de l'atelier de travail ne joint pas Wikimedia).
import html
import json
import os
import re
import time
import urllib.parse
import urllib.request

UA = "Programmes2027-photos/1.0 (https://github.com/2027ProjetsMCEP/Programme---2027)"
WD = "https://www.wikidata.org/w/api.php"
CM = "https://commons.wikimedia.org/w/api.php"


def get(url, tries=4):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if k == tries - 1:
                raise
            time.sleep(2 + 3 * k)


def api(base, **params):
    params["format"] = "json"
    params["formatversion"] = "2"
    time.sleep(0.3)
    return json.loads(get(base + "?" + urllib.parse.urlencode(params)))


def text(h):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h or ""))).strip()


def file_info(name, width):
    r = api(CM, action="query", titles="File:" + name, prop="imageinfo",
            iiprop="url|size|mime|extmetadata", iiurlwidth=width, iiextmetadatalanguage="fr")
    pages = r["query"]["pages"]
    if not pages or "imageinfo" not in pages[0]:
        return None
    ii = pages[0]["imageinfo"][0]
    m = ii.get("extmetadata", {})
    v = lambda k: m.get(k, {}).get("value", "")
    return {
        "fichier": name,
        "page": ii.get("descriptionurl"),
        "url": ii.get("thumburl") or ii.get("url"),
        "largeur": ii.get("width"), "hauteur": ii.get("height"), "mime": ii.get("mime"),
        "auteur": text(v("Artist")),
        "credit": text(v("Credit")),
        "licence": text(v("LicenseShortName")),
        "licenceUrl": text(v("LicenseUrl")),
        "conditions": text(v("UsageTerms")),
        "attribution": text(v("Attribution")),
        "attributionRequise": text(v("AttributionRequired")),
        "restrictions": text(v("Restrictions")),
        "date": text(v("DateTimeOriginal")),
        "description": text(v("ImageDescription"))[:400],
    }


def save(url, path):
    with open(path, "wb") as f:
        f.write(get(url))


def claims(ent, p):
    out = []
    for s in ent.get("claims", {}).get(p, []):
        dv = s.get("mainsnak", {}).get("datavalue")
        if dv:
            out.append(dv["value"])
    return out


cands = json.load(open("candidats.json"))
overrides = json.load(open("choix.json")) if os.path.exists("choix.json") else {}
# « _seulement » : ne traiter que les candidats listés dans choix.json, sans les photos de comparaison
ONLY = overrides.pop("_seulement", False)
if ONLY:
    cands = [c for c in cands if c["id"] in overrides]
os.makedirs("photos/raw", exist_ok=True)
res = []
for c in cands:
    rec = {"id": c["id"], "nom": c["nom"], "recherche": [], "choisi": None, "photo": None, "autres": []}
    try:
        ov = overrides.get(c["id"], {})
        if ov.get("qid"):
            ids = [ov["qid"]]
        else:
            r = api(WD, action="wbsearchentities", search=c["nom"], language="fr", uselang="fr", type="item", limit=6)
            ids = [x["id"] for x in r.get("search", [])]
        if ids:
            e = api(WD, action="wbgetentities", ids="|".join(ids), props="claims|descriptions|labels|sitelinks",
                    languages="fr", sitefilter="frwiki")
            for i in ids:
                ent = e["entities"].get(i, {})
                p31 = [x.get("id") for x in claims(ent, "P31")]
                p106 = [x.get("id") for x in claims(ent, "P106")]
                rec["recherche"].append({
                    "qid": i,
                    "label": ent.get("labels", {}).get("fr", {}).get("value"),
                    "desc": ent.get("descriptions", {}).get("fr", {}).get("value", ""),
                    "humain": "Q5" in p31,
                    "politicien": "Q82955" in p106,
                    "p18": claims(ent, "P18"),
                    "naissance": [x.get("time") for x in claims(ent, "P569")],
                    "frwiki": ent.get("sitelinks", {}).get("frwiki", {}).get("title"),
                })
        if ov.get("fichier"):
            fichier, qid = ov["fichier"], ov.get("qid")
        else:
            fichier = qid = None
            for x in rec["recherche"]:
                if x["humain"] and x["p18"] and (x["politicien"] or "politi" in x["desc"].lower() or ov.get("qid")):
                    fichier, qid = x["p18"][0], x["qid"]
                    break
        rec["choisi"] = qid
        if fichier:
            info = file_info(fichier, 1000)
            if info:
                ext = ".png" if info["mime"] == "image/png" else ".jpg"
                save(info["url"], "photos/raw/" + c["id"] + ext)
                info["local"] = "photos/raw/" + c["id"] + ext
                rec["photo"] = info
        if ONLY:
            res.append(rec)
            print(c["id"], (rec["photo"] or {}).get("fichier"), flush=True)
            continue
        # Autres photos libres de la même personne, pour pouvoir choisir un portrait officiel si besoin
        s = api(CM, action="query", list="search", srsearch='"' + c["nom"] + '" filetype:bitmap', srnamespace=6, srlimit=8)
        alts = [x["title"][5:] for x in s.get("query", {}).get("search", [])]
        os.makedirs("photos/autres/" + c["id"], exist_ok=True)
        for k, name in enumerate(alts):
            info = file_info(name, 360)
            if not info or not info["url"]:
                continue
            ext = ".png" if info["mime"] == "image/png" else ".jpg"
            p = "photos/autres/%s/%d%s" % (c["id"], k, ext)
            try:
                save(info["url"], p)
                info["local"] = p
            except Exception as e:  # noqa: BLE001
                info["erreur"] = str(e)
            rec["autres"].append(info)
    except Exception as e:  # noqa: BLE001
        rec["erreur"] = repr(e)
    res.append(rec)
    print(c["id"], rec["choisi"], (rec["photo"] or {}).get("fichier"), len(rec["autres"]), rec.get("erreur", ""), flush=True)

json.dump(res, open("resultats_choix.json" if ONLY else "resultats.json", "w"), ensure_ascii=False, indent=1)
