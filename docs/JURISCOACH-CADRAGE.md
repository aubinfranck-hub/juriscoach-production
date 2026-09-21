# JurisCoach — Cadrage produit et garde-fous

## 1. Positionnement

JurisCoach est un **assistant juridique** destiné à informer, orienter, analyser des situations et aider l'utilisateur à préparer et organiser un dossier.

JurisCoach n'est pas un tribunal, un greffe, une juridiction ni un système de gestion judiciaire institutionnel.

## 2. Périmètre fonctionnel

- Questions juridiques en langage naturel.
- Assistant conversationnel texte et vocal.
- Recherche dans les référentiels juridiques intégrés.
- Diagnostic guidé : faits, questions de clarification, qualification à vérifier, textes applicables, pièces utiles, informations manquantes.
- Dossiers personnels de préparation.
- Chronologie des faits.
- Ajout et classement de pièces justificatives.
- Préparation de documents et modèles, avec indication lorsqu'une revue professionnelle est nécessaire.
- Historique des analyses et dossiers.
- Modules thématiques, notamment travail, pénal, logement/baux, famille, affaires/OHADA et documents juridiques selon le périmètre produit retenu.
- Espace professionnel/PME et services partenaires selon les fonctionnalités prévues au cahier des charges.

## 3. Droit du travail

Le module Travail permet notamment de :

1. décrire une situation ;
2. répondre aux questions de clarification ;
3. rechercher dans le Code du Travail ;
4. identifier les faits restant à vérifier ;
5. constituer une préparation de dossier ;
6. construire une chronologie ;
7. réunir les pièces ;
8. produire une synthèse préparatoire ;
9. marquer le dossier comme prêt pour revue par l'utilisateur ou son conseil.

Les états du dossier dans JurisCoach sont uniquement des **états de préparation applicative** :
- BROUILLON
- PREPARATION
- PRET_A_REVUE

Ils ne constituent pas des statuts judiciaires.

## 4. Frontière avec e-Travail

Les fonctions institutionnelles telles que réception officielle d'une saisine, attribution à un greffe ou à un magistrat, convocation, audience, décision, clôture judiciaire et suivi institutionnel appartiennent au projet **e-Travail** lorsqu'elles sont définies et validées par l'institution compétente.

Aucune API JurisCoach ne doit transformer une préparation utilisateur en saisine officielle.

## 5. Principes IA

L'IA :
- distingue les faits fournis des règles juridiques ;
- cite les sources disponibles ;
- signale les informations manquantes ;
- ne doit pas inventer un article, un délai, une peine, une compétence ou une formalité ;
- ne rend pas de décision ;
- ne prédit pas l'issue d'un litige ;
- signale lorsqu'une vérification professionnelle ou institutionnelle est nécessaire.

## 6. Référentiels juridiques

Les sources juridiques doivent être versionnées et identifiées par :
- juridiction/pays ;
- texte ;
- référence ;
- version/édition ;
- source officielle lorsque disponible ;
- statut de validation.

Pour le Code du Travail ivoirien actuellement intégré, l'application conserve l'indication que le corpus doit être validé institutionnellement avant d'être présenté comme une base consolidée officielle.

## 7. Documents

Les pièces personnelles appartiennent au dossier utilisateur. Le système doit permettre :
- nom et type ;
- fichier ;
- taille et type MIME ;
- date d'ajout ;
- indication « à vérifier/requise » ;
- association au dossier et, à terme, à un événement de la chronologie.

Les documents générés par IA sont des **brouillons préparatoires** tant qu'une validation humaine n'est pas effectuée.

## 8. Sécurité

- Authentification obligatoire pour les dossiers.
- Isolation stricte par utilisateur.
- Aucun accès à un dossier d'un autre utilisateur.
- Limitation de taille des fichiers.
- Journalisation technique.
- Protection des données personnelles.
- Pas d'exposition publique des pièces.

## 9. Hors périmètre JurisCoach

Ne pas ajouter au produit sans nouveau cadrage explicite :
- Greffe ;
- saisine officielle ;
- numéro judiciaire officiel ;
- attribution magistrat ;
- convocation institutionnelle ;
- audience ;
- décision judiciaire ;
- clôture judiciaire ;
- validation judiciaire ;
- changement d'état judiciaire.

## 10. Principe directeur

**JurisCoach prépare et accompagne. e-Travail gère le processus institutionnel.**
