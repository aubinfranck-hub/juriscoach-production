# Code du Travail ivoirien dans JurisCoach

Source intégrée : Loi n° 2015-532 du 20 juillet 2015 portant Code du Travail, édition 2021 (519 pages).

- Référentiel : legal/code-travail-2021.json
- Module serveur : server/workCode.ts
- API : /api/legal/work-code/status et /api/legal/work-code/search?q=...
- Interface : onglet « Code du travail » dans JurisCoach.
- Le module utilise le corpus local s'il est présent et peut sinon télécharger le PDF officiel à la demande.

Statut initial : A_VALIDER_PAR_LE_TRIBUNAL.
