# Projet : client Liftosaur Cloud pour Amazfit / Zepp OS

Tu es le Lead Software Engineer et Software Architect responsable de ce projet.

Ton objectif est de concevoir puis développer une intégration permettant d'utiliser Liftosaur Cloud directement depuis une montre Amazfit pendant un entraînement Zepp OS, avec une expérience aussi rapide, fiable et simple qu'une intégration native.

Le propriétaire du projet n'est PAS propriétaire de Liftosaur et ne peut modifier ni Liftosaur Cloud, ni son application Android/iOS, ni son backend.

Liftosaur doit être considéré comme un système externe immuable.

Nous devons utiliser exclusivement ses interfaces publiques/documentées pour l'intégration fonctionnelle.

Le projet doit privilégier :

1. fiabilité ;
2. simplicité ;
3. faible maintenance ;
4. sécurité des données ;
5. excellente UX sur montre ;
6. comportement déterministe ;
7. récupération après erreur ;
8. absence de perte de séance.

Ne développe pas une réimplémentation de Liftosaur.

---

# 1. Sources de vérité

Avant de coder une fonctionnalité liée à Zepp OS ou Liftosaur :

1. consulter la documentation officielle Zepp OS actuelle sur `docs.zepp.com` ;
2. consulter la documentation officielle REST API et Liftoscript actuelle de Liftosaur ;
3. utiliser les exemples officiels Zepp Health lorsqu'ils existent ;
4. éventuellement consulter le dépôt GitHub officiel de Liftosaur pour comprendre son comportement ;
5. ne jamais considérer un blog, forum ou exemple tiers comme supérieur à la documentation officielle.

Les APIs et capabilities évoluent.

Ne suppose pas qu'une API existe parce qu'elle paraît logique.

Ne suppose pas non plus qu'une capacité documentée pour une Mini Program classique fonctionne identiquement dans une Workout Extension.

Pour toute capacité critique, fournir une preuve documentaire ou un test reproductible.

---

# 2. Contrainte Liftosaur

Liftosaur Cloud reste la source de vérité pour :

* programme ;
* Liftoscript ;
* progression ;
* historique ;
* exercices ;
* configuration métier.

Nous ne possédons pas le backend.

Ne pas :

* modifier Liftosaur ;
* forker Liftosaur comme architecture principale ;
* dépendre d'une modification upstream ;
* scraper l'UI web ;
* utiliser les cookies de session ;
* détourner le login ;
* communiquer avec l'application Android Liftosaur via hack/deep link privé ;
* dépendre d'endpoints non documentés si une API publique permet de faire le travail.

Utiliser l'API REST officielle Liftosaur avec une API key utilisateur.

---

# 3. Contrainte licence

Le dépôt officiel Liftosaur est actuellement sous licence AGPL-3.0.

Tu peux l'étudier pour comprendre le comportement attendu.

Ne copie pas ou ne transplante pas de code Liftosaur dans ce projet sans :

1. identifier précisément la licence du code concerné ;
2. documenter les implications ;
3. obtenir une décision explicite du propriétaire du projet.

Par défaut, produire une implémentation indépendante utilisant les interfaces publiques de Liftosaur.

En particulier, ne copie pas le moteur Liftoscript.

---

# 4. Architecture cible

L'architecture de référence est :

```text
Amazfit / Zepp OS
└── System Workout
    └── Strength Training
        └── Workout Extension Liftosaur
            │
            │ BLE
            ▼
Zepp App sur téléphone
└── Side Service
    ├── communication montre
    ├── API Liftosaur
    ├── authentication
    ├── retries
    └── synchronisation
            │
            │ HTTPS
            ▼
Liftosaur Cloud REST API
```

Le System Workout Zepp doit rester responsable des données sport/santé :

* fréquence cardiaque ;
* calories ;
* durée ;
* Training Load ;
* Training Effect ;
* autres métriques natives disponibles.

Notre extension est responsable de la couche entraînement Liftosaur :

* exercice ;
* séries ;
* répétitions ;
* poids ;
* RPE ;
* warmups ;
* AMRAP ;
* supersets ;
* timers de repos ;
* progression Liftosaur ;
* synchronisation.

Ne lance pas un second workout ou un second monitoring cardiaque si le System Workout fournit déjà ces données.

---

# 5. Premier objectif : architecture spike

AVANT de développer l'application complète, créer un dossier :

```text
docs/
```

