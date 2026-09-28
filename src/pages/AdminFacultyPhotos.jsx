import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { optimizeImageFile } from '../lib/imageOptimize'

function AdminFacultyPhotos() {
  const toast = useToast()
  const confirm = useConfirm()

  const [faculty, setFaculty] = useState([])
  const [selectedFiles, setSelectedFiles] = useState([])

  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)

  const [messages, setMessages] = useState([])
  const [uploadProgress, setUploadProgress] = useState(0)
  const [accessError, setAccessError] = useState('')

  // ==========================================
  // INITIAL LOAD
  // ==========================================

  useEffect(() => {
    checkAdmin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ==========================================
  // CHECK ADMIN
  // ==========================================

  async function checkAdmin() {
    setLoading(true)
    setAccessError('')

    try {
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

        return
      }

      if (!user) {
        setAccessError('You must be logged in.')

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

        setAccessError(`Could not verify administrator access.\n\n${adminError.message}`)

        return
      }

      if (!isAdmin) {
        setAccessError('Administrator privileges are required.')

        return
      }

      await fetchFaculty()
    } catch (error) {
      console.error(
        'Unexpected admin verification error:',
        error
      )

      setAccessError(`An unexpected error occurred.\n\n${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  // ==========================================
  // LOAD FACULTY
  // ==========================================

  async function fetchFaculty() {
    const {
      data,
      error
    } = await supabase
      .from('faculty')
      .select(`
        id,
        faculty_code,
        name,
        photo_url
      `)
      .order('faculty_code', {
        ascending: true
      })

    if (error) {
      console.error(
        'Error loading faculty:',
        error
      )

      toast.error(
        `Could not load faculty records.\n\n${error.message}`
      )

      return
    }

    setFaculty(data || [])
  }

  // ==========================================
  // GET FACULTY CODE FROM FILE NAME
  // ==========================================

  function getFacultyCode(fileName) {
    const lastDot =
      fileName.lastIndexOf('.')

    let code = fileName

    if (lastDot !== -1) {
      code = fileName.substring(
        0,
        lastDot
      )
    }

    return code
      .trim()
      .toUpperCase()
  }

  // ==========================================
  // GET FILE EXTENSION
  // ==========================================

  function getFileExtension(fileName) {
    const lastDot =
      fileName.lastIndexOf('.')

    if (lastDot === -1) {
      return 'jpg'
    }

    return fileName
      .substring(lastDot + 1)
      .toLowerCase()
  }

  // ==========================================
  // SELECT PHOTOS
  // ==========================================

  function handleFileChange(event) {
    const files = Array.from(
      event.target.files || []
    )

    setMessages([])
    setSelectedFiles([])
    setUploadProgress(0)

    if (files.length === 0) {
      return
    }

    const validFiles = []
    const validationMessages = []
    const usedFacultyCodes = new Set()

    for (const file of files) {
      const facultyCode =
        getFacultyCode(file.name)

      // --------------------------------------
      // IMAGE CHECK
      // --------------------------------------

      if (!file.type.startsWith('image/')) {
        validationMessages.push({
          type: 'error',
          text: `${file.name} — not an image file.`
        })

        continue
      }

      // --------------------------------------
      // FILE SIZE CHECK
      // --------------------------------------

      const maxSize =
        5 * 1024 * 1024

      if (file.size > maxSize) {
        validationMessages.push({
          type: 'error',
          text: `${file.name} — exceeds the 5 MB limit.`
        })

        continue
      }

      // --------------------------------------
      // DUPLICATE CHECK
      // --------------------------------------

      if (
        usedFacultyCodes.has(
          facultyCode
        )
      ) {
        validationMessages.push({
          type: 'error',
          text: `${file.name} — duplicate faculty code.`
        })

        continue
      }

      usedFacultyCodes.add(
        facultyCode
      )

      // --------------------------------------
      // FIND FACULTY
      // --------------------------------------

      const matchedFaculty =
        faculty.find(
          (member) =>
            member.faculty_code
              .trim()
              .toUpperCase() ===
            facultyCode
        )

      if (!matchedFaculty) {
        validationMessages.push({
          type: 'error',
          text: `${file.name} — faculty code "${facultyCode}" was not found.`
        })

        continue
      }

      // --------------------------------------
      // VALID FILE
      // --------------------------------------

      validFiles.push({
        file: file,
        faculty: matchedFaculty,
        facultyCode: facultyCode
      })

      validationMessages.push({
        type: 'success',
        text: `${file.name} → ${matchedFaculty.name}`
      })
    }

    setSelectedFiles(
      validFiles
    )

    setMessages(
      validationMessages
    )
  }

  // ==========================================
  // UPLOAD ALL PHOTOS
  // ==========================================

  async function handleUpload() {
    if (
      selectedFiles.length === 0
    ) {
      toast.error(
        'Please select valid faculty photos first.'
      )

      return
    }

    const confirmed = await confirm({
      title: 'Upload photos',
      message: `Upload ${selectedFiles.length} faculty photo(s)?`,
      confirmLabel: 'Upload'
    })

    if (!confirmed) {
      return
    }

    setUploading(true)
    setMessages([])
    setUploadProgress(0)

    const results = []

    let completed = 0

    for (
      const item of selectedFiles
    ) {
      const {
        file,
        faculty: facultyMember,
        facultyCode
      } = item

      try {
        // ------------------------------------
        // RESIZE / COMPRESS BEFORE UPLOAD
        // ------------------------------------
        // Faculty photos are viewed by every student browsing their
        // school's candidates -- optimize once here rather than shipping
        // full camera-resolution photos to ~13,000 students on mobile.

        const optimizedFile = await optimizeImageFile(file)

        // ------------------------------------
        // FILE EXTENSION
        // ------------------------------------

        const extension =
          getFileExtension(
            optimizedFile.name
          )

        // ------------------------------------
        // STORAGE FILE NAME
        // ------------------------------------

        const storagePath =
          `${facultyCode}.${extension}`

        // ------------------------------------
        // UPLOAD TO STORAGE
        // ------------------------------------

        const {
          error: uploadError
        } = await supabase
          .storage
          .from('faculty-photos')
          .upload(
            storagePath,
            optimizedFile,
            {
              cacheControl:
                '3600',

              upsert: true,

              contentType:
                optimizedFile.type
            }
          )

        if (uploadError) {
          throw uploadError
        }

        // ------------------------------------
        // GET PUBLIC URL
        // ------------------------------------

        const {
          data: publicUrlData
        } = supabase
          .storage
          .from('faculty-photos')
          .getPublicUrl(
            storagePath
          )

        const photoUrl =
          publicUrlData.publicUrl

        // ------------------------------------
        // SAVE URL TO FACULTY
        // ------------------------------------

        const {
          error: updateError
        } = await supabase
          .from('faculty')
          .update({
            photo_url:
              photoUrl
          })
          .eq(
            'id',
            facultyMember.id
          )

        if (updateError) {
          throw updateError
        }

        results.push({
          type: 'success',
          text: `✓ ${facultyCode} → ${facultyMember.name}`
        })
      } catch (error) {
        console.error(
          `Photo upload error for ${facultyCode}:`,
          error
        )

        results.push({
          type: 'error',
          text: `✗ ${facultyCode} → ${facultyMember.name}: ${error.message}`
        })
      }

      completed += 1

      setUploadProgress(
        Math.round(
          (completed /
            selectedFiles.length) *
            100
        )
      )
    }

    setMessages(results)

    await fetchFaculty()

    setSelectedFiles([])

    setUploading(false)

    setUploadProgress(100)

    const failedCount = results.filter((item) => item.type === 'error').length

    if (failedCount === 0) {
      toast.success('Faculty photo upload completed successfully.')
    } else {
      toast.error(`Faculty photo upload completed with ${failedCount} error(s). See details below.`)
    }
  }

  // ==========================================
  // CLEAR FILES
  // ==========================================

  function handleClear() {
    setSelectedFiles([])
    setMessages([])
    setUploadProgress(0)

    const input =
      document.getElementById(
        'faculty-photo-input'
      )

    if (input) {
      input.value = ''
    }
  }

  // ==========================================
  // LOADING
  // ==========================================

  if (loading) {
    return (
      <p className="muted row">
        <span className="spinner" /> Loading faculty photo manager...
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
  // PAGE
  // ==========================================

  return (
    <div>

      <h3>Faculty Photo Upload</h3>

      <p className="muted" style={{ marginBottom: 10 }}>
        Upload multiple faculty photos at once. The filename must match the Faculty Code.
      </p>

      <div className="card card-tight" style={{ marginBottom: 20 }}>
        <p className="help-text" style={{ marginBottom: 6 }}>Examples:</p>
        <div className="row">
          <code>FAC-101.jpg</code>
          <code>FAC-102.png</code>
          <code>FAC-103.webp</code>
        </div>
      </div>

      {/* ======================================
          FILE INPUT
      ====================================== */}

      <input
        id="faculty-photo-input"
        type="file"
        accept="image/*"
        multiple
        onChange={
          handleFileChange
        }
        disabled={uploading}
      />

      {/* ======================================
          COUNT
      ====================================== */}

      <p style={{ marginTop: 14 }}>
        <strong>Photos selected:</strong>{' '}
        {selectedFiles.length}
      </p>

      {/* ======================================
          SELECTED FILES
      ====================================== */}

      {selectedFiles.length > 0 && (
        <div className="stack" style={{ marginBottom: 16 }}>

          <h4>Ready to Upload</h4>

          {selectedFiles.map(
            (item) => (
              <div
                key={
                  item.facultyCode
                }
                className="card card-tight"
              >
                <strong>{item.file.name}</strong>
                {' → '}
                {item.faculty.name}
                <br />
                <small className="muted">
                  Faculty Code: {item.facultyCode}
                </small>
              </div>
            )
          )}

        </div>
      )}

      {/* ======================================
          PROGRESS
      ====================================== */}

      {uploading && (
        <div style={{ marginBottom: 16 }}>
          <h4>Upload Progress</h4>
          <progress className="bar" value={uploadProgress} max="100" />
          <p className="muted" style={{ marginTop: 6 }}>{uploadProgress}%</p>
        </div>
      )}

      {/* ======================================
          BUTTONS
      ====================================== */}

      <div className="row">
        <button
          className="btn btn-primary"
          onClick={
            handleUpload
          }
          disabled={
            uploading ||
            selectedFiles.length === 0
          }
        >
          {uploading && <span className="spinner" />}
          {uploading
            ? 'Uploading...'
            : 'Upload All Photos'}
        </button>

        <button
          className="btn btn-secondary"
          onClick={
            handleClear
          }
          disabled={
            uploading
          }
        >
          Clear
        </button>
      </div>

      {/* ======================================
          VALIDATION RESULTS
      ====================================== */}

      {messages.length > 0 && (
        <div style={{ marginTop: 20 }}>

          <h4>Upload Results</h4>

          <div className="stack">
            {messages.map(
              (message, index) => (
                <p
                  key={index}
                  className={message.type === 'error' ? 'alert alert-error' : 'alert alert-success'}
                  style={{ margin: 0 }}
                >
                  {message.text}
                </p>
              )
            )}
          </div>

        </div>
      )}

      {/* ======================================
          FACULTY PHOTO STATUS
      ====================================== */}

      <hr />

      <h4>Faculty Photo Status</h4>

      {faculty.length === 0 ? (
        <p className="muted">No faculty records found.</p>
      ) : (
        <div className="stack">

          {faculty.map(
            (member) => (
              <div
                key={
                  member.id
                }
                className="card card-tight row"
                style={{ justifyContent: 'space-between' }}
              >

                <span>
                  <strong>{member.faculty_code}</strong>
                  {' — '}
                  {member.name}
                </span>

                {member.photo_url ? (
                  <span className="badge badge-open">🟢 Photo uploaded</span>
                ) : (
                  <span className="badge badge-closed">🔴 No photo</span>
                )}

              </div>
            )
          )}

        </div>
      )}

    </div>
  )
}

export default AdminFacultyPhotos
