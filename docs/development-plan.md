# Plan de développement

Ce plan décompose `Init project.md` sans présumer d'une capability Zepp, d'un contrat Liftosaur ou d'une commande non vérifiée.

## Règles d'exécution

- Une seule phase active à la fois; chaque lot laisse le projet exécutable.
- Écrire d'abord un test qui échoue, implémenter le minimum, puis vérifier le test et le scénario intégré.
- Toute capacité critique porte un statut `CONFIRMED`, `TESTED`, `ASSUMED`, `UNKNOWN` ou `BLOCKED`.
- Distinguer systématiquement `DOC CONFIRMED`, `EMULATOR TESTED` et `REAL DEVICE TESTED`.
- `TARGET_WATCH_MODEL = UNKNOWN` interdit toute affirmation de compatibilité matérielle.
- Le mode mock est le défaut. Toute écriture Liftosaur réelle exige une activation explicite et un scénario contrôlé.
- Aucun secret ne quitte le téléphone et aucun test ne doit exposer ou journaliser la clé API.

## Démarrer le développement

### 0. Inventorier l'environnement

- [ ] Relever OS, Node.js, gestionnaire de paquets, Zeus CLI et Zepp OS Simulator installés → verify: versions et chemins consignés dans `docs/zepp-capabilities.md`.
- [ ] Vérifier les commandes officielles actuelles de création, développement, test, build et logs → verify: seules les commandes réellement exécutées entrent dans `AGENTS.md`.
- [ ] Vérifier Developer Mode, Device Preview et accès aux logs Device App / Side Service → verify: un message de test est visible dans chaque canal disponible.
- [ ] Inventorier le dépôt et les changements locaux avant génération → verify: aucun fichier utilisateur n'est écrasé.

### 1. Établir les preuves documentaires

- [ ] Rechercher dans la documentation Zepp officielle actuelle Workout Extension, Strength Training, subtype, `DataWidget`, lifecycle, `SPORT_DATA`, `getSportData`, `isPinned`, permissions, `app.json`, UI et communication → verify: chaque conclusion a une URL, une date et un statut dans `docs/zepp-capabilities.md`.
- [ ] Rechercher dans les exemples Zepp Health officiels les patterns actuels de Workout Extension et Side Service → verify: exemple, version et écart avec le projet documentés.
- [ ] Rechercher dans la documentation Liftosaur officielle actuelle l'authentification, les programmes, l'historique, Playground, `finish_workout()` et les erreurs → verify: contrats utiles et inconnues consignés dans `docs/liftosaur-api.md`.
- [ ] Consulter le code Liftosaur uniquement pour comprendre un comportement non documenté → verify: provenance et licence notées, aucun code AGPL transplanté.

### 2. Créer le socle documentaire

- [ ] Créer `architecture.md`, `zepp-capabilities.md`, `liftosaur-api.md`, `risks.md`, `decisions.md`, `test-matrix.md` et `protocol.md` dans `docs/` → verify: chaque fichier contient son objectif, ses preuves et ses inconnues.
- [ ] Décrire les frontières System Workout / Workout Extension / Device App / Side Service / Liftosaur Cloud → verify: chaque donnée a un propriétaire unique.
- [ ] Initialiser les ADR sans accepter une décision non prouvée → verify: chaque ADR contient statut, contexte, décision, alternatives, conséquences et preuves.
- [ ] Reporter la matrice de tests émulateur/montre réelle → verify: aucune ligne matérielle n'est validée par l'émulateur seul.

### 3. Générer le squelette officiel

- [ ] Vérifier que le template officiel `WORKOUT_EXTENSION` existe dans les outils installés → verify: preuve documentaire ou sortie reproductible.
- [ ] Générer le plus petit projet compatible sans logique métier → verify: lancement dans l'environnement officiel avec la commande consignée.
- [ ] Vérifier le subtype Strength Training avant de modifier `app.json` → verify: extension visible uniquement dans le contexte attendu.
- [x] Ajouter un contrôle de qualité minimal adapté au runtime disponible → verify: `npm test` (node:test), 8 invariants `app.json`, tous passants.

### 4. Prouver la Workout Extension minimale

- [ ] Écrire un test de rendu/état pour `Liftosaur`, `HR`, `READY` et `TEST` → verify: le test échoue avant le widget.
- [ ] Implémenter le `DataWidget` minimal → verify: rendu lisible dans le simulateur.
- [ ] Brancher une donnée `SPORT_DATA` mockée sans lancer de capteur → verify: valeur visible et provenance documentée.
- [ ] Brancher `CLICK` → verify: un appui produit exactement une transition et un log stable.
- [ ] Journaliser `onInit`, `onResume`, `onPause`, `onDestroy` → verify: séquence observée et limites documentées.

