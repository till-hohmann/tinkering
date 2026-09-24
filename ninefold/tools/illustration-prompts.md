# Ninefold — exercise illustration prompt pack

Reproduces the bench press anatomy render across the whole exercise library, in one
consistent series. Written for **Nano Banana in Claude.ai**.

Muscle attributions come from [`js/exercise-anatomy.js`](../js/exercise-anatomy.js) —
the same data the app uses to draw the callout labels, so image and label can never
disagree.

---

## How to run one

1. **Attach the bench press image** to the message. Every single time — it is the
   style anchor, and without it the series drifts within about four generations.
2. Paste **BLOCK A** (style, unchanged).
3. Paste **one SCENE line** from the catalogue below.
4. Save the result as the `file:` name given in the scene line.

Do them in batches of 5–8, all in one conversation, re-attaching the reference every
message. If a render drifts (background goes dark, muscles go uniformly red, equipment
turns anatomical), start a fresh conversation rather than correcting in place —
correction turns compound.

**No text in the images.** The app draws the `PECTORALIS MAJOR / (PRIMARY MOVER)`
callouts itself, so they stay readable at mobile size and match the app's typography.
The reference image has labels baked in; BLOCK A explicitly cancels them.

---

## BLOCK A — style (paste unchanged, every time)

```
Match the attached reference image's style exactly: same rendering engine look, same
palette, same lighting, same level of anatomical detail.

SUBJECT: a photorealistic 3D anatomical écorché model — skin fully removed, superficial
musculature exposed with visible fibre striations and glistening fascia, pale ivory
tendons and aponeuroses, bone-white skull and the tendinous parts of hands and feet.
Anatomically accurate, medical-atlas grade. Neutral androgynous athletic build.

ACTIVATION HEAT MAP: worked muscles glow as a thermal overlay.
  - PRIMARY MOVER: white-hot to pale yellow through the muscle belly, grading out
    through saturated orange to a deep red-orange edge. Strongest, with a faint bloom.
  - SYNERGIST: amber to orange, clearly lit but never white-hot.
  - STABILIZER: a thin lime-green rim glow along the muscle edge only, no fill.
  - Every other muscle stays desaturated salmon-pink, unlit.

LIGHTING: large soft key from the upper left, gentle fill from the right, subtle rim
light separating the figure from the background. Soft contact shadow on the floor.

BACKGROUND: seamless neutral mid-grey studio cyclorama, slightly brighter directly
behind the figure, soft vignette to the corners. Nothing else in frame.

EQUIPMENT: fully photorealistic gym hardware, NOT anatomical — knurled chrome-steel
barbell, black rubber bumper plates, matte-black vinyl and steel benches and frames,
black-coated dumbbells, steel cable and rubber-coated handles.

CAMERA: 50mm, three-quarter view, eye level to slightly low, shallow depth of field.

OUTPUT: square 1:1, figure filling the frame. Absolutely no text, no labels, no
leader lines, no arrows, no watermarks, no logos, no UI.
```

---

## BLOCK B — scene catalogue

Each line: `file:` = save-as name · scene · which muscles run hot.

### Horizontal press

- `file: bench_press.png` — Flat barbell bench press, mid-rep with the bar just above the sternum, elbows ~45°, feet planted, slight thoracic arch. Three-quarter view from the athlete's left. HOT: pectoralis major (primary). WARM: anterior deltoid, triceps brachii. RIM: serratus anterior, latissimus dorsi.
- `file: db_bench_press.png` — Flat dumbbell bench press, dumbbells at chest height at the bottom of the rep, palms facing forward, elbows tucked ~45°. Three-quarter view. HOT: pectoralis major. WARM: anterior deltoid, triceps brachii. RIM: rotator cuff, serratus anterior.
- `file: incline_db_press.png` — 30° incline dumbbell press, dumbbells at upper-chest height, bench clearly angled. Three-quarter front view. HOT: clavicular head of pectoralis major. WARM: anterior deltoid, triceps brachii. RIM: serratus anterior.

### Vertical press

- `file: ohp_barbell.png` — Standing barbell overhead press, bar at forehead height mid-drive, ribs stacked over pelvis, glutes braced. Front three-quarter view, slightly low camera. HOT: anterior and lateral deltoid. WARM: triceps brachii, upper trapezius. RIM: erector spinae, rectus abdominis.
- `file: seated_db_shoulder_press.png` — Seated dumbbell shoulder press on an upright bench, dumbbells at ear height, elbows slightly forward of the torso. Three-quarter front view. HOT: anterior and lateral deltoid. WARM: triceps brachii, upper trapezius. RIM: rotator cuff.

