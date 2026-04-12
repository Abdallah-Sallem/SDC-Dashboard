/**
 * constants.ts
 * RÔLE : Toutes les constantes globales du projet en un seul endroit.
 * Modifier une valeur ici la propage partout — jamais de "magic numbers" dispersés.
 */

// ─── Seuils d'adaptation ─────────────────────────────────────────────────────

/** Score minimum pour déclencher une adaptation légère */
export const DIFFICULTY_THRESHOLD_LIGHT = 0.3;

/** Score minimum pour déclencher une adaptation modérée */
export const DIFFICULTY_THRESHOLD_MODERATE = 0.55;

/** Score minimum pour déclencher une adaptation forte */
export const DIFFICULTY_THRESHOLD_STRONG = 0.75;

// ─── Eye-tracking ────────────────────────────────────────────────────────────

/** Fréquence cible du pipeline gaze */
export const EYE_TRACKING_TARGET_FPS = 20;

/** Fréquence de capture en ms (50ms = 20fps) */
export const EYE_TRACKING_INTERVAL_MS = Math.round(1000 / EYE_TRACKING_TARGET_FPS);

/** Seuil minimum de confiance d'un point gaze brut */
export const EYE_TRACKING_MIN_CONFIDENCE = 0.5;

/** Taille de fenêtre pour le lissage local dans EyeTracker */
export const EYE_TRACKING_SMOOTHING_WINDOW = 6;

/** Timeout sans points valides avant "face_lost" */
export const EYE_TRACKING_FACE_LOST_TIMEOUT_MS = 1500;

/** Nombre de callbacks null/invalides avant "camera_off" */
export const EYE_TRACKING_CAMERA_OFF_NULL_STREAK = 15;

/** Fenêtre de lissage pour la moyenne mobile (5-10 points recommandé) */
export const ADAPTIVE_LOOP_SMOOTHING_WINDOW = 7;

/** Seuil minimum de confiance d'un point de regard */
export const ADAPTIVE_LOOP_MIN_CONFIDENCE = 0.5;

/** Taille minimale du buffer pour extraire des features stables */
export const ADAPTIVE_LOOP_FEATURE_WINDOW = 24;

/** Délai anti-flicker entre deux adaptations UI */
export const ADAPTIVE_LOOP_COOLDOWN_MS = 2500;

/** Taux de clignement normal : 15–20 par minute */
export const BLINK_RATE_NORMAL_MIN = 12;
export const BLINK_RATE_NORMAL_MAX = 25;

/** Durée de fixation normale sur un mot : 150–400ms */
export const FIXATION_DURATION_NORMAL_MAX_MS = 400;

/** Seuil de régression : plus de 3 retours = difficulté */
export const REGRESSION_THRESHOLD = 3;

// ─── Paramètres CSS d'adaptation ─────────────────────────────────────────────

/** Valeurs par défaut (sans adaptation) */
export const CSS_DEFAULTS = {
  fontFamily: 'inherit',
  fontSize: '1rem',
  lineHeight: 1.6,
  letterSpacing: 'normal',
  wordSpacing: 'normal',
  backgroundColor: '#FFFFFF',
  textColor: '#1A1A1A',
} as const;

/** Adaptation légère — dyslexie légère ou fatigue modérée */
export const CSS_ADAPT_LIGHT = {
  lineHeight: 1.8,
  letterSpacing: '0.05em',
  wordSpacing: '0.1em',
  backgroundColor: '#FFFEF5',
} as const;

/** Adaptation modérée */
export const CSS_ADAPT_MODERATE = {
  fontFamily: 'AtkinsonHyperlegible',
  lineHeight: 2.0,
  letterSpacing: '0.1em',
  wordSpacing: '0.2em',
  backgroundColor: '#FFF8E7',
} as const;

/** Adaptation forte — dyslexie sévère */
export const CSS_ADAPT_STRONG = {
  fontFamily: 'OpenDyslexic',
  fontSize: '1.15rem',
  lineHeight: 2.4,
  letterSpacing: '0.15em',
  wordSpacing: '0.35em',
  backgroundColor: '#F0F4FF',
} as const;

// ─── Durées de transition ────────────────────────────────────────────────────

/** Transition rapide — changements discrets */
export const TRANSITION_FAST_MS = 300;

/** Transition normale */
export const TRANSITION_NORMAL_MS = 500;

/** Transition lente — changements visuels importants (police) */
export const TRANSITION_SLOW_MS = 800;

// ─── Sécurité ────────────────────────────────────────────────────────────────

/** Algorithme de chiffrement */
export const ENCRYPTION_ALGORITHM = 'AES-GCM';

/** Longueur de la clé en bits */
export const ENCRYPTION_KEY_LENGTH = 256;

/** Algorithme de dérivation de clé */
export const KEY_DERIVATION_ALGORITHM = 'PBKDF2';

/** Nombre d'itérations PBKDF2 */
export const PBKDF2_ITERATIONS = 310_000;

// ─── Stockage ────────────────────────────────────────────────────────────────

/** Nom de la base de données SQLite locale */
export const DB_NAME = 'qalam_sense_local';

/** Version du schéma de base de données */
export const DB_VERSION = 1;

// ─── Application ─────────────────────────────────────────────────────────────

/** Version de l'application */
export const APP_VERSION = '1.0.0';

// AVANT
//export const MAX_SESSION_DURATION_MS = 45 * 60 * 1000;

// APRÈS (2 minutes pour tester)
export const MAX_SESSION_DURATION_MS = 2 * 60 * 1000;

/** Langues supportées */
export const SUPPORTED_LANGUAGES = ['ar', 'fr'] as const;