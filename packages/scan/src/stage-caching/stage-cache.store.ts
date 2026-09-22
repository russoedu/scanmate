/**
 * What a session remembers, and when it forgets.
 *
 * Two decisions carry this file.
 *
 * **Promises are cached, not values.** A second call arriving while the first
 * is still running has to join it rather than start a rival run, or
 * `Promise.all([session.ocr(), session.diff()])` aligns the document twice.
 * A rejected run is evicted instead, so one transient failure does not make the
 * session permanently broken.
 *
 * **A stage that re-runs drops everything downstream of it.** Aligning with a
 * different model invalidates the diff that was measured on the old alignment,
 * and the audit built on both. The graph below is that relationship, written
 * once, rather than a rule remembered at each call site.
 */

export type CachedStage = 'input' | 'pages' | 'align' | 'prepare' | 'enhance' | 'ocr' | 'diff' | 'checkboxes' | 'find' | 'audit'

/** What each stage's result feeds. Transitive: dropping `pages` drops all of it. */
const DOWNSTREAM: Readonly<Record<CachedStage, readonly CachedStage[]>> = {
  input:      ['pages'],
  pages:      ['align'],
  align:      ['prepare', 'enhance', 'diff', 'checkboxes', 'audit'],
  // What the document chose to read under feeds every reader, and nothing else.
  prepare:    ['ocr', 'audit'],
  enhance:    ['ocr', 'audit'],
  ocr:        ['find', 'audit'],
  diff:       ['audit'],
  checkboxes: [],
  find:       [],
  audit:      [],
}

interface Entry {
  fingerprint: string
  run:         Promise<unknown>
  /** Set once the run settles, so a getter can answer without awaiting. */
  value?:      unknown
}

export class StageCache {
  readonly #entries = new Map<CachedStage, Entry>()

  /**
   * The cached run for this stage when it was made with these settings, or a
   * fresh one - dropping whatever depended on the old answer.
   */
  run<Result> (stage: CachedStage, fingerprint: string, start: () => Promise<Result>): Promise<Result> {
    const entry = this.#entries.get(stage)
    if (entry !== undefined && entry.fingerprint === fingerprint) return entry.run as Promise<Result>

    this.drop(stage)
    const fresh: Entry = { fingerprint, run: Promise.resolve() }
    fresh.run = (async (): Promise<Result> => {
      try {
        const value = await start()
        fresh.value = value

        return value
      } catch (error) {
        // A failure is not an answer: forget it so a retry is possible.
        if (this.#entries.get(stage) === fresh) this.#entries.delete(stage)
        throw error
      }
    })()
    this.#entries.set(stage, fresh)

    return fresh.run as Promise<Result>
  }

  /**
   * Files a result this session already has, so a later call need not recompute it.
   *
   * Unlike {@link run}, this does **not** drop what lies downstream. The result
   * being filed was produced by a stage that is still settling - an audit
   * handing back the reading and the pixels it just computed - and cascading a
   * drop from here would delete that audit's own entry on the way past. The
   * value is consistent with its dependants by construction; it is not news.
   */
  put<Result> (stage: CachedStage, fingerprint: string, value: Result): void {
    this.#entries.set(stage, { fingerprint, run: Promise.resolve(value), value })
  }

  /** The settled result, or `undefined` while a stage has not run or is still running. */
  settled<Result> (stage: CachedStage): Result | undefined {
    return this.#entries.get(stage)?.value as Result | undefined
  }

  /** Whether the stage has a run on file, settled or not. */
  has (stage: CachedStage): boolean {
    return this.#entries.has(stage)
  }

  /** Forgets this stage and everything that was computed from it. */
  drop (stage: CachedStage): void {
    this.#entries.delete(stage)
    const downstream = DOWNSTREAM[stage]
    for (const next of downstream) this.drop(next)
  }

  clear (): void {
    this.#entries.clear()
  }
}