### Horizontal pull

- `file: bent_over_row.png` — Bent-over barbell row, torso ~45°, bar drawn to the lower ribs, elbows past the torso, neutral spine. Three-quarter rear view showing the back. HOT: latissimus dorsi. WARM: rhomboids and mid trapezius, posterior deltoid, biceps brachii. RIM: erector spinae.
- `file: db_bent_row.png` — Two-dumbbell bent-over row, torso ~45°, dumbbells at the lower ribs, palms neutral. Three-quarter rear view. HOT: latissimus dorsi. WARM: rhomboids and mid trapezius, biceps brachii. RIM: erector spinae.
- `file: one_arm_db_row.png` — One-arm dumbbell row, opposite hand and knee braced on a flat bench, working-side dumbbell at the hip, torso square. Rear three-quarter view from the working side. HOT: latissimus dorsi. WARM: rhomboids and mid trapezius, biceps brachii. RIM: external oblique.

### Vertical pull

- `file: lat_pulldown.png` — Seated cable lat pulldown, wide bar drawn to collarbone height, thighs under the pad, slight backward lean. Front three-quarter view. HOT: latissimus dorsi. WARM: teres major, biceps brachii. RIM: lower trapezius.
- `file: dead_hang.png` — Passive dead hang from a straight pull-up bar, arms fully extended, shoulders relaxed into the hang, feet clear of the floor. Front view, full body. HOT: forearm flexors. RIM: latissimus dorsi, lower trapezius, rotator cuff.
- `file: db_pullover.png` — Dumbbell pullover lying across a flat bench, single dumbbell held over the chest with both hands, arms travelling back overhead, hips low. Side three-quarter view. HOT: latissimus dorsi. WARM: sternal head of pectoralis major, long head of triceps. RIM: serratus anterior.

### Rear delt and upper back

- `file: face_pull.png` — Cable face pull at eye height, rope handles pulled to either side of the face, elbows high and wide, external rotation visible. Front three-quarter view. HOT: posterior deltoid. WARM: rhomboids and mid trapezius, infraspinatus and teres minor. RIM: lower trapezius.
- `file: db_reverse_fly.png` — Bent-over dumbbell reverse fly, torso near-horizontal, arms wide at shoulder height, slight elbow bend. Rear three-quarter view. HOT: posterior deltoid. WARM: rhomboids and mid trapezius, infraspinatus. RIM: erector spinae.
- `file: db_lateral_raise.png` — Standing dumbbell lateral raise, arms at shoulder height, elbows soft, thumbs level with the little fingers. Front view. HOT: lateral deltoid. WARM: supraspinatus. RIM: upper trapezius.

### Arms

- `file: ez_curl.png` — Standing EZ-bar curl, bar at mid-rep around navel-to-chest height, elbows pinned to the ribs, supinated angled grip. Front three-quarter view. HOT: biceps brachii. WARM: brachialis, brachioradialis. RIM: anterior deltoid.
- `file: db_curl.png` — Standing supinated dumbbell curl, one arm at peak contraction, one extended. Front three-quarter view. HOT: biceps brachii. WARM: brachialis, brachioradialis.
- `file: db_hammer_curl.png` — Standing dumbbell hammer curl, neutral grip, both dumbbells at mid-rep. Front three-quarter view. HOT: brachioradialis and brachialis. WARM: biceps brachii.
- `file: triceps_pushdown.png` — Cable triceps pushdown, straight bar at mid-forearm height, elbows pinned to the ribs, slight forward lean. Side three-quarter view. HOT: lateral head of triceps brachii. WARM: medial head, anconeus. RIM: latissimus dorsi.
- `file: overhead_triceps_ext.png` — Seated overhead dumbbell triceps extension, single dumbbell held with both hands behind the head, elbows high and close. Rear three-quarter view. HOT: long head of triceps brachii. WARM: lateral head. RIM: rectus abdominis.

### Knee-dominant lower body

