export interface EvidencePdfOptions {
  /** On the cover and in the PDF's metadata: the document or case the audit was of. Default `'Audit evidence'`. */
  title?:     string
  /** Which pages get a page of their own: every audited page, or only those needing review. Default `'all'`. */
  pages?:     'all' | 'review'
  /** How each evidence image is embedded. Default `'jpeg'`: half the size of `'png'` on a W-9, and the sheet is read, not measured. */
  format?:    'jpeg' | 'png'
  /**
   * Resolution of each evidence image at the size it is shown on its sheet.
   * Default `200`: sharp when zoomed in, a few hundred kilobytes a page. The
   * image is never enlarged.
   */
  dpi?:       number
  /** JPEG quality. Default `85`. */
  quality?:   number
  /** When the audit was made, printed on the cover and set as the PDF's creation date. Default now. */
  createdAt?: Date
}
