import type { Raster } from '@scanmate/ink'
import type { OcrEngine, RecogniseHints, RecognisedText } from '@scanmate/ocr'

/**
 * An engine that starts on its first read, for handing to sessions that may
 * never read at all.
 *
 * A run of sessions should share one engine - each start is a WASM worker and a
 * language model - but a run that only compares pixels should start none.
 * Creating the engine up front gets the first right and the second wrong. This
 * is given to every session as an engine it did not create, which a session
 * never terminates; the run that made it calls {@link release} when it is done.
 */
export class LazyEngine implements OcrEngine {
  #engine: Promise<OcrEngine> | undefined
  #ready:  OcrEngine | undefined

  constructor (private readonly create: () => Promise<OcrEngine>) {}

  async #start (): Promise<OcrEngine> {
    const engine = await this.create()
    this.#ready = engine

    return engine
  }

  #started (): OcrEngine {
    if (this.#ready === undefined) throw new Error('the engine has not read anything yet, so it has no name, version or languages')

    return this.#ready
  }

  get name (): string { return this.#started().name }
  get version (): string { return this.#started().version }
  get languages (): readonly string[] { return this.#started().languages }

  /** Whether anything has read with it yet. */
  get started (): boolean {
    return this.#engine !== undefined
  }

  async recognise (image: Raster | Uint8Array, hints?: RecogniseHints): Promise<RecognisedText> {
    this.#engine ??= this.#start()
    const engine = await this.#engine

    return await engine.recognise(image, hints)
  }

  /** A session never terminates an engine it was given; {@link release} is the owner's. */
  async terminate (): Promise<void> {}

  /** Terminates the engine, if one was started. */
  async release (): Promise<void> {
    const pending = this.#engine
    this.#engine = undefined
    this.#ready = undefined
    if (pending === undefined) return
    const engine = await pending
    await engine.terminate()
  }
}
