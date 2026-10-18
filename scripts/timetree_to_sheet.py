"""Lit l'export TimeTree (.ics), garde les 14 prochains jours et les envoie au Google Sheet.

Variables d'environnement :
  ICS_PATH        chemin du fichier .ics produit par timetree-exporter (défaut : timetree.ics)
  SHEET_ENDPOINT  URL de l'Apps Script déployé en application web
  SHEET_TOKEN     jeton partagé, vérifié par l'Apps Script
  DRY_RUN=1       affiche le JSON sans l'envoyer
"""
import json
import os
import sys
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import recurring_ical_events
import requests
from icalendar import Calendar

TZ = ZoneInfo("Europe/Paris")
JOURS = 14


def to_local(value):
    """Renvoie (date, heure 'HH:MM' ou '', journée entière)."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=TZ)
        value = value.astimezone(TZ)
        return value.date(), value.strftime("%H:%M"), False
    return value, "", True


def main():
    ics_path = os.environ.get("ICS_PATH", "timetree.ics")
    with open(ics_path, "rb") as f:
        cal = Calendar.from_ical(f.read())

    debut = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    fin = debut + timedelta(days=JOURS)

    evenements = []
    for ev in recurring_ical_events.of(cal).between(debut, fin):
        d_debut, h_debut, journee = to_local(ev.get("DTSTART").dt)
        fin_brute = ev.get("DTEND").dt if ev.get("DTEND") else ev.get("DTSTART").dt
        d_fin, h_fin, _ = to_local(fin_brute)
        if journee and isinstance(d_fin, date) and d_fin > d_debut:
            d_fin = d_fin - timedelta(days=1)  # DTEND exclusif en iCal
        evenements.append({
            "date": d_debut.isoformat(),
            "date_fin": d_fin.isoformat(),
            "debut": h_debut,
            "fin": h_fin,
            "journee": journee,
            "titre": str(ev.get("SUMMARY", "")).strip(),
            "lieu": str(ev.get("LOCATION", "")).strip(),
        })

    evenements.sort(key=lambda e: (e["date"], e["debut"]))
    payload = {
        "token": os.environ.get("SHEET_TOKEN", ""),
        "synchro": datetime.now(TZ).isoformat(timespec="minutes"),
        "evenements": evenements,
    }

    if os.environ.get("DRY_RUN") == "1":
        print(json.dumps({**payload, "token": "***"}, ensure_ascii=False, indent=2))
        return

    r = requests.post(os.environ["SHEET_ENDPOINT"], data=json.dumps(payload),
                      headers={"Content-Type": "text/plain"}, timeout=60)
    r.raise_for_status()
    print(f"{len(evenements)} événements envoyés — réponse : {r.text[:200]}")
    if '"ok":true' not in r.text.replace(" ", ""):
        sys.exit("L'Apps Script n'a pas confirmé l'écriture.")


if __name__ == "__main__":
    main()
