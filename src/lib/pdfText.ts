/**
 * Les polices standard du PDF ne couvrent que le latin-1 : on remplace la
 * typographie qui en sort (apostrophes, guillemets, points de suspension,
 * espaces insécables des nombres à la française, tirets).
 */
export const pdfText = (s: string) =>
  s
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/ᵉ/g, 'e')
    .replace(/[  ]/g, ' ')
    .replace(/[–—]/g, '-');
