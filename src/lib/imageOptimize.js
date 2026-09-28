// Resizes and compresses an image File in the browser before it's uploaded
// to Supabase Storage. Faculty photos are loaded by every student viewing
// their school's candidate list (~13,000 students, up to ~900 faculty
// total), so keeping these small matters a lot more for total data
// transferred than it does for any single upload. Admin-uploaded photos
// (straight from a phone camera) are frequently several MB and far larger
// than the small avatar-style photo the UI actually displays; this brings
// them down to a size appropriate for that display without a visible
// quality loss.
//
// Output is always a JPEG capped at maxDimension on the longest side.
// Falls back to returning the original file untouched if anything in the
// canvas pipeline fails (e.g. an unusual format the browser can't decode)
// so an upload never hard-fails because of this optimization step.

export async function optimizeImageFile(
  file,
  { maxDimension = 480, quality = 0.82 } = {}
) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    return file
  }

  try {
    const bitmap = await loadBitmap(file)

    const scale = Math.min(
      1,
      maxDimension / Math.max(bitmap.width, bitmap.height)
    )

    const targetWidth = Math.max(1, Math.round(bitmap.width * scale))
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight

    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)

    if (typeof bitmap.close === 'function') {
      bitmap.close()
    }

    const blob = await new Promise((resolve) =>
      canvas.toBlob((result) => resolve(result), 'image/jpeg', quality)
    )

    if (!blob) {
      return file
    }

    // Only use the optimized version if it's actually smaller -- a tiny
    // source image (already well under maxDimension) can occasionally
    // come out larger once re-encoded as JPEG.
    if (blob.size >= file.size) {
      return file
    }

    const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg'

    return new File([blob], newName, {
      type: 'image/jpeg',
      lastModified: Date.now()
    })
  } catch (error) {
    console.error('Image optimization skipped:', error)
    return file
  }
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file)
  }

  // Safari-friendly fallback
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }

    img.onerror = (error) => {
      URL.revokeObjectURL(url)
      reject(error)
    }

    img.src = url
  })
}
