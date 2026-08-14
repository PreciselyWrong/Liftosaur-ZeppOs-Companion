import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProgramOutline, parseProgramDayExercises } from '../shared/liftoscript-outline.js';

const USER_PROGRAM = `# Semaine 1
// **Notation des séries** - \`2x10+ @7+\`
// - \`10+\` : cible indicative, **dépassement attendu** jusqu'à @7
// - \`@7+\` : saisie du **RPE réel** en fin de série
// 
// **Calcul automatique** - en fin de séance, \`1RM = poids réel ÷ rpeMultiplier(reps, RPE)\`
// - Prise en compte de la **meilleure des deux séries**, la moins fatiguée
// - Remise à zéro à chaque passage : un 1RM surévalué peut donc **baisser**
// - Écriture directe dans \`rm1\`, lu par les semaines 2 à 18
// 
// **Consignes**
// - **Aucune série à l'échec** - cible @7, soit 3 reps en réserve
// - Saisie **honnête** du RPE : toute la progression du bloc en dépend
// - Correction du poids proposé dès qu'il paraît absurde
## Mardi: PUSH A
calib / used: none / 2x10+ / @7+ / progress: custom() {~
  if (week == 1) {
    var.best = 0kg
    for (var.i in completedReps) {
      if (completedReps[var.i] > 0 && completedReps[var.i] <= 24 && completedRPE[var.i] > 0) {
        var.evalRpe = completedRPE[var.i]
        if (completedReps[var.i] >= 10 && var.evalRpe < 7) {
          var.evalRpe = 7
        }
        var.e = completedWeights[var.i] / rpeMultiplier(completedReps[var.i], var.evalRpe)
        if (var.e > var.best) { var.best = var.e }
      }
    }
    if (var.best > 0kg) {
      var.best = round(var.best / 2.5kg) * 2.5kg
      rm1 = var.best
      print(var.best)
    }
  }
~}

/// Double progression synchronisée : calibration RPE unique, puis charge fixe en kg.
dpkg / used: none / 1x1 / 0kg / update: custom() {~
  if (setIndex == 0) {
    weights = weights[1]
  }
~} / progress: custom(increment: 2.5kg, minrep: 8, maxrep: 12, ready: 0, load: 0kg) {~
  if (state.ready == 0) {
    var.found = 0
    var.firstload = 0kg
    for (var.i in completedReps) {
      if (completedReps[var.i] > 0) {
        if (var.found == 0 || completedWeights[var.i] < var.firstload) {
          var.firstload = completedWeights[var.i]
          var.found = 1
        }
      }
    }
    if (var.found == 1) {
      state.load = var.firstload
      state.ready = 1
    }
  }
  if (state.ready == 1) {
    if (completedReps >= reps) {
      if (reps[1] >= state.maxrep) {
        state.load = state.load + state.increment
        var.next = state.minrep
      } else {
        var.next = reps[1] + 1
      }
      reps[2:*:*:*] = var.next
      reps[3:*:*:*] = var.next
      reps[4:*:*:*] = var.next
      reps[5:*:*:*] = var.next
      reps[6:*:*:*] = var.next
      reps[8:*:*:*] = var.next
      reps[9:*:*:*] = var.next
      reps[10:*:*:*] = var.next
      reps[11:*:*:*] = var.next
      reps[12:*:*:*] = var.next
      reps[14:*:*:*] = var.next
      reps[15:*:*:*] = var.next
      reps[16:*:*:*] = var.next
      reps[17:*:*:*] = var.next
      reps[18:*:*:*] = var.next
    }
    weights[2:*:*:*] = state.load
    weights[3:*:*:*] = state.load
    weights[4:*:*:*] = state.load
    weights[5:*:*:*] = state.load
    weights[6:*:*:*] = state.load
    weights[8:*:*:*] = state.load
    weights[9:*:*:*] = state.load
    weights[10:*:*:*] = state.load
    weights[11:*:*:*] = state.load
    weights[12:*:*:*] = state.load
    weights[14:*:*:*] = state.load
    weights[15:*:*:*] = state.load
    weights[16:*:*:*] = state.load
    weights[17:*:*:*] = state.load
    weights[18:*:*:*] = state.load
  }
~}
calibration: Decline Bench Press / ...calib / 2x6+ / 20s / warmup: 1x8 40%, 1x5 70%, 1x3 85% / superset: A
calibration: Straight Arm Pulldown, Cable / ...calib / 120s / warmup: none / superset: A

calibration: Reverse Fly / ...calib / 2x12+ / 20s / warmup: none / superset: B
// **Version du mardi** - Buste légèrement penché, coudes contre les côtes.
calibration: Triceps Pushdown / ...calib / 75s / warmup: none / superset: B

calibration: Lateral Raise / ...calib / 2x12+ / 20s / warmup: none / superset: C
calibration: Pullover / ...calib / 90s / warmup: none / superset: C

## Mercredi: QUADS + GLUTES
calibration: Belt Squat / ...calib / 120s / warmup: 1x10 50%, 1x5 75%
calibration: Cable Pull Through / ...calib / 2x12+ / 90s / warmup: none
hipmer: Hip Thrust / ...calib / 2x8+ / 150s / warmup: 1x8 50%

## Jeudi: PULL A
calibration: Lat Pulldown / ...calib / 2x8+ / 120s / warmup: 1x10 50%, 1x5 75%
calibration: Seated Row / ...calib / 2x8+ / 90s / warmup: 1x10 60%
calibration: Face Pull, Cable / ...calib / 2x12+ / 20s / warmup: none / superset: C
calibration: Incline Curl / ...calib / 2x8+ / 60s / warmup: none / superset: C
calibration: Lateral Raise / ...calib / 2x15+ / 20s / superset: D
calibration: Reverse Curl, Cable / ...calib / 60s / warmup: none / superset: D

## Vendredi: PUSH B
// **Pré-activation pectorale** - 15-20 reps @6, excentrique contrôlée, adduction volontaire, arrêt loin de l'échec.
activation: Incline Chest Fly / 1x15-20 / @6 75s / warmup: none / progress: none
calibration: Incline Bench Press / ...calib / 2x6+ / 150s / warmup: 1x8 40%, 1x5 70%, 1x3 85%
flywork: Incline Chest Fly / ...calib / 75s / warmup: none
// **Version du vendredi** - Buste incliné, coudes devant le torse, étirement du chef long sans position overhead.
calibration: Triceps Pushdown / ...calib / 20s / superset: E
calibration: Hanging Leg Raise / ...calib / 60s / warmup: none / superset: E

## Samedi: PULL B + BRAS
// **Assistance** - Bande suffisamment forte pour conserver 4×6 @8-9, amplitude complète.
calibration: Pull Up / ...calib / 2x6+ / 120s / warmup: none
calibration: Chest-Supported Row / ...calib / 2x8+ / 150s / warmup: 1x10 60%
calibration: Reverse Fly / ...calib / 2x12+ / 20s / superset: G
calibration: Incline Curl / ...calib / 75s / superset: G
calibration: Lateral Raise / ...calib / 2x15+ / 20s / superset: H
calibration: Hammer Curl, Cable / ...calib / 60s / warmup: none / superset: H

## Dimanche: GLUTES B
calibration: Hip Thrust / ...calib / 2x8+ / 150s / warmup: 1x10 50%, 1x5 75%
calibration: Romanian Deadlift, Barbell / ...calib / 2x6+ / 150s / warmup: 1x8 50%, 1x5 75%
calibration: Landmine Squat / ...calib / 2x12+ / 90s / warmup: 1x10 60%
calibration: Crunch, Cable / ...calib / 60s / warmup: none


# Semaine 2
## Mardi: PUSH A
Decline Bench Press[1,2-6] / 3x8 @8, 1x8+ @9 / 20s / warmup: 1x8 40%, 1x5 70%, 1x3 85% / superset: A / update: custom() { ...dpkg } / progress: custom(minrep: 6, maxrep: 8) { ...dpkg }
Straight Arm Pulldown, Cable[2,2-6] / 1x12 @8, 1x12+ @9 / 120s / warmup: none / superset: A / update: custom() { ...dpkg } / progress: custom(minrep: 10) { ...dpkg }

rfmar: Reverse Fly[3,2-6] / 2x13 @8, 1x13+ @9 / 20s / warmup: none / superset: B / update: custom() { ...dpkg } / progress: custom(minrep: 12, maxrep: 15) { ...dpkg }
// **Version du mardi** - Buste légèrement penché, coudes contre les côtes.
pushmar: Triceps Pushdown[4,2-6] / 1x11 @8, 1x11+ @9 / 75s / warmup: none / superset: B / update: custom() { ...dpkg } / progress: custom(minrep: 10) { ...dpkg }

Lateral Raise[5,2-6] / 2x15 @8, 1x15+ @9 / 20s / warmup: none / superset: C / update: custom() { ...dpkg } / progress: custom(minrep: 12, maxrep: 15) { ...dpkg }
Pullover[6,2-6] / 1x12 @8, 1x12+ @9 / 90s / warmup: none / superset: C / update: custom() { ...dpkg } / progress: custom(minrep: 10) { ...dpkg }

## Mercredi: QUADS + GLUTES
Belt Squat[1,2-6] / 3x12 @8, 1x12+ @9 / 50kg 120s / warmup: 1x10 50%, 1x5 75% / update: custom() { ...dpkg } / progress: custom(minrep: 10, ready: 1, load: 50kg) { ...dpkg }
Cable Pull Through[2,2-6] / 2x14 @8, 1x14+ @9 / 37.5kg 90s / warmup: none / update: custom() { ...dpkg } / progress: custom(minrep: 12, maxrep: 15, ready: 1, load: 37.5kg) { ...dpkg }
hipmer: Hip Thrust[3,2-6] / 2x8 @8, 1x8+ @9 / 150s / update: custom() { ...dpkg } / progress: custom(maxrep: 10) { ...dpkg }

## Jeudi: PULL A
Lat Pulldown[1,2-6] / 3x10 @8, 1x10+ @9 / 60kg 120s / warmup: 1x10 50%, 1x5 75% / update: custom() { ...dpkg } / progress: custom(maxrep: 10, ready: 1, load: 60kg) { ...dpkg }
Seated Row[2,2-6] / 2x10 @8, 1x10+ @9 / 90kg 90s / warmup: 1x10 60% / update: custom() { ...dpkg } / progress: custom(maxrep: 10, ready: 1, load: 90kg) { ...dpkg }
Face Pull, Cable[3,2-6] / 2x14 @8, 1x14+ @9 / 47.5kg 20s / warmup: none / superset: C / update: custom() { ...dpkg } / progress: custom(minrep: 12, maxrep: 15, ready: 1, load: 47.5kg) { ...dpkg }
Incline Curl[4,2-6] / 2x8 @8, 1x8+ @9 / 17.5kg 60s / warmup: none / superset: C / update: custom() { ...dpkg } / progress: custom(maxrep: 10, ready: 1, load: 17.5kg) { ...dpkg }
latmer: Lateral Raise[5,2-6] / 2x17 @8, 1x17+ @9 / 7.5kg 20s / warmup: none / superset: D / update: custom() { ...dpkg } / progress: custom(minrep: 15, maxrep: 20, ready: 1, load: 7.5kg) { ...dpkg }
Reverse Curl, Cable[6,2-6] / 1x10 @8, 1x10+ @9 / 25kg 60s / warmup: none / superset: D / update: custom() { ...dpkg } / progress: custom(minrep: 10, ready: 1, load: 25kg) { ...dpkg }

## Vendredi: PUSH B
// **Pré-activation pectorale** - 15-20 reps @6, excentrique contrôlée, adduction volontaire, arrêt loin de l'échec.
activation: Incline Chest Fly[1,2-6] / 1x15-20 / @6 75s / progress: none
Incline Bench Press[2,2-6] / 3x8 @8, 1x8+ @9 / 150s / warmup: 1x8 40%, 1x5 70%, 1x3 85% / update: custom() { ...dpkg } / progress: custom(minrep: 6, maxrep: 8) { ...dpkg }
flywork: Incline Chest Fly[3,2-6] / 2x11 @8, 1x11+ @9 / 75s / update: custom() { ...dpkg } / progress: custom(minrep: 10) { ...dpkg }
// **Version du vendredi** - Buste incliné, coudes devant le torse, étirement du chef long sans position overhead.
Triceps Pushdown[4,2-6] / 2x11 @8, 1x11+ @9 / 20s / warmup: none / superset: E / update: custom() { ...dpkg } / progress: custom(minrep: 10) { ...dpkg }
Hanging Leg Raise[5,2-6] / 2x11 @8, 1x11+ @9 / 60s / warmup: none / superset: E / update: custom() { ...dpkg } / progress: custom(minrep: 10) { ...dpkg }

## Samedi: PULL B + BRAS
// **Assistance** - Bande ajustée pour conserver 4×6 @8-9; réduction uniquement après 4 séries propres à @8 maximum.
Pull Up[1,2-6] / 3x6 @8, 1x6+ @9 / 120s / warmup: none / progress: none
Chest-Supported Row[2,2-6] / 3x8 @8, 1x8+ @9 / 150s / warmup: 1x10 60% / update: custom() { ...dpkg } / progress: custom(maxrep: 10) { ...dpkg }
Reverse Fly[3,2-6] / 2x12 @8, 1x12+ @9 / 20s / warmup: none / superset: G / update: custom() { ...dpkg } / progress: custom(minrep: 12, maxrep: 15) { ...dpkg }
curlb: Incline Curl[4,2-6] / 2x10 @8, 1x10+ @9 / 75s / warmup: none / superset: G / update: custom() { ...dpkg } / progress: custom(minrep: 10) { ...dpkg }
latsam: Lateral Raise[5,2-6] / 3x12 @8, 1x12+ @9 / 20s / warmup: none / superset: H / update: custom() { ...dpkg } / progress: custom(minrep: 12, maxrep: 15) { ...dpkg }
Hammer Curl, Cable[6,2-6] / 1x10 @8, 1x10+ @9 / 60s / warmup: none / superset: H / update: custom() { ...dpkg } / progress: custom(minrep: 10) { ...dpkg }

## Dimanche: GLUTES B
Hip Thrust[1,2-6] / 3x8 @8, 1x8+ @9 / 150s / warmup: 1x10 50%, 1x5 75% / update: custom() { ...dpkg } / progress: custom(maxrep: 10) { ...dpkg }
Romanian Deadlift, Barbell[2,2-6] / 3x6 / @8 150s / warmup: 1x8 50%, 1x5 75% / update: custom() { ...dpkg } / progress: custom(minrep: 6, maxrep: 8) { ...dpkg }
Landmine Squat[3,2-6] / 4x12 @8, 1x12+ @9 / 90s / warmup: 1x10 60% / update: custom() { ...dpkg } / progress: custom(minrep: 12, maxrep: 15) { ...dpkg }
Crunch, Cable[4,2-6] / 1x10 @8, 1x10+ @9 / 60s / warmup: none / update: custom() { ...dpkg } / progress: custom(minrep: 10) { ...dpkg }


# Semaine 3
## Mardi: PUSH A
## Mercredi: QUADS + GLUTES
## Jeudi: PULL A
## Vendredi: PUSH B
## Samedi: PULL B + BRAS
## Dimanche: GLUTES B

# Semaine 4
## Mardi: PUSH A
## Mercredi: QUADS + GLUTES
## Jeudi: PULL A
## Vendredi: PUSH B
## Samedi: PULL B + BRAS
## Dimanche: GLUTES B

# Semaine 5
## Mardi: PUSH A
## Mercredi: QUADS + GLUTES
## Jeudi: PULL A
## Vendredi: PUSH B
## Samedi: PULL B + BRAS
## Dimanche: GLUTES B

# Semaine 6
## Mardi: PUSH A
## Mercredi: QUADS + GLUTES
## Jeudi: PULL A
## Vendredi: PUSH B
## Samedi: PULL B + BRAS
## Dimanche: GLUTES B

# Semaine 7
## Mardi: PUSH A
Decline Bench Press / 2x8 / @6 20s / superset: A / progress: none
Straight Arm Pulldown, Cable / 2x12 / @6 120s / superset: A / progress: none
rfmar: Reverse Fly / 2x13 / @6 20s / superset: B / progress: none
pushmar: Triceps Pushdown / 2x11 / @6 75s / superset: B / progress: none
Lateral Raise / 2x14 / @6 20s / superset: C / progress: none
Pullover / 2x12 / @6 90s / superset: C / progress: none

## Mercredi: QUADS + GLUTES
Belt Squat / 2x11 / @6 120s / progress: none
Cable Pull Through / 2x13 / @6 90s / progress: none
hipmer: Hip Thrust / 2x8 / @6 150s / progress: none

## Jeudi: PULL A
Lat Pulldown / 2x9 / @6 120s / progress: none
Seated Row / 2x9 / @6 90s / progress: none
Face Pull, Cable / 2x13 / @6 20s / superset: C / progress: none
Incline Curl / 2x9 / @6 60s / superset: C / progress: none
latmer: Lateral Raise / 2x16 / @6 20s / superset: D / progress: none
Reverse Curl, Cable / 1x11 / @6 60s / superset: D / progress: none

## Vendredi: PUSH B
activation: Incline Chest Fly / 1x15-20 / @5 75s / progress: none
Incline Bench Press / 2x7 / @6 150s / progress: none
flywork: Incline Chest Fly / 2x11 / @6 75s / progress: none
Triceps Pushdown / 2x11 / @6 20s / superset: E / progress: none
Hanging Leg Raise / 2x11 / @6 60s / superset: E / progress: none

## Samedi: PULL B + BRAS
Pull Up / 2x6 / @6 120s / progress: none
Chest-Supported Row / 2x8 / @6 150s / progress: none
Reverse Fly / 2x12 / @6 20s / superset: G / progress: none
curlb: Incline Curl / 2x10 / @6 60s / superset: G / progress: none
latsam: Lateral Raise / 2x12 / @6 20s / superset: H / progress: none
Hammer Curl, Cable / 1x10 / @6 60s / superset: H / progress: none

## Dimanche: GLUTES B
Hip Thrust / 2x8 / @6 150s / progress: none
Romanian Deadlift, Barbell / 2x6 / @6 150s / progress: none
Landmine Squat / 2x12 / @6 90s / progress: none
Crunch, Cable / 1x10 / @6 60s / progress: none

# Semaine 8
## Mardi: PUSH A
Decline Bench Press[1,8-12] / 4x8 @8, 1x8+ @9 / 20s / superset: A
Straight Arm Pulldown, Cable[2,8-12] / 1x12 @8, 1x12+ @9 / 120s / superset: A
rfmar: Reverse Fly[3,8-12] / 2x13 @8, 1x13+ @9 / 20s / superset: B
pushmar: Triceps Pushdown[4,8-12] / 2x11 @8, 1x11+ @9 / 75s / superset: B
Lateral Raise[5,8-12] / 2x15 @8, 1x15+ @9 / 20s / superset: C
Pullover[6,8-12] / 1x12 @8, 1x12+ @9 / 90s / superset: C

## Mercredi: QUADS + GLUTES
Belt Squat[1,8-12] / 4x12 @8, 1x12+ @9 / 50kg 120s
Cable Pull Through[2,8-12] / 2x14 @8, 1x14+ @9 / 37.5kg 90s
hipmer: Hip Thrust[3,8-12] / 2x8 @8, 1x8+ @9 / 150s

## Jeudi: PULL A
Lat Pulldown[1,8-12] / 4x10 @8, 1x10+ @9 / 60kg 120s
Seated Row[2,8-12] / 2x10 @8, 1x10+ @9 / 90kg 90s
Face Pull, Cable[3,8-12] / 2x14 @8, 1x14+ @9 / 47.5kg 20s / superset: C
Incline Curl[4,8-12] / 2x8 @8, 1x8+ @9 / 17.5kg 60s / superset: C
latmer: Lateral Raise[5,8-12] / 3x17 @8, 1x17+ @9 / 7.5kg 20s / superset: D
Reverse Curl, Cable[6,8-12] / 2x10 @8, 1x10+ @9 / 25kg 60s / superset: D

## Vendredi: PUSH B
activation: Incline Chest Fly[1,8-12] / 1x15-20 / @6 75s / progress: none
Incline Bench Press[2,8-12] / 4x8 @8, 1x8+ @9 / 150s
flywork: Incline Chest Fly[3,8-12] / 3x11 @8, 1x11+ @9 / 75s
Triceps Pushdown[4,8-12] / 3x11 @8, 1x11+ @9 / 20s / superset: E
Hanging Leg Raise[5,8-12] / 2x11 @8, 1x11+ @9 / 60s / superset: E

## Samedi: PULL B + BRAS
Pull Up[1,8-12] / 3x6 @8, 1x6+ @9 / 120s / progress: none
Chest-Supported Row[2,8-12] / 4x8 @8, 1x8+ @9 / 150s
Reverse Fly[3,8-12] / 2x12 @8, 1x12+ @9 / 20s / superset: G
curlb: Incline Curl[4,8-12] / 3x10 @8, 1x10+ @9 / 75s / superset: G
latsam: Lateral Raise[5,8-12] / 4x12 @8, 1x12+ @9 / 20s / superset: H
Hammer Curl, Cable[6,8-12] / 2x10 @8, 1x10+ @9 / 60s / superset: H

# Semaine 9
## Mardi: PUSH A
## Mercredi: QUADS + GLUTES
## Jeudi: PULL A
## Vendredi: PUSH B
## Samedi: PULL B + BRAS
## Dimanche: GLUTES B

# Semaine 10
## Mardi: PUSH A
## Mercredi: QUADS + GLUTES
## Jeudi: PULL A
## Vendredi: PUSH B
## Samedi: PULL B + BRAS
## Dimanche: GLUTES B

# Semaine 11
## Mardi: PUSH A
## Mercredi: QUADS + GLUTES
## Jeudi: PULL A
## Vendredi: PUSH B
## Samedi: PULL B + BRAS
## Dimanche: GLUTES B

# Semaine 12
## Mardi: PUSH A
## Mercredi: QUADS + GLUTES
## Jeudi: PULL A
## Vendredi: PUSH B
## Samedi: PULL B + BRAS
## Dimanche: GLUTES B

# Semaine 13
## Mardi: PUSH A
Decline Bench Press / 2x8 / @6 20s / superset: A / progress: none
Straight Arm Pulldown, Cable / 2x12 / @6 120s / superset: A / progress: none
rfmar: Reverse Fly / 2x13 / @6 20s / superset: B / progress: none
pushmar: Triceps Pushdown / 2x11 / @6 75s / superset: B / progress: none
Lateral Raise / 2x14 / @6 20s / superset: C / progress: none
Pullover / 2x12 / @6 90s / superset: C / progress: none

## Mercredi: QUADS + GLUTES
Belt Squat / 2x11 / @6 120s / progress: none
Cable Pull Through / 2x13 / @6 90s / progress: none
hipmer: Hip Thrust / 2x8 / @6 150s / progress: none

## Jeudi: PULL A
Lat Pulldown / 2x9 / @6 120s / progress: none
Seated Row / 2x9 / @6 90s / progress: none
Face Pull, Cable / 2x13 / @6 20s / superset: C / progress: none
Incline Curl / 2x9 / @6 60s / superset: C / progress: none
latmer: Lateral Raise / 2x16 / @6 20s / superset: D / progress: none
Reverse Curl, Cable / 1x11 / @6 60s / superset: D / progress: none

## Vendredi: PUSH B
activation: Incline Chest Fly / 1x15-20 / @5 75s / progress: none
Incline Bench Press / 2x7 / @6 150s / progress: none
flywork: Incline Chest Fly / 2x11 / @6 75s / progress: none
Triceps Pushdown / 2x11 / @6 20s / superset: E / progress: none
Hanging Leg Raise / 2x11 / @6 60s / superset: E / progress: none

## Samedi: PULL B + BRAS
Pull Up / 2x6 / @6 120s / progress: none
Chest-Supported Row / 2x8 / @6 150s / progress: none
Reverse Fly / 2x12 / @6 20s / superset: G / progress: none
curlb: Incline Curl / 2x10 / @6 60s / superset: G / progress: none
latsam: Lateral Raise / 2x12 / @6 20s / superset: H / progress: none
Hammer Curl, Cable / 1x10 / @6 60s / superset: H / progress: none

## Dimanche: GLUTES B
Hip Thrust / 2x8 / @6 150s / progress: none
Romanian Deadlift, Barbell / 2x6 / @6 150s / progress: none
Landmine Squat / 2x12 / @6 90s / progress: none
Crunch, Cable / 1x10 / @6 60s / progress: none

# Semaine 14
## Mardi: PUSH A
Decline Bench Press[1,14-18] / 4x8 @8, 1x8+ @9 / 20s / superset: A
Straight Arm Pulldown, Cable[2,14-18] / 1x12 @8, 1x12+ @9 / 120s / superset: A
rfmar: Reverse Fly[3,14-18] / 2x13 @8, 1x13+ @9 / 20s / superset: B
pushmar: Triceps Pushdown[4,14-18] / 2x11 @8, 1x11+ @9 / 75s / superset: B
Lateral Raise[5,14-18] / 2x15 @8, 1x15+ @10 / 20s / superset: C
Pullover[6,14-18] / 1x12 @8, 1x12+ @9 / 90s / superset: C

## Mercredi: QUADS + GLUTES
Belt Squat[1,14-18] / 5x12 @8, 1x12+ @9 / 50kg 120s
Cable Pull Through[2,14-18] / 2x14 @8, 1x14+ @9 / 37.5kg 90s
hipmer: Hip Thrust[3,14-18] / 2x8 @8, 1x8+ @9 / 150s

## Jeudi: PULL A
Lat Pulldown[1,14-18] / 4x10 @8, 1x10+ @9 / 60kg 120s
Seated Row[2,14-18] / 3x10 @8, 1x10+ @9 / 90kg 90s
Face Pull, Cable[3,14-18] / 2x14 @8, 1x14+ @9 / 47.5kg 20s / superset: C
Incline Curl[4,14-18] / 2x8 @8, 1x8+ @9 / 17.5kg 60s / superset: C
latmer: Lateral Raise[5,14-18] / 2x17 @8, 1x17+ @9 / 7.5kg 20s / superset: D
Reverse Curl, Cable[6,14-18] / 2x10 @8, 1x10+ @9 / 25kg 60s / superset: D

## Vendredi: PUSH B
activation: Incline Chest Fly[1,14-18] / 1x15-20 / @6 75s / progress: none
Incline Bench Press[2,14-18] / 4x8 @8, 1x8+ @9 / 150s
flywork: Incline Chest Fly[3,14-18] / 3x11 @8, 1x11+ @9 / 75s
Triceps Pushdown[4,14-18] / 3x11 @8, 1x11+ @9 / 20s / superset: E
Hanging Leg Raise[5,14-18] / 2x11 @8, 1x11+ @9 / 60s / superset: E

## Samedi: PULL B + BRAS
Pull Up[1,14-18] / 3x6 @8, 1x6+ @9 / 120s / progress: none
Chest-Supported Row[2,14-18] / 4x8 @8, 1x8+ @9 / 150s
Reverse Fly[3,14-18] / 2x12 @8, 1x12+ @10 / 20s / superset: G
curlb: Incline Curl[4,14-18] / 3x10 @8, 1x10+ @9 / 75s / superset: G
latsam: Lateral Raise[5,14-18] / 4x12 @8, 1x12+ @10 / 20s / superset: H
Hammer Curl, Cable[6,14-18] / 2x10 @8, 1x10+ @9 / 60s / superset: H

## Dimanche: GLUTES B
Hip Thrust[1,14-18] / 4x8 @8, 1x8+ @9 / 150s
Romanian Deadlift, Barbell[2,14-18] / 4x6 / @8 150s
Landmine Squat[3,14-18] / 5x12 @8, 1x12+ @9 / 90s
Crunch, Cable[4,14-18] / 2x10 @8, 1x10+ @9 / 60s

# Semaine 15
## Mardi: PUSH A
## Mercredi: QUADS + GLUTES
## Jeudi: PULL A
## Vendredi: PUSH B
## Samedi: PULL B + BRAS
## Dimanche: GLUTES B

# Semaine 16
## Mardi: PUSH A
## Mercredi: QUADS + GLUTES
## Jeudi: PULL A
## Vendredi: PUSH B
## Samedi: PULL B + BRAS
## Dimanche: GLUTES B

# Semaine 17
## Mardi: PUSH A
## Mercredi: QUADS + GLUTES
## Jeudi: PULL A
## Vendredi: PUSH B
## Samedi: PULL B + BRAS
## Dimanche: GLUTES B

# Semaine 18
## Mardi: PUSH A
## Mercredi: QUADS + GLUTES
## Jeudi: PULL A
## Vendredi: PUSH B
## Samedi: PULL B + BRAS
## Dimanche: GLUTES B
`;

