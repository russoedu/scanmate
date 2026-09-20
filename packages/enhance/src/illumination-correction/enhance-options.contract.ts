/** How hard to put back the edges a scanner softened. */
export interface SharpenOptions {
  /** Radius, in pixels of the enhanced page - so fitted after any enlargement. */
  sigma:   number
  /** How much of what the blur removed is added back. Default `1.5`. */
  amount?: number
}

/** How a page is cleaned. Every option has a default; see `DEFAULT_ENHANCE_OPTIONS`. */
export interface EnhanceOptions {
  /**
   * Sharpen the levelled page. Default `false`: it helps a soft scan a great
   * deal and costs a good one a little, so it is chosen per document rather
   * than applied to every one. `@scanmate/scan` picks it by measurement.
   */
  sharpen?:            SharpenOptions | false
  /**
   * Background window as a share of the page's shorter side. Wide enough that
   * no stroke fills it - or a bold heading becomes its own background and fades -
   * narrow enough to follow a shadow across the page.
   */
  backgroundFraction?: number
  /**
   * Share of the local background above which a pixel becomes pure white. Below
   * 1 it wipes paper texture, scanner noise and residual shading. `'auto'` (the
   * default) reads it from the page's own histogram, and on real scans settles
   * at 1.1, which leaves paper light grey rather than white - see
   * `estimateContrastPoints`. A page-scale statistic: for a small swatch, pass a
   * number.
   */
  whitePoint?:         number | 'auto'
  /**
   * Share of the local background below which a pixel becomes pure black.
   * `'auto'` (the default) mirrors `whitePoint`, from the darkest 1% of the page.
   */
  blackPoint?:         number | 'auto'
  /**
   * `'color'` normalises R, G and B each against its own background, which
   * removes a colour cast and keeps a blue signature blue. `'grayscale'` converts
   * first and returns a clean monochrome page.
   */
  mode?:               'color' | 'grayscale'
  /**
   * Median-filter the page before normalising. Speckle left in place fuses into
   * thin strokes once contrast is stretched; a median can equally erase a stroke
   * only a pixel or two wide. `'auto'` (the default) measures the page's noise first and
   * despeckles only a page that is genuinely noisy.
   */
  despeckle?:          boolean | 'auto'
  /** Noise level, on the `[0, 1]` grey scale, above which `'auto'` despeckles. */
  despeckleThreshold?: number
  /** Median window half-size in pixels: `1` is a 3x3 window. */
  despeckleRadius?:    number
}

/** What was actually done to a page - the values `'auto'` settled on, among them. */
export interface AppliedEnhancement {
  whitePoint: number
  blackPoint: number
  mode:       'color' | 'grayscale'
  despeckled: boolean
  /** The page's measured noise level; `null` when it was not measured because nothing depended on it. */
  noiseSigma: number | null
  /** The sharpening applied afterwards, or `false` when none was. */
  sharpened:  SharpenOptions | false
}