- `file: back_squat.png` — Barbell back squat at parallel depth, bar on the upper back, knees tracking over toes, neutral spine. Three-quarter front view, slightly low camera. HOT: quadriceps femoris. WARM: gluteus maximus, adductor magnus. RIM: erector spinae, rectus abdominis and obliques.
- `file: db_goblet_squat.png` — Dumbbell goblet squat at the bottom position, single dumbbell held vertically at the chest, elbows inside the knees, torso upright. Front three-quarter view. HOT: quadriceps femoris. WARM: gluteus maximus. RIM: rectus abdominis, anterior deltoid.
- `file: bulgarian_split_squat_db.png` — Bulgarian split squat at the bottom, rear foot elevated on a flat bench, front shin near-vertical, a dumbbell in each hand. Side three-quarter view. HOT: quadriceps femoris and gluteus maximus of the front leg. WARM: adductor magnus. RIM: gluteus medius.
- `file: db_walking_lunge.png` — Dumbbell walking lunge at the bottom of the step, rear knee just off the floor, torso upright, a dumbbell in each hand. Side three-quarter view. HOT: quadriceps femoris of the lead leg. WARM: gluteus maximus, hamstrings. RIM: gluteus medius.
- `file: db_reverse_lunge.png` — Dumbbell reverse lunge at the bottom, rear leg stepped back and knee just off the floor, front shin vertical, a dumbbell in each hand. Side three-quarter view. HOT: quadriceps femoris of the front leg. WARM: gluteus maximus, hamstrings. RIM: gluteus medius.
- `file: db_step_up.png` — Dumbbell step-up mid-drive, lead foot fully on a flat bench, trailing foot just leaving the floor, a dumbbell in each hand. Side three-quarter view. HOT: quadriceps femoris and gluteus maximus of the lead leg. WARM: hamstrings. RIM: gluteus medius.

### Hip-dominant lower body

- `file: rdl_barbell.png` — Barbell Romanian deadlift at the bottom, bar at mid-shin tracking the legs, hips pushed far back, flat back, soft knees. Side three-quarter view. HOT: hamstrings, biceps femoris prominent. WARM: gluteus maximus, erector spinae. RIM: latissimus dorsi, forearm flexors.
- `file: db_rdl.png` — Dumbbell Romanian deadlift at the bottom, dumbbells at mid-shin in front of the legs, hips back, flat back. Side three-quarter view. HOT: hamstrings. WARM: gluteus maximus, erector spinae. RIM: forearm flexors.
- `file: barbell_hip_thrust.png` — Barbell hip thrust at full lockout, upper back on a flat bench, loaded bar across the hips with a pad, shins vertical, ribs down. Side three-quarter view. HOT: gluteus maximus. WARM: hamstrings, quadriceps femoris. RIM: rectus abdominis.
- `file: db_hip_thrust.png` — Dumbbell hip thrust at full lockout, upper back on a flat bench, a single dumbbell across the hips, shins vertical. Side three-quarter view. HOT: gluteus maximus. WARM: hamstrings. RIM: rectus abdominis.

### Calves

- `file: standing_calf_raise_db.png` — Standing dumbbell calf raise at full plantarflexion, balls of the feet on a low step, heels far below, a dumbbell in each hand. Rear three-quarter view of the lower legs and torso. HOT: gastrocnemius. WARM: soleus. RIM: tibialis posterior.
- `file: db_calf_raise.png` — Standing dumbbell calf raise on flat ground at peak contraction, heels high, a dumbbell in each hand. Rear three-quarter view. HOT: gastrocnemius. WARM: soleus. RIM: tibialis posterior.

### Core

- `file: cable_pallof.png` — Cable Pallof press, standing side-on to the cable stack, arms fully extended at sternum height resisting rotation, feet shoulder-width. Front three-quarter view. HOT: external and internal oblique, transversus abdominis. WARM: rectus abdominis. RIM: gluteus medius.
- `file: bw_pallof.png` — Banded Pallof press, standing side-on to an anchored resistance band, arms fully extended at sternum height resisting rotation. Front three-quarter view. HOT: external and internal oblique, transversus abdominis. WARM: rectus abdominis.
- `file: core_circuit.png` — Front plank on the forearms, body in one straight line from heels to head, elbows under shoulders, no equipment. Side three-quarter view. HOT: rectus abdominis, transversus abdominis. WARM: external oblique, iliopsoas. RIM: erector spinae.

### Mobility and stability