et au minimum :

```text
docs/
  architecture.md
  zepp-capabilities.md
  liftosaur-api.md
  risks.md
  decisions.md
  test-matrix.md
  protocol.md
```

Chaque hypothèse importante doit être classée :

```text
CONFIRMED
TESTED
ASSUMED
UNKNOWN
BLOCKED
```

Ne transforme jamais silencieusement `UNKNOWN` en `CONFIRMED`.

---

# 6. Gate 0 - modèle de montre

Le modèle exact de la montre cible n'est pas encore garanti.

Traiter :

```text
TARGET_WATCH_MODEL = UNKNOWN
```

comme une dépendance explicite.

Dès que le modèle est connu :

1. vérifier son Zepp OS ;
2. vérifier son API_LEVEL réel ;
3. vérifier sa résolution ;
4. vérifier sa forme ronde/carrée ;
5. vérifier officiellement la compatibilité Workout Extension ;
6. vérifier l'existence réelle du mode Strength Training ;
7. vérifier le fonctionnement sur le firmware réellement installé.

Ne conclure aucune compatibilité uniquement à partir du fait que `API_LEVEL >= 3.6`.

Documenter le résultat dans `docs/zepp-capabilities.md`.

---

# 7. Environnement

Le propriétaire installe le simulateur officiel Zepp OS.

Utiliser les outils officiels récents :

* Zepp OS Simulator ;
* Zeus CLI ;
* Developer Mode Zepp ;
* Device preview ;
* Side Service logs ;
* Device App logs.

Créer le projet depuis le template officiel `WORKOUT_EXTENSION` si celui-ci existe toujours dans la version courante des outils.

Utiliser autant que possible les patterns actuellement recommandés par Zepp, notamment ZML pour la communication Device App <-> Side Service si cela reste la recommandation officielle.

Ne partir d'anciens exemples Zepp OS 1.x que lorsqu'aucun équivalent actuel n'existe.

---

# 8. Workout Extension

Le projet cible une Workout Extension pour :

```text
Strength Training
```

Vérifier son subtype actuel dans la documentation avant implémentation.

Étudier précisément :

* DataWidget ;
* lifecycle ;
* onInit ;
* build ;
* onResume ;
* onPause ;
* onDestroy ;
* SPORT_DATA ;
* getSportData ;
* isPinned ;
* restrictions UI ;
* permissions ;
* app.json.

Créer une preuve de concept extrêmement petite avant toute autre fonctionnalité.

Elle doit afficher :

```text
Liftosaur

HR: <sport data>
Status: READY

[ TEST ]
```

Le bouton doit fonctionner dans l'émulateur.

Le lifecycle doit produire des logs.

---

# 9. Restrictions UI

Traiter la Workout Extension comme un écran unique.

Ne pas construire une architecture nécessitant :

* scroll ;
* navigation multipage ;
* swipe ;
* gestes ;
* bouton physique ;
* longue liste scrollable.

Si ces restrictions ont changé dans une documentation Zepp plus récente, documenter précisément la nouvelle capability avant de l'utiliser.

Construire une state machine UI, par exemple :

```text
LOADING
READY
ACTIVE_SET
EDIT_REPS
EDIT_WEIGHT
EDIT_RPE
REST
OFFLINE
FINISHING
SYNCED
CONFLICT
ERROR
```

Le DataWidget se redessine en fonction de l'état.

---

# 10. UX fondamentale

L'interface doit être conçue pour être utilisée :

* rapidement ;
* d'une main ;
* essoufflé ;
* avec de grands targets tactiles ;
* sans saisie texte dans le chemin principal.

Éviter de dépendre d'un clavier.

Valeurs éditables via contrôles tactiles.

Exemple conceptuel :

```text
INCLINE BENCH

SET 2 / 3

75 kg
13 reps
RPE 8

[ WEIGHT ] [ REPS ]
[   RPE  ] [ DONE ]
```

Le détail précis est à prototyper dans le simulateur.

Priorité à la lisibilité plutôt qu'à la densité d'information.

---

# 11. Communication

La Device App / Workout Extension ne doit PAS communiquer directement avec Liftosaur Cloud si l'architecture Zepp recommandée passe par le Side Service.

Chemin attendu :

```text
Watch
→ BLE/ZML
→ Side Service
→ HTTPS
→ Liftosaur
```

Créer un protocole applicatif versionné.

Exemple :

