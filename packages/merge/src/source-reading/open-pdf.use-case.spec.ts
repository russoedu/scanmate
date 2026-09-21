import { PDFDocument } from '@cantoo/pdf-lib'

import { openPdf, PdfPasswordError } from './open-pdf.use-case'

/** A one-page PDF, encrypted the way given - or not at all. */
async function pdf (security?: { ownerPassword: string, userPassword: string }): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  document.addPage([400, 200])
  if (security) document.encrypt(security)

  return await document.save()
}

/** How many pages the opened document has - enough to show it really opened. */
async function pagesOf (bytes: Uint8Array, options?: { password?: string }): Promise<number> {
  const document = await openPdf(bytes, options)

  return document.getPageCount()
}

describe('openPdf', () => {
  it('opens an unencrypted PDF as it always did', async () => {
    expect(await pagesOf(await pdf())).toBe(1)
  })

  it('opens a signed-style PDF - an owner password and nothing else - without being given one', async () => {
    // pdf-lib refuses this outright by default, which is the error a caller first meets.
    const locked = await pdf({ ownerPassword: 'owner', userPassword: '' })

    await expect(PDFDocument.load(locked)).rejects.toThrow(/encrypted/i)
    expect(await pagesOf(locked)).toBe(1)
  })

  it('opens a PDF that needs a password to be read, given it', async () => {
    const locked = await pdf({ ownerPassword: 'owner', userPassword: 'secret' })

    expect(await pagesOf(locked, { password: 'secret' })).toBe(1)
  })

  it('says whether the password was missing or wrong', async () => {
    const locked = await pdf({ ownerPassword: 'owner', userPassword: 'secret' })

    await expect(openPdf(locked)).rejects.toMatchObject({ name: 'PdfPasswordError', given: false })
    await expect(openPdf(locked, { password: 'guess' })).rejects.toMatchObject({ name: 'PdfPasswordError', given: true })
    await expect(openPdf(locked, { password: 'guess' })).rejects.toBeInstanceOf(PdfPasswordError)
  })
})
