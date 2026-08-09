// exercise-anatomy.js — per-exercise muscle attribution with ANATOMICAL names
// and biomechanical roles. Two consumers:
//   1. the illustration prompt pack (tools/illustration-prompts.md) — which
//      muscles the render must light, and how hot;
//   2. the app's exercise-detail labels (callouts in the reference style) and
//      the anatomy.js body map, via `group` (one of anatomy.js MUSCLE_GROUPS).
//
// `role` drives BOTH the label suffix and the heat-map temperature:
//   primary    → white-hot core → yellow → orange     (the prime mover)
//   synergist  → orange → amber                        (assists the movement)
//   stabilizer → green-yellow rim only                 (isometric, holds position)
//
// Ordering matters: the first entry is the primary mover, and the app renders
// callouts top-to-bottom in this order.

export const ROLES = {
  primary: { label: "PRIMARY MOVER", heat: 1.0 },
  synergist: { label: "SYNERGIST", heat: 0.6 },
  stabilizer: { label: "STABILIZER", heat: 0.25 },
};

const m = (label, role, group) => ({ label, role, group });

export const EXERCISE_ANATOMY = {
  // ---------- horizontal press ----------
  bench_press: [
    m("Pectoralis major", "primary", "Chest"),
    m("Anterior deltoid", "synergist", "Shoulders"),
    m("Triceps brachii", "synergist", "Triceps"),
    m("Serratus anterior", "stabilizer", "Chest"),
    m("Latissimus dorsi", "stabilizer", "Back"),
  ],
  db_bench_press: [
    m("Pectoralis major", "primary", "Chest"),
    m("Anterior deltoid", "synergist", "Shoulders"),
    m("Triceps brachii", "synergist", "Triceps"),
    m("Rotator cuff", "stabilizer", "Shoulders"),
    m("Serratus anterior", "stabilizer", "Chest"),
  ],
  incline_db_press: [
    m("Pectoralis major (clavicular head)", "primary", "Chest"),
    m("Anterior deltoid", "synergist", "Shoulders"),
    m("Triceps brachii", "synergist", "Triceps"),
    m("Serratus anterior", "stabilizer", "Chest"),
  ],

  push_up: [
    m("Pectoralis major", "primary", "Chest"),
    m("Triceps brachii", "synergist", "Triceps"),
    m("Anterior deltoid", "synergist", "Shoulders"),
    m("Serratus anterior", "stabilizer", "Chest"),
    m("Rectus abdominis", "stabilizer", "Core"),
  ],

  // ---------- vertical press ----------
  ohp_barbell: [
    m("Deltoid (anterior & lateral)", "primary", "Shoulders"),
    m("Triceps brachii", "synergist", "Triceps"),
    m("Upper trapezius", "synergist", "Back"),
    m("Erector spinae", "stabilizer", "Back"),
    m("Rectus abdominis", "stabilizer", "Core"),
  ],
  seated_db_shoulder_press: [
    m("Deltoid (anterior & lateral)", "primary", "Shoulders"),
    m("Triceps brachii", "synergist", "Triceps"),
    m("Upper trapezius", "synergist", "Back"),
    m("Rotator cuff", "stabilizer", "Shoulders"),
  ],

  // ---------- horizontal pull ----------
  bent_over_row: [
    m("Latissimus dorsi", "primary", "Back"),
    m("Rhomboids & mid trapezius", "synergist", "Back"),
    m("Posterior deltoid", "synergist", "Shoulders"),
    m("Biceps brachii", "synergist", "Biceps"),
    m("Erector spinae", "stabilizer", "Back"),
  ],
  db_bent_row: [
    m("Latissimus dorsi", "primary", "Back"),
    m("Rhomboids & mid trapezius", "synergist", "Back"),
    m("Biceps brachii", "synergist", "Biceps"),
    m("Erector spinae", "stabilizer", "Back"),
  ],
  one_arm_db_row: [
    m("Latissimus dorsi", "primary", "Back"),
    m("Rhomboids & mid trapezius", "synergist", "Back"),
    m("Biceps brachii", "synergist", "Biceps"),
    m("External oblique", "stabilizer", "Core"),
  ],

  // ---------- vertical pull ----------
  inverted_row: [
    m("Latissimus dorsi", "primary", "Back"),
    m("Rhomboids & mid-trapezius", "synergist", "Back"),
    m("Biceps brachii", "synergist", "Biceps"),
    m("Posterior deltoid", "synergist", "Shoulders"),
    m("Rectus abdominis", "stabilizer", "Core"),
  ],
  pull_up: [
    m("Latissimus dorsi", "primary", "Back"),
    m("Biceps brachii", "synergist", "Biceps"),
    m("Teres major", "synergist", "Back"),
    m("Lower trapezius", "synergist", "Back"),
    m("Forearm flexors", "stabilizer", "Biceps"),
  ],
  lat_pulldown: [
    m("Latissimus dorsi", "primary", "Back"),
    m("Teres major", "synergist", "Back"),
    m("Biceps brachii", "synergist", "Biceps"),
    m("Lower trapezius", "stabilizer", "Back"),
  ],
  dead_hang: [
    m("Forearm flexors", "primary", "Forearms"),
    m("Latissimus dorsi", "stabilizer", "Back"),
    m("Lower trapezius", "stabilizer", "Back"),
    m("Rotator cuff", "stabilizer", "Shoulders"),
  ],
  db_pullover: [
    m("Latissimus dorsi", "primary", "Back"),
    m("Pectoralis major (sternal head)", "synergist", "Chest"),
    m("Long head of triceps", "synergist", "Triceps"),
    m("Serratus anterior", "stabilizer", "Chest"),
  ],

  // ---------- rear delt / upper back ----------
  face_pull: [
    m("Posterior deltoid", "primary", "Shoulders"),
    m("Rhomboids & mid trapezius", "synergist", "Back"),
    m("Infraspinatus & teres minor", "synergist", "Back"),
    m("Lower trapezius", "stabilizer", "Back"),
  ],
  db_reverse_fly: [
    m("Posterior deltoid", "primary", "Shoulders"),
    m("Rhomboids & mid trapezius", "synergist", "Back"),
    m("Infraspinatus", "synergist", "Back"),
    m("Erector spinae", "stabilizer", "Back"),
  ],
  db_lateral_raise: [
    m("Lateral deltoid", "primary", "Shoulders"),
    m("Supraspinatus", "synergist", "Shoulders"),
    m("Upper trapezius", "stabilizer", "Back"),
  ],

  // ---------- arms ----------
  ez_curl: [
    m("Biceps brachii", "primary", "Biceps"),
    m("Brachialis", "synergist", "Biceps"),
    m("Brachioradialis", "synergist", "Forearms"),
    m("Anterior deltoid", "stabilizer", "Shoulders"),
  ],
  db_curl: [
    m("Biceps brachii", "primary", "Biceps"),
    m("Brachialis", "synergist", "Biceps"),
    m("Brachioradialis", "synergist", "Forearms"),
  ],
  db_hammer_curl: [
    m("Brachioradialis", "primary", "Forearms"),
    m("Brachialis", "primary", "Biceps"),
    m("Biceps brachii", "synergist", "Biceps"),
  ],
  triceps_pushdown: [
    m("Triceps brachii (lateral head)", "primary", "Triceps"),
    m("Triceps brachii (medial head)", "synergist", "Triceps"),
    m("Anconeus", "synergist", "Triceps"),
    m("Latissimus dorsi", "stabilizer", "Back"),
  ],
  overhead_triceps_ext: [
    m("Triceps brachii (long head)", "primary", "Triceps"),
    m("Triceps brachii (lateral head)", "synergist", "Triceps"),
    m("Rectus abdominis", "stabilizer", "Core"),
  ],

  // ---------- knee-dominant lower ----------
  back_squat: [
    m("Quadriceps femoris", "primary", "Quads"),
    m("Gluteus maximus", "synergist", "Glutes"),
    m("Adductor magnus", "synergist", "Quads"),
    m("Erector spinae", "stabilizer", "Back"),
    m("Rectus abdominis & obliques", "stabilizer", "Core"),
  ],
  bodyweight_squats: [
    m("Quadriceps femoris", "primary", "Quads"),
    m("Gluteus maximus", "synergist", "Glutes"),
    m("Adductor magnus", "synergist", "Glutes"),
    m("Erector spinae", "stabilizer", "Back"),
  ],
  db_goblet_squat: [
    m("Quadriceps femoris", "primary", "Quads"),
    m("Gluteus maximus", "synergist", "Glutes"),
    m("Rectus abdominis", "stabilizer", "Core"),
    m("Anterior deltoid", "stabilizer", "Shoulders"),
  ],
  bulgarian_split_squat_db: [
    m("Quadriceps femoris", "primary", "Quads"),
    m("Gluteus maximus", "primary", "Glutes"),
    m("Adductor magnus", "synergist", "Quads"),
    m("Gluteus medius", "stabilizer", "Glutes"),
  ],
  db_walking_lunge: [
    m("Quadriceps femoris", "primary", "Quads"),
    m("Gluteus maximus", "synergist", "Glutes"),
    m("Hamstrings", "synergist", "Hamstrings"),
    m("Gluteus medius", "stabilizer", "Glutes"),
  ],
  bw_lunge: [
    m("Quadriceps femoris", "primary", "Quads"),
    m("Gluteus maximus", "synergist", "Glutes"),
    m("Gluteus medius", "stabilizer", "Glutes"),
    m("Adductor magnus", "stabilizer", "Glutes"),
  ],
  db_reverse_lunge: [
    m("Quadriceps femoris", "primary", "Quads"),
    m("Gluteus maximus", "synergist", "Glutes"),
    m("Hamstrings", "synergist", "Hamstrings"),
    m("Gluteus medius", "stabilizer", "Glutes"),
  ],
  db_step_up: [
    m("Quadriceps femoris", "primary", "Quads"),
    m("Gluteus maximus", "primary", "Glutes"),
    m("Hamstrings", "synergist", "Hamstrings"),
    m("Gluteus medius", "stabilizer", "Glutes"),
  ],

  // ---------- hip-dominant lower ----------
  rdl_barbell: [
    m("Hamstrings (biceps femoris)", "primary", "Hamstrings"),
    m("Gluteus maximus", "synergist", "Glutes"),
    m("Erector spinae", "synergist", "Back"),
    m("Latissimus dorsi", "stabilizer", "Back"),
    m("Forearm flexors", "stabilizer", "Forearms"),
  ],
  db_rdl: [
    m("Hamstrings (biceps femoris)", "primary", "Hamstrings"),
    m("Gluteus maximus", "synergist", "Glutes"),
    m("Erector spinae", "synergist", "Back"),
    m("Forearm flexors", "stabilizer", "Forearms"),
  ],
  barbell_hip_thrust: [
    m("Gluteus maximus", "primary", "Glutes"),
    m("Hamstrings", "synergist", "Hamstrings"),
    m("Quadriceps femoris", "synergist", "Quads"),
    m("Rectus abdominis", "stabilizer", "Core"),
  ],
  db_hip_thrust: [
    m("Gluteus maximus", "primary", "Glutes"),
    m("Hamstrings", "synergist", "Hamstrings"),
    m("Rectus abdominis", "stabilizer", "Core"),
  ],

  // ---------- calves ----------
  standing_calf_raise_db: [
    m("Gastrocnemius", "primary", "Calves"),
    m("Soleus", "synergist", "Calves"),
    m("Tibialis posterior", "stabilizer", "Calves"),
  ],
  db_calf_raise: [
    m("Gastrocnemius", "primary", "Calves"),
    m("Soleus", "synergist", "Calves"),
    m("Tibialis posterior", "stabilizer", "Calves"),
  ],

  // ---------- core ----------
  cable_pallof: [
    m("External & internal oblique", "primary", "Core"),
    m("Transversus abdominis", "primary", "Core"),
    m("Rectus abdominis", "synergist", "Core"),
    m("Gluteus medius", "stabilizer", "Glutes"),
  ],
  bw_pallof: [
    m("External & internal oblique", "primary", "Core"),
    m("Transversus abdominis", "primary", "Core"),
    m("Rectus abdominis", "synergist", "Core"),
  ],
  core_circuit: [
    m("Rectus abdominis", "primary", "Core"),
    m("Transversus abdominis", "primary", "Core"),
    m("External oblique", "synergist", "Core"),
    m("Hip flexors (iliopsoas)", "synergist", "Quads"),
    m("Erector spinae", "stabilizer", "Back"),
  ],

  // ---------- mobility & stability ----------
  couch_stretch: [
    m("Iliopsoas & rectus femoris", "primary", "Quads"),
    m("Gluteus maximus (trail side)", "synergist", "Glutes"),
    m("Rectus abdominis", "stabilizer", "Core"),
  ],
  hip_9090: [
    m("Gluteus medius & piriformis", "primary", "Glutes"),
    m("Adductor group", "synergist", "Quads"),
    m("Erector spinae", "stabilizer", "Back"),
  ],
  adductor_rockback: [
    m("Adductor magnus & longus", "primary", "Quads"),
    m("Gluteus maximus", "synergist", "Glutes"),
    m("Erector spinae", "stabilizer", "Back"),
  ],
  ankle_rock: [
    m("Soleus", "primary", "Calves"),
    m("Gastrocnemius", "synergist", "Calves"),
    m("Quadriceps femoris", "stabilizer", "Quads"),
  ],
  tib_raise: [
    m("Tibialis anterior", "primary", "Calves"),
    m("Extensor digitorum longus", "synergist", "Calves"),
  ],
  soleus_raise: [
    m("Soleus", "primary", "Calves"),
    m("Gastrocnemius", "synergist", "Calves"),
    m("Tibialis posterior", "stabilizer", "Calves"),
  ],
  glute_bridge: [
    m("Gluteus maximus", "primary", "Glutes"),
    m("Hamstrings", "synergist", "Hamstrings"),
    m("Transversus abdominis", "stabilizer", "Core"),
  ],
  sl_hip_abduction: [
    m("Gluteus medius", "primary", "Glutes"),
    m("Gluteus minimus", "synergist", "Glutes"),
    m("Tensor fasciae latae", "synergist", "Quads"),
    m("External oblique", "stabilizer", "Core"),
  ],
  copenhagen: [
    m("Adductor longus & magnus", "primary", "Quads"),
    m("External & internal oblique", "synergist", "Core"),
    m("Gluteus medius (top side)", "stabilizer", "Glutes"),
  ],
  wall_sit: [
    m("Quadriceps femoris", "primary", "Quads"),
    m("Gluteus maximus", "synergist", "Glutes"),
    m("Transversus abdominis", "stabilizer", "Core"),
  ],
  step_down: [
    m("Quadriceps femoris (vastus medialis)", "primary", "Quads"),
    m("Gluteus maximus", "synergist", "Glutes"),
    m("Gluteus medius", "stabilizer", "Glutes"),
  ],
  dead_bug: [
    m("Transversus abdominis", "primary", "Core"),
    m("Rectus abdominis", "synergist", "Core"),
    m("External oblique", "synergist", "Core"),
    m("Hip flexors (iliopsoas)", "stabilizer", "Quads"),
  ],
  side_plank: [
    m("External & internal oblique", "primary", "Core"),
    m("Quadratus lumborum", "synergist", "Back"),
    m("Gluteus medius", "synergist", "Glutes"),
    m("Lateral deltoid", "stabilizer", "Shoulders"),
  ],
  bird_dog: [
    m("Erector spinae", "primary", "Back"),
    m("Gluteus maximus", "synergist", "Glutes"),
    m("Transversus abdominis", "synergist", "Core"),
    m("Posterior deltoid", "stabilizer", "Shoulders"),
  ],

  // --- library expansion ------------------------------------------------------
  deadlift: [
    m("Gluteus maximus", "primary", "Glutes"),
    m("Hamstrings", "primary", "Hamstrings"),
    m("Erector spinae", "synergist", "Back"),
    m("Quadriceps femoris", "synergist", "Quads"),
    m("Trapezius", "stabilizer", "Back"),
    m("Forearm flexors", "stabilizer", "Biceps"),
  ],
  sumo_deadlift: [
    m("Gluteus maximus", "primary", "Glutes"),
    m("Adductor magnus", "synergist", "Glutes"),
    m("Quadriceps femoris", "synergist", "Quads"),
    m("Erector spinae", "synergist", "Back"),
  ],
  trap_bar_deadlift: [
    m("Quadriceps femoris", "primary", "Quads"),
    m("Gluteus maximus", "synergist", "Glutes"),
    m("Erector spinae", "synergist", "Back"),
    m("Trapezius", "stabilizer", "Back"),
  ],
  rack_pull: [
    m("Erector spinae", "primary", "Back"),
    m("Trapezius", "synergist", "Back"),
    m("Gluteus maximus", "synergist", "Glutes"),
  ],
  good_morning: [
    m("Hamstrings", "primary", "Hamstrings"),
    m("Erector spinae", "synergist", "Back"),
    m("Gluteus maximus", "synergist", "Glutes"),
  ],
  cable_pull_through: [
    m("Gluteus maximus", "primary", "Glutes"),
    m("Hamstrings", "synergist", "Hamstrings"),
  ],
  single_leg_rdl: [
    m("Hamstrings", "primary", "Hamstrings"),
    m("Gluteus maximus", "synergist", "Glutes"),
    m("Gluteus medius", "stabilizer", "Glutes"),
  ],
  front_squat: [
    m("Quadriceps femoris", "primary", "Quads"),
    m("Gluteus maximus", "synergist", "Glutes"),
    m("Rectus abdominis", "synergist", "Core"),
    m("Erector spinae", "stabilizer", "Back"),
  ],
  box_squat: [
    m("Quadriceps femoris", "primary", "Quads"),
    m("Gluteus maximus", "synergist", "Glutes"),
  ],
  smith_squat: [
    m("Quadriceps femoris", "primary", "Quads"),
    m("Gluteus maximus", "synergist", "Glutes"),
  ],
  hack_squat: [
    m("Quadriceps femoris", "primary", "Quads"),
    m("Gluteus maximus", "synergist", "Glutes"),
  ],
  leg_press: [
    m("Quadriceps femoris", "primary", "Quads"),
    m("Gluteus maximus", "synergist", "Glutes"),
    m("Adductor magnus", "stabilizer", "Glutes"),
  ],
  leg_extension: [
    m("Quadriceps femoris", "primary", "Quads"),
    m("Rectus femoris", "primary", "Quads"),
  ],
  leg_curl: [
    m("Hamstrings", "primary", "Hamstrings"),
    m("Gastrocnemius", "synergist", "Calves"),
  ],
  goblet_curtsy_lunge: [
    m("Gluteus medius", "primary", "Glutes"),
    m("Quadriceps femoris", "synergist", "Quads"),
  ],
  front_rack_lunge: [
    m("Quadriceps femoris", "primary", "Quads"),
    m("Gluteus maximus", "synergist", "Glutes"),
    m("Rectus abdominis", "stabilizer", "Core"),
  ],
  seated_calf_raise: [
    m("Soleus", "primary", "Calves"),
    m("Gastrocnemius", "synergist", "Calves"),
  ],
  standing_calf_raise_machine: [
    m("Gastrocnemius", "primary", "Calves"),
    m("Soleus", "synergist", "Calves"),
  ],
  donkey_calf_raise: [
    m("Gastrocnemius", "primary", "Calves"),
    m("Soleus", "synergist", "Calves"),
  ],
  back_extension: [
    m("Gluteus maximus", "primary", "Glutes"),
    m("Erector spinae", "primary", "Back"),
    m("Hamstrings", "synergist", "Hamstrings"),
  ],
  dip: [
    m("Pectoralis major (sternal head)", "primary", "Chest"),
    m("Triceps brachii", "primary", "Triceps"),
    m("Anterior deltoid", "synergist", "Shoulders"),
    m("Rectus abdominis", "stabilizer", "Core"),
  ],
  incline_barbell_press: [
    m("Pectoralis major (clavicular head)", "primary", "Chest"),
    m("Anterior deltoid", "synergist", "Shoulders"),
    m("Triceps brachii", "synergist", "Triceps"),
  ],
  close_grip_bench: [
    m("Triceps brachii", "primary", "Triceps"),
    m("Pectoralis major", "synergist", "Chest"),
    m("Anterior deltoid", "synergist", "Shoulders"),
  ],
  db_floor_press: [
    m("Pectoralis major", "primary", "Chest"),
    m("Triceps brachii", "synergist", "Triceps"),
  ],
  machine_chest_press: [
    m("Pectoralis major", "primary", "Chest"),
    m("Triceps brachii", "synergist", "Triceps"),
    m("Anterior deltoid", "synergist", "Shoulders"),
  ],
  db_chest_fly: [
    m("Pectoralis major", "primary", "Chest"),
    m("Anterior deltoid", "stabilizer", "Shoulders"),
  ],
  cable_fly: [
    m("Pectoralis major", "primary", "Chest"),
    m("Anterior deltoid", "stabilizer", "Shoulders"),
  ],
  machine_shoulder_press: [
    m("Deltoid (anterior & lateral)", "primary", "Shoulders"),
    m("Triceps brachii", "synergist", "Triceps"),
  ],
  arnold_press: [
    m("Deltoid (all heads)", "primary", "Shoulders"),
    m("Triceps brachii", "synergist", "Triceps"),
    m("Rotator cuff", "stabilizer", "Shoulders"),
  ],
  push_press: [
    m("Deltoid (anterior & lateral)", "primary", "Shoulders"),
    m("Triceps brachii", "synergist", "Triceps"),
    m("Quadriceps femoris", "synergist", "Quads"),
    m("Rectus abdominis", "stabilizer", "Core"),
  ],
  landmine_press: [
    m("Anterior deltoid", "primary", "Shoulders"),
    m("Pectoralis major (clavicular head)", "synergist", "Chest"),
    m("Serratus anterior", "synergist", "Chest"),
  ],
  z_press: [
    m("Deltoid (anterior & lateral)", "primary", "Shoulders"),
    m("Triceps brachii", "synergist", "Triceps"),
    m("Rectus abdominis", "synergist", "Core"),
  ],
  chin_up: [
    m("Latissimus dorsi", "primary", "Back"),
    m("Biceps brachii", "primary", "Biceps"),
    m("Teres major", "synergist", "Back"),
    m("Lower trapezius", "synergist", "Back"),
  ],
  seated_cable_row: [
    m("Latissimus dorsi", "primary", "Back"),
    m("Rhomboids & mid-trapezius", "synergist", "Back"),
    m("Biceps brachii", "synergist", "Biceps"),
    m("Erector spinae", "stabilizer", "Back"),
  ],
  machine_row: [
    m("Latissimus dorsi", "primary", "Back"),
    m("Rhomboids", "synergist", "Back"),
    m("Biceps brachii", "synergist", "Biceps"),
  ],
  pendlay_row: [
    m("Latissimus dorsi", "primary", "Back"),
    m("Rhomboids", "synergist", "Back"),
    m("Biceps brachii", "synergist", "Biceps"),
    m("Erector spinae", "stabilizer", "Back"),
  ],
  t_bar_row: [
    m("Latissimus dorsi", "primary", "Back"),
    m("Rhomboids & mid-trapezius", "synergist", "Back"),
    m("Biceps brachii", "synergist", "Biceps"),
  ],
  chest_supported_row: [
    m("Rhomboids & mid-trapezius", "primary", "Back"),
    m("Latissimus dorsi", "synergist", "Back"),
    m("Posterior deltoid", "synergist", "Shoulders"),
  ],
  band_pull_apart: [
    m("Posterior deltoid", "primary", "Shoulders"),
    m("Rhomboids", "synergist", "Back"),
  ],
  face_pull_band: [
    m("Posterior deltoid", "primary", "Shoulders"),
    m("External rotators", "synergist", "Shoulders"),
    m("Mid-trapezius", "synergist", "Back"),
  ],
  db_shrug: [
    m("Upper trapezius", "primary", "Back"),
    m("Levator scapulae", "synergist", "Back"),
  ],
  barbell_shrug: [
    m("Upper trapezius", "primary", "Back"),
    m("Levator scapulae", "synergist", "Back"),
  ],
  farmers_carry: [
    m("Upper trapezius", "primary", "Back"),
    m("Forearm flexors", "primary", "Biceps"),
    m("Obliques", "synergist", "Core"),
    m("Gluteus medius", "stabilizer", "Glutes"),
  ],
  cable_lateral_raise: [
    m("Lateral deltoid", "primary", "Shoulders"),
    m("Supraspinatus", "synergist", "Shoulders"),
  ],
  preacher_curl: [
    m("Biceps brachii (short head)", "primary", "Biceps"),
    m("Brachialis", "synergist", "Biceps"),
  ],
  cable_curl: [
    m("Biceps brachii", "primary", "Biceps"),
    m("Brachialis", "synergist", "Biceps"),
  ],
  incline_db_curl: [
    m("Biceps brachii (long head)", "primary", "Biceps"),
    m("Brachialis", "synergist", "Biceps"),
  ],
  concentration_curl: [
    m("Biceps brachii", "primary", "Biceps"),
    m("Brachialis", "synergist", "Biceps"),
  ],
  reverse_curl: [
    m("Brachioradialis", "primary", "Biceps"),
    m("Brachialis", "synergist", "Biceps"),
  ],
  wrist_curl: [
    m("Forearm flexors", "primary", "Biceps"),
  ],
  skullcrusher: [
    m("Triceps brachii (long head)", "primary", "Triceps"),
    m("Triceps brachii (lateral head)", "synergist", "Triceps"),
  ],
  db_skullcrusher: [
    m("Triceps brachii (long head)", "primary", "Triceps"),
  ],
  cable_overhead_ext: [
    m("Triceps brachii (long head)", "primary", "Triceps"),
  ],
  hanging_knee_raise: [
    m("Rectus abdominis (lower)", "primary", "Core"),
    m("Hip flexors", "synergist", "Quads"),
    m("Latissimus dorsi", "stabilizer", "Back"),
  ],
  ab_wheel: [
    m("Rectus abdominis", "primary", "Core"),
    m("Latissimus dorsi", "synergist", "Back"),
    m("Erector spinae", "stabilizer", "Back"),
  ],
  cable_woodchop: [
    m("Obliques", "primary", "Core"),
    m("Rectus abdominis", "synergist", "Core"),
  ],
  russian_twist: [
    m("Obliques", "primary", "Core"),
    m("Rectus abdominis", "synergist", "Core"),
  ],
  plank: [
    m("Rectus abdominis", "primary", "Core"),
    m("Transverse abdominis", "synergist", "Core"),
    m("Anterior deltoid", "stabilizer", "Shoulders"),
  ],
  hollow_hold: [
    m("Rectus abdominis", "primary", "Core"),
    m("Hip flexors", "synergist", "Quads"),
  ],
};

// Aliases → an exercise that shares the same muscle picture.
const ALIAS = {
  adductors: "hip_9090",
  glutes: "hip_9090",
  glute_figure4: "hip_9090",
  hip_flexors: "couch_stretch",
  quads: "couch_stretch",
  hamstrings: "db_rdl",
  calves: "soleus_raise",
  lats: "lat_pulldown",
  backward_walk: "step_down",
};

// The muscle list for an exercise id, or null if we have no attribution.
export function anatomyFor(exerciseId) {
  const id = ALIAS[exerciseId] || exerciseId;
  return EXERCISE_ANATOMY[id] || null;
}

// Muscle groups lit by an exercise, as {group: heat 0..1} — feeds anatomy.js
// `muscleBody(colorOf)` so the body map shades by role, not just on/off.
export function heatByGroup(exerciseId) {
  const list = anatomyFor(exerciseId);
  if (!list) return {};
  const acc = {};
  for (const item of list) {
    const h = ROLES[item.role].heat;
    if (!(acc[item.group] >= h)) acc[item.group] = h;
  }
  return acc;
}

// "Pectoralis major (primary mover)" style caption for one entry.
export const captionFor = (item) => `${item.label} (${ROLES[item.role].label.toLowerCase()})`;