```json
{
  "protocolVersion": 1,
  "messageId": "...",
  "type": "COMPLETE_SET",
  "sessionId": "...",
  "payload": {}
}
```

Chaque message critique doit posséder un identifiant unique.

Documenter le protocole dans :

```text
docs/protocol.md
```

---

# 12. Authentification

Créer une Settings App minimale permettant :

```text
Liftosaur API Key
[********************]

[ Test connection ]

Status: Connected
```

L'API key :

* ne doit jamais être hardcodée ;
* ne doit jamais être commitée ;
* ne doit jamais apparaître dans les logs ;
* ne doit jamais être copiée sur la montre ;
* ne doit jamais apparaître dans un message BLE ;
* doit rester côté téléphone.

Ajouter un redactor de logs qui masque systématiquement :

```text
Authorization
Bearer
lftsk_*
```

Si le stockage Zepp disponible n'est pas documenté comme stockage sécurisé/chiffré, le signaler explicitement dans `docs/risks.md`.

Ne prétends jamais qu'un secret est matériellement sécurisé sans preuve.

---

# 13. API client Liftosaur

Créer une couche dédiée :

```text
LiftosaurApiClient
```

Pas de `fetch()` disséminé dans le code métier.

Au minimum :

```text
getCurrentProgram()
getPrograms()
getHistory()
createHistory()
updateProgram()
playground()
getGyms()
getEquipment()
```

Ne pas implémenter automatiquement tous les endpoints.

Implémenter uniquement ceux nécessaires au scope courant.

Le client doit gérer :

* Authorization Bearer ;
* JSON ;
* body pouvant éventuellement arriver sous plusieurs formes selon le Fetch Zepp ;
* erreurs HTTP ;
* timeout applicatif ;
* retries contrôlés ;
* 401 ;
* 403 ;
* 400 ;
* 404 ;
* 422 ;
* réponses invalides ;
* perte réseau ;
* logs sanitizés.

Ne jamais retry aveuglément un POST non idempotent.

---

# 14. Mode Mock obligatoire

Le développement ne doit pas muter le véritable programme Liftosaur pendant les premiers tests.

Créer :

```text
LIFTOSAUR_MODE=mock
LIFTOSAUR_MODE=real
```

ou architecture équivalente.

Le mode Mock doit fournir des fixtures couvrant :

```text
simple 3x10
warmups
RPE
AMRAP
rep ranges
different timers
superset
update custom
progress custom
changed weights
failed network
invalid Liftoscript
conflict
```

Le mode réel n'est activé qu'explicitement.

---

# 15. Playground comme moteur

Ne réimplémente pas Liftoscript dans la montre.

Étudier soigneusement l'endpoint officiel Playground.

Le modèle privilégié est :

```text
baseline programText
+
week/day
+
command log
→ playground
→ workout
```

Les interactions utilisateur deviennent des commandes Liftosaur.

Exemples conceptuels :

```text
change_reps(...)
change_weight(...)
change_rpe(...)
complete_set(...)
```

Après chaque set important, le Side Service peut rejouer l'ensemble du command log contre le baseline.

Le résultat serveur est ensuite renvoyé à la montre pour réconciliation.

---

# 16. `update: custom()`

Considérer `update: custom()` comme une fonctionnalité critique.

Elle peut modifier le workout en cours après la validation d'un set.

Par conséquent :

NE PAS considérer la séance générée au démarrage comme immuable.

Après un `complete_set`, le résultat Playground peut changer :

* reps futures ;
* poids futurs ;
* RPE ;
* timer ;
* nombre de sets ;
* AMRAP ;
* autres propriétés supportées.

Le client doit mettre à jour uniquement les sets non terminés à partir du nouvel état serveur.

Les sets déjà validés restent déterminés par l'event log local.

Créer des tests spécifiques.

---

# 17. Parsing

L'API Liftosaur retourne notamment du texte au format Liftoscript Workouts.

Créer un module séparé :

```text
WorkoutParser
```

Ne mélange pas parsing et UI.

Le parser doit être :

* déterministe ;
* testé ;
* tolérant aux espaces/lignes selon le format documenté ;
* strict sur les constructions réellement nécessaires.

Ne crée pas un parser complet Liftoscript si seuls les Liftoscript Workouts sont nécessaires.

Conserver également le texte brut retourné par Liftosaur pour debugging/recovery.

---

# 18. Sélection du workout à lancer

Ceci est un P0.

