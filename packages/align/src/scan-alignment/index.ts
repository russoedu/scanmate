/** The whole alignment: decode, estimate, pick a model, warp, and say how far to trust it. */

export { alignPages } from './align-pages.use-case'
export type { AlignPagesOptions } from './align-pages.use-case'
export type { AlignDiagnostics, AlignOptions, AlignResult, ModelAttempt } from './align-result.contract'
export { alignScan } from './align-scan.use-case'
export { DEFAULT_MODELS, prefers } from './model-selection.policy'
export type { ScoredModel } from './model-selection.policy'
export { polishTranslation } from './polish-translation.algorithm'
