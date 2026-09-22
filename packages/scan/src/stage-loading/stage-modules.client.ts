import type * as AlignModule from '@scanmate/align'
import type * as AuditModule from '@scanmate/audit'
import type * as DiffModule from '@scanmate/diff'
import type * as EnhanceModule from '@scanmate/enhance'
import type * as ExtractModule from '@scanmate/extract'
import type * as FindModule from '@scanmate/find'
import type { PipelineStage } from '@scanmate/ink'
import type * as InkModule from '@scanmate/ink'
import type * as MergeModule from '@scanmate/merge'
import type * as OcrModule from '@scanmate/ocr'

import { MissingStageError } from './missing-stage.error'

/**
 * A stage package is loaded the first time its stage is used, and not before.
 *
 * Every `@scanmate/*` import in this package is either an `import type`, which
 * TypeScript erases before anything runs, or an `await import()` here. There is
 * not one static value import, and that is the whole feature: a session that
 * only aligns never evaluates `tesseract.js`, never reads a language model,
 * never loads `pdfjs-dist` or `@cantoo/pdf-lib`.
 *
 * What it cannot avoid is `sharp`. Every stage depends on `@scanmate/ink`, which
 * loads libvips at module top level, so the floor for any method at all is ink
 * and its native codec.
 *
 * One loader per package, each with a **literal** specifier. A generic loader
 * keyed by a string would be shorter and would defeat every static analysis
 * that matters: Nx's project graph reads dynamic imports to build the
 * dependency graph, and bundlers need to see the literal to resolve it.
 *
 * Node's module registry already memoises, so the local handles do not save the
 * evaluation - they save a resolution round-trip, and they give
 * {@link loadedStages} something to report.
 *
 * That report is process-wide and one-way: loading happens once per process, so
 * a second session loads nothing, and nothing can be unloaded. It is a
 * debugging aid, and the in-process half of the lazy-loading test. The half
 * that proves anything spawns a child process and watches what it resolves.
 */

const loaded = new Set<PipelineStage>()

/** Which stage packages this process has loaded so far. */
export function loadedStages (): ReadonlySet<PipelineStage> {
  return new Set(loaded)
}

async function stage<Module> (name: PipelineStage, loading: Promise<Module>): Promise<Module> {
  try {
    const module = await loading
    loaded.add(name)

    return module
  } catch (error) {
    throw new MissingStageError(name, error)
  }
}

let ink: Promise<typeof InkModule> | undefined
/** The kernel. Not a stage - it is what every stage stands on. */
export function loadInk (): Promise<typeof InkModule> {
  ink ??= import('@scanmate/ink')

  return ink
}

let merge: Promise<typeof MergeModule> | undefined
export function loadMerge (): Promise<typeof MergeModule> {
  merge ??= stage('merge', import('@scanmate/merge'))

  return merge
}

let extract: Promise<typeof ExtractModule> | undefined
export function loadExtract (): Promise<typeof ExtractModule> {
  extract ??= stage('extract', import('@scanmate/extract'))

  return extract
}

let align: Promise<typeof AlignModule> | undefined
export function loadAlign (): Promise<typeof AlignModule> {
  align ??= stage('align', import('@scanmate/align'))

  return align
}

let enhance: Promise<typeof EnhanceModule> | undefined
export function loadEnhance (): Promise<typeof EnhanceModule> {
  enhance ??= stage('enhance', import('@scanmate/enhance'))

  return enhance
}

let ocr: Promise<typeof OcrModule> | undefined
export function loadOcr (): Promise<typeof OcrModule> {
  ocr ??= stage('ocr', import('@scanmate/ocr'))

  return ocr
}

let diff: Promise<typeof DiffModule> | undefined
export function loadDiff (): Promise<typeof DiffModule> {
  diff ??= stage('diff', import('@scanmate/diff'))

  return diff
}

let find: Promise<typeof FindModule> | undefined
export function loadFind (): Promise<typeof FindModule> {
  find ??= stage('find', import('@scanmate/find'))

  return find
}

let audit: Promise<typeof AuditModule> | undefined
export function loadAudit (): Promise<typeof AuditModule> {
  audit ??= stage('audit', import('@scanmate/audit'))

  return audit
}