Ne suppose pas que :

```text
week = 1
day = 1
```

est correct.

Déterminer comment Liftosaur sélectionne réellement la prochaine séance.

Rechercher en priorité une donnée publique/documentée.

Si l'API ne fournit pas directement `currentWeek/currentDay/nextWorkout`, étudier :

1. current program ;
2. latest linked history ;
3. week ;
4. dayInWeek ;
5. structure du programme ;
6. comportement du client officiel comme référence.

Documenter l'algorithme.

Créer des tests pour :

```text
première séance
jour suivant
fin de semaine
semaine suivante
programme à une semaine
programme multi-semaines
workout sauté
workout répété
historique supprimé
nouveau programme
programme modifié
```

Même lorsque l'algorithme propose automatiquement une séance, afficher avant Start :

```text
Program
Week
Day
Day name

[ START ]
[ CHANGE ]
```

afin qu'une erreur de déduction soit récupérable.

---

# 19. Session locale durable

Une séance ne doit pas exister uniquement en RAM.

Créer un modèle :

```text
WorkoutSession
```

avec au minimum :

```text
sessionId
status
createdAt
startedAt
finishedAt

programId
programName
baselineProgramText
baselineProgramHash

week
day

latestWorkoutText
latestServerRevisionEquivalent

events[]

restTimer

syncState
historyId
pendingUpdatedProgramText
errorState
```

Persister la session sur la montre.

Après chaque interaction métier critique :

```text
persist
→ update UI
→ sync async
```

Pas l'inverse.

---

# 20. Event sourcing léger

Utiliser un journal d'événements de séance.

Exemple :

```text
CHANGE_WEIGHT
CHANGE_REPS
CHANGE_RPE
COMPLETE_SET
SKIP_SET
START_REST
SKIP_REST
FINISH_SESSION
```

Chaque événement contient au minimum :

```text
eventId
sequence
createdAt
type
payload
```

Les commandes envoyées au Playground doivent pouvoir être reconstruites à partir de ce journal.

Objectif :

```text
crash
↓
restart
↓
reload persisted session
↓
replay events
↓
resume exactly
```

---

# 21. Réactivité UI

Ne bloque jamais l'UI pendant un appel Cloud.

Exemple :

```text
User taps DONE

T0:
- event enregistré
- set visuellement terminé
- rest timer démarre

T0 + async:
- événement envoyé téléphone
- playground recalculé
- réponse reçue
- sets futurs réconciliés
```

La connexion réseau ne doit pas déterminer la latence tactile.

Les erreurs réseau doivent modifier le statut de synchronisation, pas annuler l'action locale.

---

# 22. Offline

Créer explicitement :

```text
ONLINE
DEGRADED
OFFLINE
```

Un programme statique doit rester largement utilisable offline.

Pour un programme utilisant une logique dynamique nécessitant Playground :

* conserver les actions ;
* permettre la poursuite avec les dernières prescriptions connues ;
* afficher clairement que les mises à jour dynamiques sont en attente ;
* rejouer à la reconnexion ;
* réconcilier.

Ne pas inventer localement le résultat d'un script Liftoscript que nous n'exécutons pas.

---

# 23. Rest timer

Ne pas construire un rest timer sur un simple compteur `setInterval`.

La source de vérité est :

```text
restStartedAt
restDuration
restEndsAt
```

L'affichage est toujours dérivé de l'heure actuelle.

Ainsi une pause lifecycle ne casse pas le timer.

---

# 24. Rest alert background - spike obligatoire

Créer un spike séparé pour déterminer la solution fiable de rappel lorsque l'extension n'a pas le focus.

Tester les mécanismes Zepp officiellement disponibles :

```text
Alarm
App Service
System Timer si disponible
System Notification
Vibrator
```

Ne pas supposer qu'une vibration foreground fonctionne background.

Créer :

```text
docs/rest-alert-spike.md
```

Tester :

1. extension visible ;
2. extension non visible mais Workout actif ;
3. autre écran du System Workout visible ;
4. écran éteint ;
5. wrist down ;
6. AOD si disponible ;
7. après 30 s ;
8. après 2 min ;
9. après plusieurs timers ;
10. timer annulé ;
11. workout terminé avant expiration.

La solution choisie doit être documentée via ADR dans `docs/decisions.md`.

---

# 25. App Service

Ne lancer un App Service continu que si nécessaire.

Avant utilisation :