test('parses full outline of user 18-week program', () => {
  const outline = parseProgramOutline(USER_PROGRAM);
  assert.equal(outline.totalWeeks, 18);
  assert.equal(outline.weeks.length, 18);
  assert.equal(outline.weeks[0].days.length, 6);
  assert.equal(outline.weeks[0].days[0].name, 'Mardi: PUSH A');
  assert.equal(outline.weeks[0].days[1].name, 'Mercredi: QUADS + GLUTES');
});

test('week 1 day 1 extracts 6 exercises without calib/dpkg and with clean names and supersets', () => {
  const day1 = parseProgramDayExercises(USER_PROGRAM, 1, 1);
  assert.equal(day1.length, 6);

  assert.deepEqual(
    day1.map((d) => d.name),
    [
      'Decline Bench Press',
      'Straight Arm Pulldown',
      'Reverse Fly',
      'Triceps Pushdown',
      'Lateral Raise',
      'Pullover',
    ]
  );

  assert.equal(day1[0].warmupText, '1x8 40%, 1x5 70%, 1x3 85%');
  assert.equal(day1[0].supersetTag, 'A');

  assert.equal(day1[1].equipment, 'Cable');
  assert.equal(day1[1].supersetTag, 'A');

  assert.equal(day1[2].supersetTag, 'B');
  assert.equal(day1[3].supersetTag, 'B');
  assert.equal(day1[4].supersetTag, 'C');
  assert.equal(day1[5].supersetTag, 'C');
});