- `file: couch_stretch.png` — Couch stretch, rear shin vertical against a wall with the knee on a mat, front foot planted, torso upright. Side three-quarter view. HOT: iliopsoas and rectus femoris of the rear leg. WARM: gluteus maximus of the rear leg. RIM: rectus abdominis.
- `file: hip_9090.png` — 90/90 hip sit on a mat, front shin across the body at 90°, rear shin at 90° behind, torso upright. Front three-quarter view. HOT: gluteus medius and piriformis of the front hip. WARM: adductor group. RIM: erector spinae.
- `file: adductor_rockback.png` — Adductor rock-back on a mat, quadruped with one leg extended straight to the side, hips rocking back toward the heels. Front three-quarter view. HOT: adductor magnus and longus of the extended leg. WARM: gluteus maximus. RIM: erector spinae.
- `file: ankle_rock.png` — Half-kneeling ankle dorsiflexion rock, front knee driving forward past the toes, heel flat on the floor, rear knee on a mat. Side view. HOT: soleus of the front leg. WARM: gastrocnemius. RIM: quadriceps femoris.
- `file: tib_raise.png` — Tibialis raise, standing with the back against a wall, heels forward of the hips, toes pulled up into full dorsiflexion. Side three-quarter view. HOT: tibialis anterior. WARM: extensor digitorum longus.
- `file: soleus_raise.png` — Bent-knee soleus raise, seated with knees bent 90° and heels lifted high, or standing with a deep knee bend. Side view of the lower legs and torso. HOT: soleus. WARM: gastrocnemius. RIM: tibialis posterior.
- `file: glute_bridge.png` — Glute bridge at full lockout on a mat, shoulders and feet down, hips high, shins vertical, ribs down. Side three-quarter view. HOT: gluteus maximus. WARM: hamstrings. RIM: transversus abdominis.
- `file: sl_hip_abduction.png` — Side-lying hip abduction, bottom leg bent, top leg straight and raised to about 35°, hips stacked. Front three-quarter view. HOT: gluteus medius. WARM: gluteus minimus, tensor fasciae latae. RIM: external oblique.
- `file: copenhagen.png` — Copenhagen plank, side plank on one forearm with the top leg's inner knee or foot resting on a flat bench, hips lifted and level. Front three-quarter view. HOT: adductor longus and magnus of the top leg. WARM: external and internal oblique. RIM: gluteus medius of the bottom side.
- `file: wall_sit.png` — Wall sit, back flat against a wall, hips and knees at 90°, shins vertical, arms free. Front three-quarter view. HOT: quadriceps femoris. WARM: gluteus maximus. RIM: transversus abdominis.
- `file: step_down.png` — Eccentric step-down from a low box, one leg supporting under control, the other heel reaching toward the floor, torso upright. Front three-quarter view. HOT: vastus medialis of the supporting leg. WARM: gluteus maximus. RIM: gluteus medius.
- `file: dead_bug.png` — Dead bug on a mat, lying supine with the opposite arm and leg extended and the other two at 90°, lower back flat. Three-quarter view from above the shoulder. HOT: transversus abdominis. WARM: rectus abdominis, external oblique. RIM: iliopsoas.
- `file: side_plank.png` — Side plank on one forearm, hips stacked and lifted, body in one straight line, feet stacked. Front three-quarter view. HOT: external and internal oblique of the down side. WARM: quadratus lumborum, gluteus medius. RIM: lateral deltoid.
- `file: bird_dog.png` — Bird dog on a mat, quadruped with the opposite arm and leg extended level with the torso, spine neutral, hips square. Side three-quarter view. HOT: erector spinae. WARM: gluteus maximus, transversus abdominis. RIM: posterior deltoid.

---

## Export spec

Save the raw generations into `fitness-tracker/img/exercises/` using the `file:` name
exactly — the app resolves images by exercise id, so a typo means a silent fallback to
the SVG figure.

| | |
|---|---|
| Format in | `<exercise_id>.png`, whatever size Nano Banana returns |
| Format out | `<exercise_id>.webp`, 1024×1024, quality 82 |
| Convert | `python tools/build-exercise-images.py` (writes the webp set, reports missing ids) |

Keep the PNGs — they are the masters, and a re-crop or a quality change should never
mean regenerating.

---

## QC checklist

Reject and regenerate if any of these show up. All four are common failure modes for
anatomical subjects.

- **Hand and foot anatomy** — the most frequent failure. Count the fingers.
- **Barbell plate count** — should be symmetric left to right.
- **Heat map bleeding** into muscles that are not on the list, or the whole figure
  going uniformly orange (means the reference lost its grip — restart the conversation).
- **Text** appearing anywhere despite BLOCK A.

Anatomical accuracy of the *muscles themselves* is worth a second look on the pulls
(lat insertion) and the hip hinges (hamstring origin) — image models routinely get the
scapula region wrong.