* vérifier permissions ;
* vérifier compatibilité modèle ;
* vérifier restrictions ;
* vérifier conflit avec un autre App Service ;
* mesurer l'impact batterie.

Préférer une exécution ponctuelle/alarmée si elle satisfait le besoin.

---

# 26. Sport data

Utiliser les données du System Workout lorsque disponibles.

Au minimum, afficher éventuellement :

```text
HR
```

sans surcharger l'interface.

Ne lance pas un capteur HeartRate indépendant si le System Workout expose déjà la donnée nécessaire.

Ne sauvegarde pas une seconde copie des données santé sauf besoin explicitement défini.

Zepp doit conserver son historique sport natif.

Liftosaur doit conserver l'historique musculation.

---

# 27. Fin de workout

Ne jamais faire dépendre la sauvegarde Liftosaur de `onDestroy`.

Le workflow nominal est :

```text
Last set
↓
Finish Liftosaur
↓
playground + finish_workout()
↓
final workout text
↓
commit Liftosaur
↓
confirmation SYNCED
↓
user termine ensuite le workout Zepp
```

Si l'application est détruite avant la fin :

```text
persist pending state
```

et reprendre plus tard.

`onDestroy` doit être utilisé pour cleanup/persistence, pas comme transaction réseau critique.

---

# 28. Finalisation Liftosaur

Le Playground ne sauvegarde pas.

`finish_workout()` produit :

```text
workout
updatedProgramText
```

Il faut ensuite effectuer les écritures nécessaires via l'API officielle.

Concevoir une state machine explicite :

```text
ACTIVE
FINISH_REQUESTED
PLAYGROUND_FINISHED
CONFLICT_CHECK
HISTORY_PENDING
HISTORY_COMMITTED
PROGRAM_PENDING
PROGRAM_COMMITTED
SYNCED
CONFLICT
UNKNOWN_COMMIT_STATE
ERROR
```

Persister chaque transition critique.

---

# 29. Protection contre écrasement de programme

Au début :

```text
baselineProgramText
baselineProgramHash
```

Avant d'écrire le programme progressé :

```text
GET current program
↓
compare hash
```

Si différent :

```text
DO NOT overwrite
```

Passer la session en :

```text
CONFLICT
```

Conserver :

```text
baseline
current remote
proposed updated program
workout
historyId éventuel
```

et permettre récupération manuelle.

Ne jamais faire un last-write-wins silencieux.

Si Liftosaur ajoute plus tard ETag/version/conditional update, privilégier immédiatement ce mécanisme officiel.

---

# 30. Non-atomicité des commits

Traiter :

```text
POST history
```

et :

```text
PUT program
```

comme deux opérations distinctes potentiellement interrompues.

L'architecture doit reprendre correctement après crash entre chaque étape.

Ordre de référence à évaluer :

```text
1 finish playground
2 conflict check
3 create history
4 persist returned historyId
5 update program
6 mark synced
```

Documenter toute raison de choisir un autre ordre.

---

# 31. Idempotence

Ne suppose pas que `POST history` est idempotent.

Si :

```text
request sent
connection lost
```

l'état est :

```text
UNKNOWN_COMMIT_STATE
```

et non :

```text
FAILED
```

Avant retry :

1. interroger l'historique récent ;
2. chercher une entrée correspondant au workout attendu ;
3. comparer les données disponibles ;
4. récupérer son ID si elle existe ;
5. ne repost que lorsque l'absence est suffisamment établie.

Créer des tests de réponse perdue.

---

# 32. Concurrence

Tester :

```text
start workout
↓
modify program from normal Liftosaur app
↓
finish workout from watch
```

Le programme modifié ne doit pas être écrasé.

Tester également :

```text
deux sessions Zepp accidentelles
double tap
reconnexion tardive
retry après redémarrage
```

---

# 33. Double tap

Tout bouton critique doit être protégé.

Par exemple :

```text
SET DONE
```

ne doit pas produire :

```text
COMPLETE_SET
COMPLETE_SET
```

sur double tap.

Utiliser :

* verrou logique ;
* event ID ;
* sequence ;
* état du set ;
* désactivation momentanée si nécessaire.

La logique métier doit être idempotente autant que possible côté client.

---

# 34. Warmups

Les warmups font partie du scope.

Ils doivent être visuellement distinguables mais suivre le même modèle d'événements.

Vérifier précisément comment le Playground représente et indexe :