test('week 3 day 1 inherits 6 exercises from week 2 template definitions', () => {
  const day1 = parseProgramDayExercises(USER_PROGRAM, 3, 1);
  assert.equal(day1.length, 6);

  assert.deepEqual(
    day1.map((d) => d.name),
    [
      'Decline Bench Press',
      'Straight Arm Pulldown',
      'Reverse Fly',
      'Triceps Pushdown',
      'Lateral Raise',
      'Pullover',
    ]
  );

  assert.equal(day1[0].warmupText, '1x8 40%, 1x5 70%, 1x3 85%');
  assert.equal(day1[0].supersetTag, 'A');
  assert.equal(day1[1].supersetTag, 'A');
  assert.equal(day1[2].supersetTag, 'B');
  assert.equal(day1[3].supersetTag, 'B');
  assert.equal(day1[4].supersetTag, 'C');
  assert.equal(day1[5].supersetTag, 'C');
});

test('week 7 day 1 (deload) extracts deload exercises and supersets', () => {
  const day1 = parseProgramDayExercises(USER_PROGRAM, 7, 1);
  assert.equal(day1.length, 6);
  assert.equal(day1[0].name, 'Decline Bench Press');
  assert.equal(day1[0].supersetTag, 'A');
});

test('week 10 day 1 inherits from week 8 template', () => {
  const day1 = parseProgramDayExercises(USER_PROGRAM, 10, 1);
  assert.equal(day1.length, 6);
  assert.equal(day1[0].name, 'Decline Bench Press');
  assert.equal(day1[0].supersetTag, 'A');
  assert.equal(day1[1].supersetTag, 'A');
});

test('week 1 day 4 (Vendredi: PUSH B) extracts chest fly, bench press, triceps pushdown, hanging leg raise', () => {
  const day4 = parseProgramDayExercises(USER_PROGRAM, 1, 4);
  assert.equal(day4.length, 5);

  assert.deepEqual(
    day4.map((d) => d.name),
    [
      'Incline Chest Fly',
      'Incline Bench Press',
      'Incline Chest Fly',
      'Triceps Pushdown',
      'Hanging Leg Raise',
    ]
  );

  assert.equal(day4[1].warmupText, '1x8 40%, 1x5 70%, 1x3 85%');
  assert.equal(day4[3].supersetTag, 'E');
  assert.equal(day4[4].supersetTag, 'E');
});