### 5. Prouver le round-trip téléphone

- [ ] Définir dans `docs/protocol.md` une enveloppe v1 avec `protocolVersion`, `messageId`, `type`, `sessionId` et `payload` → verify: fixtures valide, invalide, dupliquée et hors ordre.
- [ ] Créer le Side Service minimal selon le pattern officiel actuel → verify: initialisation et logs sans secret.
- [ ] Envoyer un message de test Device → Side Service → Device → verify: même `messageId`, accusé unique et mise à jour du widget.
- [ ] Couper puis rétablir la liaison pendant le test → verify: état explicite et aucune duplication silencieuse.
- [ ] Documenter les résultats → verify: preuves classées `DOC CONFIRMED` et/ou `EMULATOR TESTED` sans promotion implicite.

## Phase 0 — Architecture spike

Objectif : lever les inconnues bloquantes avant toute logique métier complexe.

- [ ] Réaliser toutes les étapes d'initiation ci-dessus → verify: POC Workout Extension et round-trip reproductibles.
- [ ] Définir les responsabilités et flux de données → verify: `docs/architecture.md` couvre propriété, persistance et frontières réseau.
- [ ] Évaluer stockage local, stockage du secret, lifecycle, limitations UI et disponibilité background → verify: risque et niveau de preuve pour chaque capacité.
- [ ] Définir les états réseau `ONLINE`, `DEGRADED`, `OFFLINE` → verify: transitions et comportement utilisateur décrits.
- [ ] Définir les états de session et de finalisation sans les implémenter → verify: transitions invalides et reprises identifiées.
- [ ] Concevoir le spike d'alerte de repos dans `docs/rest-alert-spike.md` → verify: scénarios focus, hors focus, écran éteint, wrist down, délais, annulation et fin de workout listés.
- [ ] Renseigner les risques P0 : sélection du workout, secrets, POST ambigu, conflit programme, matériel inconnu → verify: propriétaire, mitigation et gate pour chacun.

Sortie de phase : documentation obligatoire créée, environnement vérifié, extension minimale exécutable, round-trip prouvé. Aucun accès Liftosaur en écriture.

## Phase 1 — Vertical slice mock

Objectif : terminer Bench Press 3×10 à 60 kg, repos 90 s, localement et après redémarrage.

### Modèle et state machine

- [ ] Écrire les tests de transitions `READY → ACTIVE_SET → REST → ACTIVE_SET → FINISHING` → verify: transitions invalides refusées.
- [ ] Définir une représentation unique de la prescription, de l'état courant et de la synchronisation → verify: aucune duplication entre UI et session.
- [ ] Implémenter l'écran unique et ses états nécessaires au slice → verify: aucun scroll, swipe, clavier, navigation multipage ou bouton physique requis.

### Journal et persistance

- [ ] Écrire les tests d'ordre, séquence, duplication, sérialisation et replay des événements → verify: tests d'abord rouges.
- [ ] Implémenter `WorkoutSession` et les événements nécessaires au slice → verify: replay reconstruit exactement la séance.
- [ ] Persister chaque événement critique avant la mise à jour UI → verify: fault injection entre persistance et rendu reprend sans perte.
- [ ] Protéger `COMPLETE_SET` contre le double tap → verify: deux appuis produisent un seul événement métier.

### UX et repos

- [ ] Tester les incréments poids/répétitions/RPE et leurs bornes → verify: valeurs stables, aucun artefact flottant.
- [ ] Implémenter de grandes cibles tactiles et un retour visuel immédiat → verify: scénario complet utilisable à une main dans le simulateur.
- [ ] Tester `restStartedAt`, `restDuration`, `restEndsAt` après pause et reprise → verify: temps restant dérivé de l'heure, jamais d'un compteur seul.
- [ ] Implémenter start, complete, rest, next, finish → verify: séance mock complète sans réseau.

### Recovery

- [ ] Tester redémarrage pendant série, repos et finalisation locale → verify: proposition `RESUME`/`DISCARD` correcte.
- [ ] Tester une session terminée mais non synchronisée → verify: conservation et action `RETRY`, aucune suppression automatique.

Sortie de phase : slice mock complet `EMULATOR TESTED`, journal durable et reprise démontrée.

## Phase 2 — Liftosaur en lecture seule

Objectif : charger et afficher la bonne séance réelle sans mutation Cloud.

### Secret et diagnostic