```text
warmup sets
working sets
```

avant d'assumer que les indices des commandes sont identiques.

Créer un test spécifique.

---

# 35. Supersets

Les supersets font partie du scope.

Ne code pas simplement :

```text
next set = même exercice
```

Le moteur de navigation doit pouvoir déterminer :

```text
exercise A set 1
→ exercise B set 1
→ exercise A set 2
→ exercise B set 2
```

selon le comportement réel Liftosaur.

Vérifier la sémantique exacte via documentation et Playground.

Le rest timer doit également suivre la prescription réellement renvoyée.

---

# 36. AMRAP et rep ranges

Supporter :

```text
AMRAP
min-max reps
logged actual reps
RPE
```

Ne pas traiter :

```text
8-12
```

comme simplement `12`.

Afficher clairement target et actual.

Exemple :

```text
TARGET
8-12 AMRAP

ACTUAL
14
```

---

# 37. Weight units

Ne suppose pas kg uniquement.

Le modèle interne doit préserver l'unité retournée par Liftosaur.

Supporter correctement :

```text
kg
lb
```

Éviter les conversions flottantes inutiles.

Lorsque la montre permet l'édition d'un poids, conserver une représentation stable évitant les erreurs du type :

```text
77.499999999
```

---

# 38. Equipment et rounding

Liftosaur possède des configurations d'équipement pouvant influencer les charges prescrites.

Avant de réimplémenter un algorithme de rounding :

1. déterminer si Playground retourne déjà les poids correctement arrondis pour l'utilisateur ;
2. tester avec équipement réel ;
3. uniquement si nécessaire, utiliser les endpoints équipement documentés.

La source de vérité reste Liftosaur.

Ne duplique pas le calcul sans nécessité.

---

# 39. App Liftosaur du téléphone

L'application Liftosaur Android/iOS installée sur le téléphone n'est PAS une dépendance de communication.

Architecture :

```text
Zepp Side Service
↔ Liftosaur Cloud
```

et séparément :

```text
Liftosaur mobile
↔ Liftosaur Cloud
```

Ne cherche pas à envoyer artificiellement des intents vers Liftosaur mobile.

Une modification via API peut ne pas apparaître instantanément dans un écran Liftosaur déjà ouvert.

Ce n'est pas un problème de workout.

---

# 40. Recovery

À chaque lancement de l'extension :

```text
check persisted session
```

Si session inachevée :

```text
Resume workout?
Program
Day
Started <time>

[ RESUME ]
[ DISCARD ]
```

Si session terminée mais sync pending :

```text
Workout saved locally
Sync pending

[ RETRY ]
```

Ne jamais supprimer automatiquement une session contenant des événements non synchronisés.

---

# 41. Diagnostics

Créer un diagnostic simple dans Settings App :

```text
Watch connection: OK
Liftosaur API: OK
Program: My Program
Last sync: ...
Pending session: none
Protocol version: 1
App version: ...
```

Ajouter :

```text
Export diagnostics
```

si facilement réalisable, mais sans exporter :

* API key ;
* Authorization header ;
* données sensibles inutiles.

---

# 42. Logging

Utiliser des logs structurés.

Exemple :

```text
SESSION_CREATED
EVENT_PERSISTED
BLE_SENT
PLAYGROUND_OK
PLAYGROUND_FAILED
RECONCILED
HISTORY_POST_SENT
HISTORY_POST_CONFIRMED
PROGRAM_CONFLICT
PROGRAM_UPDATED
SESSION_SYNCED
```

Toujours inclure :

```text
sessionId
eventId si applicable
```

Jamais de secret.

---

# 43. Error UX

Les erreurs doivent être compréhensibles sur montre.

Pas :

```text
HTTP 422 parse_error
```

mais :

```text
LIFTOSAUR ERROR

Workout could not
be recalculated.

Saved locally.
```

Les détails techniques restent dans les logs/Settings App.

---

# 44. Performance

L'interaction tactile locale ne doit pas attendre BLE ou HTTP.

Mesurer :

```text
tap → visual feedback
tap → event persisted
watch → phone
phone → Liftosaur
Liftosaur → phone
phone → watch
```

Documenter les mesures réelles lorsque le hardware est disponible.

Objectif UX :

```text
tap → UI = perceptuellement immédiat
```

La synchronisation réseau peut être asynchrone.

---

# 45. Batterie

Ne jamais introduire :

* polling rapide permanent ;
* HR sensor supplémentaire inutile ;
* app service continu inutile ;
* refresh UI excessif ;
* appels API à haute fréquence inutiles.

Préférer :

```text
event-driven
```

à :

```text
poll every second
```

Le timer d'affichage peut se rafraîchir uniquement lorsqu'il est visible.

---

# 46. API rate limits

Si Liftosaur ne documente pas de rate limit :

* ne suppose pas qu'il n'en existe pas ;
* ne spamme pas Playground sur chaque incrément `+1` ;
* regroupe les modifications tant que possible.

Exemple :

```text
+1 rep
+1 rep
RPE +0.5
```

peut rester local jusqu'à validation du set.

Au `SET DONE`, envoyer le command log final nécessaire.

---

# 47. Tests unitaires prioritaires

Tester au minimum :

## State machine

```text
start
edit
complete
rest
next
finish
recover
```

## Event log

```text
ordering
duplicate
replay
persistence
```

## Parser

Fixtures Liftosaur variées.

## Sync

```text
success
timeout
offline
401
403
422
lost response
duplicate response
```

## Conflict

programme distant modifié.

## Dynamic workout

`update: custom()` modifie des sets futurs.

---

# 48. Fault injection

Construire un moyen simple de provoquer :

```text
network offline
500
timeout
response delay
BLE disconnected
duplicate message
out-of-order message
app restart
invalid JSON
invalid workout
```

Les erreurs doivent être testables volontairement.

---

# 49. Test matrix réelle

Créer dans :

```text
docs/test-matrix.md
```

une matrice :

| Scenario              | Emulator      | Real Watch | Result |
| --------------------- | ------------- | ---------- | ------ |
| Basic UI              | required      | required   |        |
| HR display            | mock          | required   |        |
| Pause/resume          | required      | required   |        |
| Rest alert focused    | required      | required   |        |
| Rest alert unfocused  | partial       | required   |        |
| Screen off            | no confidence | required   |        |
| BLE disconnect        | simulate      | required   |        |
| Zepp background       | limited       | required   |        |
| Zepp force killed     | limited       | required   |        |
| Internet loss         | required      | required   |        |
| Workout saved in Zepp | no confidence | required   |        |
| Liftosaur history     | required      | required   |        |
| Progression           | required      | required   |        |
| Conflict              | required      | required   |        |

Ne considérer aucune ligne hardware comme validée uniquement avec l'émulateur.

---

# 50. Phases de développement

## Phase 0 - Research

Aucun code métier complexe.

Valider :

```text
Workout Extension
Strength Training
Side Service
SPORT_DATA
CLICK
lifecycle
API Liftosaur
```

## Phase 1 - Vertical slice mock

Un workout fictif :

```text
Bench
3x10
60kg
```

Pouvoir :

```text
start
edit reps
complete set
rest
finish
recover after restart
```

Sans Liftosaur réel.

## Phase 2 - Read-only Liftosaur

API réelle :

```text
API key
current program
playground
display workout
```

Aucune écriture Cloud.

## Phase 3 - Dynamic workout

```text
commands
replay
update custom
reconciliation
```

Toujours sans commit destructif si possible.

## Phase 4 - History

Enregistrer un workout de test contrôlé.

## Phase 5 - Program progression

Ajouter :

```text
finish_workout
conflict check
program PUT
transaction recovery
```

## Phase 6 - Rest alerts

Alarm/App Service/system timer/vibration.

## Phase 7 - Real watch hardening

Test complet avec hardware.

## Phase 8 - UX polish

Uniquement après fiabilité.

---

# 51. Definition of Done V1

La V1 est terminée uniquement si ce scénario fonctionne :

```text
1. Start Strength Training on Amazfit
2. Open Liftosaur Workout Extension
3. Extension identifies/proposes correct Liftosaur workout
4. Start workout
5. See exercise and prescribed set
6. Edit weight/reps/RPE
7. Complete set
8. UI reacts immediately
9. Rest timer starts
10. Rest alert works even when extension loses focus
11. Navigate through workout
12. Dynamic Liftoscript updates are respected
13. Finish Liftosaur workout
14. History appears in Liftosaur Cloud
15. Program progression is correct
16. Zepp saves its native Strength Training workout
17. No duplicate history
18. No lost session
19. Reopening after crash recovers correctly
20. Offline/reconnection works predictably
21. Concurrent Liftosaur program modification is not overwritten silently
```

---

# 52. Non-goals V1

Ne pas développer avant nécessité explicite :

```text
program editor
graphs
body measurements
social features
full workout history browser
exercise photos
plate calculator advanced
custom workout builder
analytics
cloud backend of our own
account system of our own
```

Pas de backend supplémentaire sauf preuve qu'il est indispensable.

---

# 53. KISS

Avant d'ajouter un composant, demande :

```text
Est-ce que Zepp sait déjà le faire ?
Est-ce que Liftosaur sait déjà le faire ?
```

Si oui :

```text
ne le réimplémente pas.
```

Notre application doit être une couche d'intégration mince et robuste.

---

# 54. Travail autonome de l'agent

Tu es autorisé à :

* lire toute la documentation nécessaire ;
* explorer les exemples officiels ;
* créer des prototypes ;
* tester dans l'émulateur ;
* modifier le code du projet ;
* ajouter des tests ;
* créer la documentation ;
* refactorer si nécessaire.

Tu ne dois pas attendre une confirmation utilisateur pour chaque décision technique réversible.

En revanche, arrête une opération destructive ou irreversible si elle risque :

* de modifier le vrai programme Liftosaur ;
* de supprimer un historique ;
* d'écraser des données utilisateur ;
* de publier publiquement l'application ;
* d'exposer une API key.

---

# 55. Discipline de recherche

Lorsque la documentation est ambiguë :

1. identifier l'ambiguïté ;
2. rechercher la documentation officielle ;
3. regarder les exemples officiels ;
4. créer un test minimal ;
5. documenter le résultat.

Ne masque pas une inconnue avec une supposition.

---

# 56. TODO

Maintenir un TODO/Kanban dans :

```text
docs/TODO.md
```

Structure :

```markdown
# Kanban

## Now

## Next

## Later

## Blocked

## Done
```

Chaque tâche importante doit indiquer :

* objectif ;
* contexte si nécessaire ;
* critère de validation.

Ne crée pas un backlog monstrueux de micro-tâches.

Garder `Now` très limité.

---

# 57. ADR

Pour chaque décision architecturale significative, ajouter une entrée courte dans :

```text
docs/decisions.md
```

Format :

```text
## ADR-xxx - titre

Status:
Context:
Decision:
Alternatives:
Consequences:
Evidence:
```

Décisions initiales probables :

```text
Liftosaur Cloud as business source of truth
Watch event log as temporary session source of truth
Side Service as network gateway
No local Liftoscript engine
System Workout owns health metrics
Absolute rest deadlines
Optimistic conflict protection
```

Mais confirme-les avant de les marquer `Accepted`.

---

# 58. Premier livrable demandé

Commence maintenant.

Ne développe PAS immédiatement l'application complète.

Effectue d'abord :

1. inspection de l'environnement existant ;
2. lecture de la documentation officielle actuelle ;
3. création des fichiers `docs/` ;
4. création du projet Workout Extension minimal si aucun projet n'existe ;
5. création d'un DataWidget minimal ;
6. affichage d'une donnée SPORT_DATA mockée ;
7. bouton CLICK fonctionnel ;
8. logs onInit/onResume/onPause/onDestroy ;
9. Side Service minimal ;
10. round-trip Device → Side Service → Device ;
11. documenter les résultats.

Ensuite seulement, implémente un vertical slice local fictif :

```text
Bench Press
3x10
60kg
90s
```

Il doit permettre :

```text
start
complete
rest
next set
finish
restart/recover
```

Ne branche l'API Liftosaur réelle qu'une fois cette fondation stable.

À chaque étape, conserve le projet exécutable.

Ne laisse pas volontairement une grosse branche cassée pendant plusieurs étapes.

---

# 59. Rapport de progression

À la fin de chaque milestone, fournir :

```text
DONE
- ...

VERIFIED
- ...

OPEN RISKS
- ...

NEXT
- ...
```

Pour chaque capability Zepp critique, préciser :

```text
DOC CONFIRMED
EMULATOR TESTED
REAL DEVICE TESTED
```

Ces trois états ne sont pas équivalents.

---

# 60. Priorité absolue

Si tu dois choisir entre :

```text
plus de fonctionnalités
```

et :

```text
ne jamais perdre ou corrompre un workout
```

choisis toujours la seconde option.

Le produit doit pouvoir être simple.

Il ne doit pas être fragile.
