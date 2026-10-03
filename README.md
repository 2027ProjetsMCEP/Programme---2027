# Programmes 2027

Une appli web, gratuite et sans compte, pour savoir ce que proposent les candidats à l'élection présidentielle de 2027, avec les sources.

- **Actu** : les articles de presse sur la campagne.
- **Candidats** : une fiche par candidat déclaré, ses propositions résumées en une phrase et reliées à leur source.
- **Vidéos** : une proposition par écran, dans un ordre tiré au hasard.
- **Comparer** : deux candidats côte à côte, ou tous les candidats sur un même sujet.
- **Sondages** : en dernier onglet, expliqués avant les chiffres.

Chaque proposition porte un statut de financement : chiffrée et financée, chiffrée sans financement trouvé, aucun chiffrage trouvé, ou sans dépense directe.

## Principes

- Pas de consigne de vote, pas de note, pas de classement.
- Même présentation pour tous les candidats, ordre alphabétique ou tiré au sort de façon équilibrée.
- Aucune collecte de données personnelles, aucun compte.
- Aucun financement de partis ou de candidats.

## Fonctionnement

- `index.html` : l'appli.
- `data.json` : toutes les données (candidats, propositions, sources, actu, sondages). Une mise à jour ne modifie que ce fichier.
- `sw.js` et `manifest.webmanifest` : installation sur l'écran d'accueil et lecture hors connexion.

Chaque mise à jour est relue avant publication. Les textes des propositions sont des résumés : le texte d'origine reste accessible par le lien vers la source.

## Signaler une erreur

Ouvrez une « issue » sur ce dépôt en indiquant la proposition concernée et, si possible, la source qui la corrige.
