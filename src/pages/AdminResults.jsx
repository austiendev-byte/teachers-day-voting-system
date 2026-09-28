import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import './AdminResults.css'
import { ChartBar, Trophy, UsersThree, X } from '@phosphor-icons/react'

function AdminResults() {
  const toast = useToast()

  const [elections, setElections] = useState([])
  const [selectedElection, setSelectedElection] =
    useState('')

  const [results, setResults] = useState([])
  const [schools, setSchools] = useState([])
  const [selectedSchoolId, setSelectedSchoolId] = useState('')
  const [categories, setCategories] = useState([])
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [openSchool, setOpenSchool] = useState(null)

  const [loading, setLoading] = useState(true)
  const [loadingResults, setLoadingResults] =
    useState(false)
  const [accessError, setAccessError] = useState('')

  // ==========================================
  // CHECK ADMIN ACCESS
  // ==========================================

  useEffect(() => {
    checkAdmin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function checkAdmin() {
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError) {
      console.error(
        'Error getting user:',
        userError
      )

      setAccessError('Could not verify the logged-in account.')
      setLoading(false)
      return
    }

    if (!user) {
      setAccessError('You must be logged in.')

      setLoading(false)
      return
    }

    const {
      data: isAdmin,
      error: adminError
    } = await supabase.rpc('is_admin')

    if (adminError) {
      console.error(
        'Admin check error:',
        adminError
      )

      setAccessError('Could not verify administrator access.')

      setLoading(false)
      return
    }

    if (!isAdmin) {
      setAccessError('Access denied. Administrator privileges are required.')

      await supabase.auth.signOut({ scope: 'local' })

      setLoading(false)
      return
    }

    await fetchElections()
    await fetchSchools()

    setLoading(false)
  }

  // ==========================================
  // GET ELECTIONS
  // ==========================================

  async function fetchElections() {
    const {
      data,
      error
    } = await supabase
      .from('elections')
      .select(`
        id,
        title,
        status,
        start_date,
        end_date
      `)
      .order('start_date', {
        ascending: false
      })

    if (error) {
      console.error(
        'Error getting elections:',
        error
      )

      toast.error(
        `Could not load elections.\n\n${error.message}`
      )

      return
    }

    setElections(data || [])
  }

  // ==========================================
  // GET SCHOOLS
  // ==========================================

  async function fetchSchools() {
    const { data, error } = await supabase
      .from('schools')
      .select('id, school_code, school_name, logo_url')
      .order('school_code', { ascending: true })

    if (error) {
      console.error('Error getting schools:', error)
      toast.error(error.message)
      return []
    }

    const nextSchools = data || []
    setSchools(nextSchools)
    return nextSchools
  }

  // ==========================================
  // GET AWARD CATEGORIES FOR SCHOOL
  // ==========================================
  // ==========================================

  async function fetchCategories(electionId, schoolId) {
    if (!electionId || !schoolId) {
      setCategories([])
      setSelectedCategoryId('')
      return []
    }

    const { data, error } = await supabase
      .from('election_award_categories')
      .select('id, school_id, category_name, display_order, is_active')
      .eq('election_id', Number(electionId))
      .eq('school_id', Number(schoolId))
      .eq('is_active', true)
      .order('display_order', { ascending: true })

    if (error) {
      console.error('Error getting award categories:', error)
      toast.error(error.message)
      setCategories([])
      setSelectedCategoryId('')
      return []
    }

    const nextCategories = data || []
    setCategories(nextCategories)

    return nextCategories
  }

  // ==========================================
  // GET CATEGORY RESULTS
  // ==========================================

  async function fetchResults(electionId, categoryId) {
    if (!electionId || !categoryId) {
      setResults([])
      return
    }

    setLoadingResults(true)

    const { data, error } = await supabase.rpc(
      'get_election_category_results',
      {
        p_election_id: Number(electionId),
        p_category_id: Number(categoryId)
      }
    )

    if (error) {
      console.error('Error getting category results:', error)
      toast.error(error.message)
      setResults([])
      setLoadingResults(false)
      return
    }

    setResults(data || [])
    setLoadingResults(false)
  }

  // ==========================================
  // CHANGE ELECTION
  // ==========================================

  async function handleElectionChange(event) {
    const electionId = event.target.value

    setSelectedElection(electionId)
    setOpenSchool(null)
    setResults([])
    setSelectedCategoryId('')

    const schoolId = selectedSchoolId || String(schools[0]?.id || '')
    if (!selectedSchoolId && schoolId) {
      setSelectedSchoolId(schoolId)
    }

    const nextCategories = await fetchCategories(electionId, schoolId)
    const firstCategory = nextCategories[0] || null

    if (firstCategory) {
      const categoryId = String(firstCategory.id)
      setSelectedCategoryId(categoryId)
      await fetchResults(electionId, categoryId)
    }
  }

  async function handleSchoolChange(event) {
    const schoolId = event.target.value

    setSelectedSchoolId(schoolId)
    setOpenSchool(null)
    setResults([])
    setSelectedCategoryId('')

    const nextCategories = await fetchCategories(selectedElection, schoolId)
    const firstCategory = nextCategories[0] || null

    if (firstCategory) {
      const categoryId = String(firstCategory.id)
      setSelectedCategoryId(categoryId)
      await fetchResults(selectedElection, categoryId)
    }
  }

  async function handleCategoryChange(event) {
    const categoryId = event.target.value

    setSelectedCategoryId(categoryId)
    setOpenSchool(null)
    await fetchResults(selectedElection, categoryId)
  }

  // ==========================================
  // GROUP RESULTS BY SCHOOL
  // ==========================================

  function groupResultsBySchool() {
    const grouped = {}

    results.forEach((item) => {
      const schoolCode =
        item.school_code

      if (!grouped[schoolCode]) {
        grouped[schoolCode] = {
          schoolCode:
            item.school_code,

          schoolName:
            item.school_name,

          logoUrl: item.logo_url || null,
          faculty: []
        }
      }

      grouped[schoolCode]
        .faculty
        .push(item)
    })

    return Object.values(grouped)
  }

  // ==========================================
  // GET TOP FACULTY
  // ==========================================

  function getTopFaculty(
    facultyList
  ) {
    if (
      !facultyList ||
      facultyList.length === 0
    ) {
      return null
    }

    const highestVotes =
      Math.max(
        ...facultyList.map(
          (item) =>
            Number(
              item.vote_count
            )
        )
      )

    // If everyone has zero votes,
    // there is no representative yet.
    if (highestVotes === 0) {
      return null
    }

    const topFaculty =
      facultyList.filter(
        (item) =>
          Number(
            item.vote_count
          ) === highestVotes
      )

    // If there is a tie, don't
    // declare a representative.
    if (topFaculty.length > 1) {
      return {
        tie: true,
        faculty: topFaculty
      }
    }

    return {
      tie: false,
      faculty: topFaculty[0]
    }
  }

  function totalVotesFor(faculty) {
    return faculty.reduce((sum, item) => sum + Number(item.vote_count || 0), 0)
  }

  // ==========================================
  // LOADING
  // ==========================================

  if (loading) {
    return (
      <p className="muted row">
        <span className="spinner" /> Checking administrator access...
      </p>
    )
  }

  if (accessError) {
    return (
      <div className="alert alert-error">
        {accessError}
      </div>
    )
  }

  // ==========================================
  // RESULTS
  // ==========================================

  const groupedSchools =
    groupResultsBySchool()

  const openSchoolData = openSchool
    ? groupedSchools.find((item) => item.schoolCode === openSchool)
    : null

  const selectedCategory = categories.find(
    (category) => String(category.id) === String(selectedCategoryId)
  ) || null

  return (
    <div className="admin-results-module">
      <div className="election-selector-wrap results-election-select">
        <label htmlFor="results-election-select">Election</label>
        <select
          id="results-election-select"
          className="admin-select"
          value={selectedElection}
          onChange={
            handleElectionChange
          }
        >

          <option value="">
            Select an election
          </option>

          {elections.map(
            (election) => (
              <option
                key={election.id}
                value={election.id}
              >
                {election.title}
                {' ('}
                {election.status}
                {')'}
              </option>
            )
          )}

        </select>
      </div>

      {selectedElection && schools.length > 0 && (
        <div className="election-selector-wrap results-school-select">
          <label htmlFor="results-school-select">School</label>
          <select
            id="results-school-select"
            className="admin-select"
            value={selectedSchoolId}
            onChange={handleSchoolChange}
          >
            <option value="">Select a school</option>
            {schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.school_code} · {school.school_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedElection && selectedSchoolId && categories.length > 0 && (
        <div className="election-selector-wrap results-category-select">
          <label htmlFor="results-category-select">Award Category</label>
          <select
            id="results-category-select"
            className="admin-select"
            value={selectedCategoryId}
            onChange={handleCategoryChange}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.display_order}. {category.category_name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="results-content">

        {loadingResults ? (

          <div className="results-loading" role="status" aria-label="Loading results">
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
          </div>

        ) : !selectedElection ? (

          <div className="results-empty-state">
            <div className="results-empty-icon" aria-hidden="true"><ChartBar size={24} weight="duotone" /></div>
            <h3>Select an election, school, and award</h3>
            <p>Choose the school first, then select one of its award categories to see its voting results.</p>
          </div>

        ) : groupedSchools.length === 0 ? (

          <div className="results-empty-state">
            <div className="results-empty-icon" aria-hidden="true"><UsersThree size={24} weight="duotone" /></div>
            <h3>No faculty records found</h3>
            <p>This school has no recorded faculty results yet.</p>
          </div>

        ) : (

          <div className="results-school-grid">

            {groupedSchools.map(
              (school) => {

                const topFaculty =
                  getTopFaculty(
                    school.faculty
                  )

                const totalVotes = totalVotesFor(school.faculty)

                return (
                  <button
                    type="button"
                    key={school.schoolCode}
                    className="result-card"
                    onClick={() => setOpenSchool(school.schoolCode)}
                  >
                    <div className="result-card-logo">
                      {school.logoUrl ? (
                        <img src={school.logoUrl} alt={`${school.schoolCode} logo`} />
                      ) : (
                        <span>{school.schoolCode?.slice(0, 2) || 'SC'}</span>
                      )}
                    </div>

                    <div className="result-card-body">
                      <h3>{selectedCategory?.category_name || 'Award result'}</h3>
                      <p><span className="num">{school.schoolCode}</span> · {school.schoolName}</p>
                    </div>

                    <div className="result-card-footer">
                      {topFaculty === null ? (
                        <span className="result-card-tag result-card-tag-neutral">No votes yet</span>
                      ) : topFaculty.tie ? (
                        <span className="result-card-tag result-card-tag-warning">Tie between {topFaculty.faculty.length}</span>
                      ) : (
                        <span className="result-card-tag result-card-tag-success">Leading: {topFaculty.faculty.faculty_name}</span>
                      )}
                      <span className="result-card-votes"><span className="num">{totalVotes}</span> votes</span>
                    </div>
                  </button>
                )
              }
            )}

          </div>

        )}
      </div>

      {openSchoolData && (
        <div className="school-detail-backdrop" role="presentation" onMouseDown={() => setOpenSchool(null)}>
          <div
            className="school-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="results-detail-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-school-identity">
                {openSchoolData.logoUrl ? (
                  <img
                    src={openSchoolData.logoUrl}
                    alt={`${openSchoolData.schoolCode} logo`}
                    className="modal-school-logo"
                  />
                ) : (
                  <div className="modal-school-logo modal-school-logo-placeholder">
                    {openSchoolData.schoolCode?.slice(0, 2) || 'SC'}
                  </div>
                )}
                <div>
                  <div className="school-card-code">{openSchoolData.schoolCode}</div>
                  <h2 id="results-detail-title">{selectedCategory?.category_name || 'Award result'}</h2>
                  <span className="results-modal-subtitle">{openSchoolData.schoolName}</span>
                </div>
              </div>

              <button type="button" className="modal-close" onClick={() => setOpenSchool(null)} aria-label="Close election result">
                <X size={18} weight="bold" />
              </button>
            </div>

            <div className="modal-body">
              <section className="detail-summary-grid">
                <div className="detail-summary-card">
                  <span>Candidates</span>
                  <strong className="num">{openSchoolData.faculty.length}</strong>
                </div>
                <div className="detail-summary-card">
                  <span>Total votes</span>
                  <strong className="num">{totalVotesFor(openSchoolData.faculty)}</strong>
                </div>
              </section>

              <div className="detail-panel">
                <div className="detail-panel-heading">
                  <div>
                    <span>{selectedCategory?.category_name || 'Award category'}</span>
                    <h3>Votes by faculty</h3>
                  </div>
                </div>

                <div className="table-wrap">
                  <table className="table">

                    <thead>
                      <tr>
                        <th>Faculty</th>
                        <th>Program</th>
                        <th className="results-votes-col">Votes</th>
                      </tr>
                    </thead>

                    <tbody>

                      {openSchoolData.faculty.map(
                        (item) => (
                          <tr
                            key={
                              item.faculty_id
                            }
                          >
                            <td>{item.faculty_name}</td>
                            <td>{item.program_name}</td>
                            <td className="results-votes-col">
                              <strong>{item.vote_count}</strong>
                            </td>
                          </tr>
                        )
                      )}

                    </tbody>

                  </table>
                </div>
              </div>

              <div className="detail-panel">
                <div className="detail-panel-heading">
                  <div>
                    <span>Category result</span>
                    <h3>Leading faculty</h3>
                  </div>
                </div>

                {(() => {
                  const topFaculty = getTopFaculty(openSchoolData.faculty)

                  if (topFaculty === null) {
                    return (
                      <p className="muted">
                        No votes have been recorded for this award category yet.
                      </p>
                    )
                  }

                  if (topFaculty.tie) {
                    return (
                      <div>
                        <p className="results-tie-note"><span className="tie-badge">Tie</span> The top vote count is shared by:</p>
                        <ul>
                          {topFaculty.faculty.map(
                            (item) => (
                              <li
                                key={
                                  item.faculty_id
                                }
                              >
                                <strong>{item.faculty_name}</strong>
                                {', '}
                                <span className="num">{item.vote_count}</span> votes
                              </li>
                            )
                          )}
                        </ul>
                        <p className="muted">
                          No single leader is shown because the top vote count is tied.
                        </p>
                      </div>
                    )
                  }

                  return (
                    <div>
                      <p className="results-leader">
                        <Trophy size={20} weight="fill" aria-hidden="true" />
                        <strong>
                          {
                            topFaculty
                              .faculty
                              .faculty_name
                          }
                        </strong>
                      </p>
                      <p className="muted">
                        Votes: {topFaculty.faculty.vote_count}
                      </p>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminResults
