import * as XLSX from 'xlsx'

const HEADER_PATTERN = /^(student\s*[-_ ]?\s*(id|no\.?|number)|id\s*(no\.?|number)?|school\s*id)$/i

// Reads Student IDs from the first sheet of an Excel/CSV workbook.
// Registration compares IDs as exact text (after trimming), so cells are
// read as the text Excel displays, never as numbers.
export function parseEligibleIds(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  // Blank rows are kept so the row numbers in messages match Excel.
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: true })
    .map((row) => row.map((cell) => String(cell ?? '').trim()))
  const firstRow = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']).s.r + 1 : 1

  if (!rows.some((row) => row.some((cell) => cell !== ''))) {
    return { error: 'The file is empty.' }
  }

  let headerRowIndex = -1
  let columnIndex = -1

  for (let r = 0; r < Math.min(rows.length, 5); r += 1) {
    const found = rows[r].findIndex((cell) => HEADER_PATTERN.test(cell))
    if (found !== -1) {
      headerRowIndex = r
      columnIndex = found
      break
    }
  }

  if (columnIndex === -1) {
    const widths = rows.map((row) => row.filter((cell) => cell !== '').length)
    if (Math.max(...widths) === 1) {
      // A single unlabeled column of IDs.
      const firstFilled = rows.find((row) => row.some((cell) => cell !== ''))
      columnIndex = firstFilled.findIndex((cell) => cell !== '')
    } else {
      return {
        error: 'Could not find a "Student ID" column. Put the IDs in a column with the header "Student ID", or use the template.'
      }
    }
  }

  const ids = []
  const issues = []
  const seen = new Set()
  let duplicates = 0

  rows.slice(headerRowIndex + 1).forEach((row, index) => {
    const excelRow = firstRow + headerRowIndex + 1 + index
    const value = row[columnIndex] || ''

    if (value === '') return

    if (/^\d(\.\d+)?e[+-]?\d+$/i.test(value)) {
      issues.push(`Row ${excelRow}: "${value}" looks like a number Excel shortened. Format the column as Text and re-enter it.`)
      return
    }

    if (/\s/.test(value)) {
      issues.push(`Row ${excelRow}: "${value}" contains spaces.`)
      return
    }

    if (value.length > 64) {
      issues.push(`Row ${excelRow}: "${value.slice(0, 20)}…" is too long to be a Student ID.`)
      return
    }

    if (seen.has(value)) {
      duplicates += 1
      return
    }

    seen.add(value)
    ids.push(value)
  })

  if (ids.length === 0 && issues.length === 0) {
    return { error: 'No Student IDs were found under the header.' }
  }

  return { ids, issues, duplicates }
}

export function downloadEligibleIdTemplate() {
  const sheet = XLSX.utils.aoa_to_sheet([['Student ID'], ['2026-0001'], ['2026-0002']])
  // Store the column as text so Excel keeps leading zeros and dashes.
  for (const ref of ['A2', 'A3']) {
    sheet[ref].t = 's'
    sheet[ref].z = '@'
  }
  sheet['!cols'] = [{ wch: 18 }]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Eligible IDs')
  XLSX.writeFile(workbook, 'eligible-student-ids-template.xlsx')
}
