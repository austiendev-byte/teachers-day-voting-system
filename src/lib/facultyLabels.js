// "BSBA (FM, MM) · BSIT" from one school's faculty_assignments rows
// (each with major_id, majors.major_code and programs.program_code).
// A row without a major covers the whole program. Mirrors the SQL
// function public.faculty_teaches_label.
export function formatTeaches(assignments) {
  const byProgram = new Map()

  for (const assignment of assignments || []) {
    const programCode = assignment.programs?.program_code
    if (!programCode) continue

    if (!byProgram.has(programCode)) {
      byProgram.set(programCode, { all: false, majors: new Set() })
    }

    const entry = byProgram.get(programCode)
    const majorCode = assignment.majors?.major_code

    if (!assignment.major_id || !majorCode) {
      entry.all = true
    } else {
      entry.majors.add(majorCode.replace(new RegExp(`^${programCode}-`), ''))
    }
  }

  return [...byProgram.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, entry]) =>
      entry.all || entry.majors.size === 0
        ? code
        : `${code} (${[...entry.majors].sort().join(', ')})`
    )
    .join(' · ')
}
