import type { OcrEngine, TesseractEngineOptions } from '@scanmate/ocr'

import { fingerprint } from '../stage-caching'
import { loadOcr } from '../stage-loading'

/**
 * One OCR engine for the whole session.
 *
 * Both `ocrPages` and `auditPages` create an engine when none is passed and
 * terminate only the one they made; an engine handed to them is left running.
 * That contract is what makes a shared engine possible, and using it is not an
 * optimisation but the difference between one WASM start-up and one per call -
 * a language model is tens of megabytes into a fresh heap each time.
 *
 * Ownership is the whole of the rest: a session terminates what it created and
 * never what it was given.
 */

export interface EngineLease {
  engine: OcrEngine
  /** False when the caller supplied it: this session must not terminate it. */
  owned:  boolean
}

export class SharedEngine {
  #lease: Promise<EngineLease> | undefined
  #print: string | undefined

  constructor (
    private readonly supplied: OcrEngine | undefined,
    private readonly tesseract: () => TesseractEngineOptions | undefined,
  ) {}

  /**
   * The session's engine, made on first use.
   *
   * Different tesseract settings - another language, another cache directory -
   * are a different engine, so the old one is disposed of first rather than
   * silently answering with the wrong model.
   */
  async lease (): Promise<EngineLease> {
    const print = fingerprint(this.tesseract())
    if (this.#lease !== undefined && this.#print !== print) await this.dispose()
    this.#print = print
    this.#lease ??= (async (): Promise<EngineLease> => {
      if (this.supplied !== undefined) return { engine: this.supplied, owned: false }
      const { createTesseractEngine } = await loadOcr()

      return { engine: await createTesseractEngine(this.tesseract()), owned: true }
    })()

    return this.#lease
  }

  /** Whether an engine has been asked for yet. A session that never reads never starts one. */
  get started (): boolean {
    return this.#lease !== undefined
  }

  /** Terminates an engine this session created. Idempotent, and safe to call when none was. */
  async dispose (): Promise<void> {
    const lease = this.#lease
    this.#lease = undefined
    this.#print = undefined
    if (lease === undefined) return

    // Awaited even when it turns out not to be ours: the creation may still be
    // in flight, and abandoning it would leak the worker it is starting.
    const { engine, owned } = await lease
    if (owned) await engine.terminate()
  }
}
