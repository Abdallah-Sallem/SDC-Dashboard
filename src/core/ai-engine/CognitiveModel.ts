/**
 * CognitiveModel.ts
 * RÔLE : Charge et exécute le modèle IA local (ONNX Runtime Web ou TF Lite).
 * Fonctionne dans un Web Worker pour ne jamais bloquer l'interface élève.
 * Phase 1 : modèle heuristique intégré. Phase 2 : fichier .onnx embarqué.
 */

 import { logger } from '../../shared/logger';
 import type { GazeMetrics } from '../../shared/types';
 
 /** Vecteur d'entrée normalisé envoyé au modèle */
 interface ModelInput {
   saccadeSpeed: number;
   fixationDuration: number;
   regressionCount: number;
   blinkRate: number;
   lineSkipRate: number;
 }
 
 /** Sortie du modèle */
 export interface ModelOutput {
   difficultyScore: number;   // [0..1]
   confidence: number;        // [0..1]
 }
 
 export class CognitiveModel {
   private modelLoaded = false;
   // Phase 2 : private session: ort.InferenceSession | null = null;
 
   async load(): Promise<void> {
     // Phase 2 : charger le fichier .onnx
     // this.session = await ort.InferenceSession.create('/models/qalam_cognitive_v1.onnx');
     // Pour Phase 1 : modèle heuristique, pas de chargement nécessaire
     this.modelLoaded = true;
     logger.info('CognitiveModel', 'Modèle chargé (mode heuristique Phase 1)');
   }
 
   /**
    * Exécute l'inférence sur les métriques.
    * Phase 1 : règles expertes. Phase 2 : inférence neuronale ONNX.
    */
   async predict(metrics: GazeMetrics): Promise<ModelOutput> {
     if (!this.modelLoaded) {
       throw new Error('Modèle non chargé — appeler load() d\'abord');
     }
 
     // ─── Phase 1 : Modèle heuristique ──────────────────────────────────────
     // Normalisation des features
     const input: ModelInput = {
       saccadeSpeed: this.normalize(metrics.saccadeSpeed, 0, 1000),
       fixationDuration: this.normalize(metrics.fixationDuration, 0, 800),
       regressionCount: this.normalize(metrics.regressionCount, 0, 10),
       blinkRate: this.normalize(metrics.blinkRate, 0, 50),
       lineSkipRate: metrics.lineSkipRate,
     };
 
     // Score heuristique simple mais efficace pour la Phase 1
     const score =
       (1 - input.saccadeSpeed) * 0.25 +      // Saccade lente = difficulté
       input.fixationDuration * 0.30 +          // Fixation longue = blocage
       input.regressionCount * 0.25 +           // Régressions = confusion
       input.blinkRate * 0.10 +                 // Clignements = fatigue
       input.lineSkipRate * 0.10;               // Sauts ligne = perte place
 
     const confidence = this.estimateConfidence(input);
 
     return {
       difficultyScore: Math.min(1, Math.max(0, score)),
       confidence,
     };
 
     // ─── Phase 2 : Inférence ONNX (décommenter quand modèle disponible) ────
     // const tensor = new ort.Tensor('float32', Object.values(input), [1, 5]);
     // const results = await this.session!.run({ input: tensor });
     // return {
     //   difficultyScore: results.output.data[0] as number,
     //   confidence: results.confidence.data[0] as number,
     // };
   }
 
   /** Normalise une valeur entre 0 et 1 */
   private normalize(value: number, min: number, max: number): number {
     return Math.min(1, Math.max(0, (value - min) / (max - min)));
   }
 
   /** Estime la confiance selon la cohérence des features */
   private estimateConfidence(input: ModelInput): number {
     // Plus les features sont élevées de façon cohérente, plus la confiance est haute
     const values = Object.values(input);
     const avg = values.reduce((a, b) => a + b, 0) / values.length;
     const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
     // Faible variance = signaux cohérents = haute confiance
     return Math.max(0.2, 1 - variance * 2);
   }
 }