- [ ] Tester le masquage de `Authorization`, `Bearer` et `lftsk_*` → verify: aucun secret dans les logs et diagnostics.
- [ ] Implémenter la Settings App minimale et le test de connexion → verify: clé confinée au téléphone; nature du stockage documentée sans promesse non prouvée.

### Client API

- [ ] Capturer les vrais contrats documentés avant de coder → verify: fixtures expurgées et provenance officielle.
- [ ] Tester JSON valide/invalide, formes de body réellement observées, 400, 401, 403, 404, 422, timeout et perte réseau → verify: erreurs structurées sans secret.
- [ ] Implémenter uniquement les méthodes requises : programme courant et Playground d'abord → verify: aucun `fetch()` hors `LiftosaurApiClient`.

### Parser et sélection P0

- [ ] Capturer des fixtures Liftoscript Workouts simples et limites → verify: texte brut conservé pour recovery.
- [ ] Écrire les tests du sous-ensemble réellement nécessaire → verify: parser déterministe, séparé de l'UI.
- [ ] Établir l'algorithme de prochaine séance depuis les données publiques disponibles → verify: première séance, jour/semaine suivants, programme mono/multi-semaines, saut, répétition, historique supprimé, nouveau programme et programme modifié.
- [ ] Afficher programme, semaine, jour, nom et `START`/`CHANGE` → verify: une déduction erronée reste récupérable.

Sortie de phase : vraie séance affichée en lecture seule; toutes les écritures restent désactivées.

## Phase 3 — Workout dynamique

Objectif : rejouer le journal via Playground et réconcilier uniquement le futur.

- [ ] Tester la conversion événements → commandes sur contrats Playground vérifiés → verify: ordre et indexation reproductibles.
- [ ] Rejouer baseline + week/day + journal après validation d'un set → verify: résultat serveur associé à la bonne session et révision.
- [ ] Tester `update: custom()` modifiant reps, poids, RPE, timer et nombre de sets futurs → verify: sets terminés inchangés, futurs réconciliés.
- [ ] Tester warmups et indexation réelle → verify: distinction visuelle et commandes exactes.
- [ ] Tester supersets selon la sémantique observée → verify: ordre inter-exercices correct.
- [ ] Tester AMRAP, plages de reps, RPE et actual vs target → verify: aucune réduction de `8-12` à une valeur unique.
- [ ] Tester kg/lb et valeurs décimales → verify: unité préservée et représentation stable.
- [ ] Vérifier si Playground applique déjà équipement et arrondis → verify: aucun algorithme local dupliqué sans nécessité.
- [ ] Tester offline puis reconnexion → verify: actions conservées, prescriptions dynamiques marquées en attente, replay et réconciliation déterministes.
- [ ] Regrouper les éditions jusqu'à `SET DONE` lorsque possible → verify: aucun spam Playground à chaque incrément.

Sortie de phase : workout dynamique fiable, toujours sans commit d'historique ou de programme.

## Phase 4 — Historique contrôlé

Objectif : créer une seule entrée d'historique malgré les réponses réseau ambiguës.

- [ ] Obtenir une autorisation explicite d'activer le mode réel pour un scénario contrôlé → verify: périmètre et données de test identifiés.
- [ ] Écrire les tests de finalisation jusqu'à `HISTORY_PENDING`/`HISTORY_COMMITTED` → verify: state machine persistée.
- [ ] Tester succès, 4xx, 5xx, timeout avant envoi, timeout après envoi et réponse invalide → verify: seule une absence certaine autorise un nouvel envoi.
- [ ] Implémenter `createHistory()` selon le contrat officiel → verify: `historyId` persisté avant l'étape suivante.
- [ ] Passer à `UNKNOWN_COMMIT_STATE` après réponse perdue → verify: aucun retry aveugle.
- [ ] Rechercher l'entrée attendue dans l'historique récent avant retry → verify: entrée existante récupérée, absence établie avant repost.
- [ ] Tester crash et redémarrage à chaque transition → verify: zéro perte et zéro doublon.

Sortie de phase : historique réel contrôlé, récupérable et sans duplication observée.

## Phase 5 — Progression et conflits

Objectif : terminer la transaction non atomique sans écraser un programme distant.

- [ ] Persister `baselineProgramText` et son hash au démarrage → verify: valeurs disponibles après crash.
- [ ] Tester `finish_workout()` et la conservation de `workout` + `updatedProgramText` → verify: transition `PLAYGROUND_FINISHED` persistée.
- [ ] Relire le programme distant avant écriture → verify: comparaison à la baseline juste avant commit.
- [ ] Tester une modification concurrente → verify: état `CONFLICT`, aucun PUT, baseline/current/proposed conservés.
- [ ] Implémenter l'ordre history puis program → verify: crash entre chaque étape reprend sans dupliquer l'historique.
- [ ] Tester deux sessions, double tap, reconnexion tardive et retry après redémarrage → verify: state machine refuse les commits concurrents incohérents.
- [ ] Utiliser immédiatement une primitive officielle conditionnelle si elle existe → verify: preuve documentaire et test de conflit.

Sortie de phase : historique et progression synchronisés ou conflit explicite; jamais de last-write-wins silencieux.

## Phase 6 — Alertes de repos

Objectif : choisir puis prouver le mécanisme d'alerte hors focus.

- [ ] Tester officiellement Alarm, App Service, timer système, notification et vibration selon disponibilité → verify: permissions et limites consignées.
- [ ] Mesurer focus, hors focus, autre écran workout, écran éteint, wrist down et AOD disponible → verify: résultats séparés émulateur/montre.
- [ ] Tester 30 s, 2 min, timers multiples, annulation et workout terminé → verify: aucune alerte obsolète.
- [ ] Mesurer la batterie si un App Service est nécessaire → verify: décision fondée sur mesure réelle.
- [ ] Consigner le choix en ADR → verify: alternative la plus simple compatible avec les preuves retenue.

Sortie de phase : alerte fiable `REAL DEVICE TESTED`; sinon capability `BLOCKED` avec preuve.

## Phase 7 — Durcissement montre réelle

Gate : modèle, firmware, forme, résolution, Strength Training et Workout Extension vérifiés sur la montre cible.

- [ ] Lever `TARGET_WATCH_MODEL` dans `docs/zepp-capabilities.md` → verify: modèle et firmware exacts consignés.
- [ ] Exécuter toute `docs/test-matrix.md` → verify: résultat et preuve pour chaque ligne matérielle.
- [ ] Tester BLE, Internet, écran, background Zepp, fermeture forcée et reprise → verify: aucune perte ou corruption.
- [ ] Vérifier que Zepp conserve son workout natif et Liftosaur son historique musculation → verify: deux résultats présents sans second capteur/workout.
- [ ] Mesurer tap→UI, persistance, watch→phone et aller-retour Cloud → verify: mesures documentées, UI non bloquée par le réseau.
- [ ] Mesurer batterie et fréquence de rafraîchissement → verify: fonctionnement événementiel, aucun polling agressif.

Sortie de phase : matrice hardware complétée et risques restants explicités.

## Phase 8 — UX, diagnostics et préparation V1

- [ ] Tester lisibilité, contraste, tailles de cible et usage à une main en effort → verify: observations sur écran cible réel.
- [ ] Afficher connexion montre, API Liftosaur, programme, dernière synchro, session en attente, versions protocole/app → verify: chaque statut vient d'une source autoritative.
- [ ] Ajouter l'export seulement s'il reste simple → verify: aucun secret ni donnée inutile dans le fichier.
- [ ] Transformer les erreurs techniques en messages montre courts tout en gardant le détail sanitizé côté téléphone → verify: scénarios 401, 422, offline, conflit et réponse ambiguë.
- [ ] Nettoyer code, logs et documentation → verify: commandes de test/build vérifiées passent, aucun code mort ou log de debug.
- [ ] Rejouer la Definition of Done V1 complète → verify: 21 critères tracés dans la matrice.

## Gates de sortie V1

- [ ] La bonne séance est proposée et modifiable avant démarrage.
- [ ] Poids, reps et RPE sont éditables rapidement sans clavier.
- [ ] Validation locale, repos et navigation restent immédiats sans réseau.
- [ ] Warmups, supersets, AMRAP, plages, unités et `update: custom()` sont respectés.
- [ ] L'alerte de repos hors focus est prouvée sur montre réelle.
- [ ] Zepp sauvegarde son workout natif et Liftosaur son historique/progression.
- [ ] Réponse perdue, offline, crash et redémarrage ne perdent ni ne dupliquent la séance.
- [ ] Une modification concurrente ne peut pas être écrasée silencieusement.
- [ ] La clé reste sur le téléphone et absente des logs/diagnostics.
- [ ] Toute capability critique possède ses preuves `DOC CONFIRMED`, `EMULATOR TESTED`, `REAL DEVICE TESTED` ou un état bloquant explicite.

## Rapport de milestone

```text
DONE
- résultat livré

VERIFIED
- test, commande ou scénario observé

OPEN RISKS
- inconnue et prochain moyen de preuve

NEXT
- prochain lot unique
```
