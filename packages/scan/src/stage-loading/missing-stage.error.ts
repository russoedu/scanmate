/** The stages that live in packages of their own, loaded the first time they are used. */
export type LoadedStage = 'merge' | 'extract' | 'align' | 'ocr'

/** The package each of those stages lives in. */
export const STAGE_PACKAGES: Readonly<Record<LoadedStage, string>> = {
  merge:   '@scanmate/merge',
  extract: '@scanmate/extract',
  align:   '@scanmate/align',
  ocr:     '@scanmate/ocr',
}

/**
 * A stage package could not be loaded.
 *
 * Every stage is an ordinary dependency, so this should not happen on a healthy
 * install - it is here because the failure it reports is otherwise a bare
 * `ERR_MODULE_NOT_FOUND` from a dynamic import, with no hint of which stage the
 * caller asked for or what to install.
 */
export class MissingStageError extends Error {
  readonly stage:       LoadedStage
  readonly packageName: string

  constructor (stage: LoadedStage, cause: unknown) {
    const packageName = STAGE_PACKAGES[stage]
    super(`the ${stage} stage needs ${packageName}, which could not be loaded - install it with "npm install ${packageName}"`, { cause })
    this.name = 'MissingStageError'
    this.stage = stage
    this.packageName = packageName
  }
}
