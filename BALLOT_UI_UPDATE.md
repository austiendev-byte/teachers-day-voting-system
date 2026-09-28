# Formal Ballot UI Update

The student voting interface now uses a lightweight formal ballot presentation.

- Faculty photographs are no longer loaded or rendered on the student voting page.
- Faculty selection is presented as accessible radio-style ballot rows.
- Each candidate row shows the ballot number, faculty name, faculty code, and program.
- Award categories remain school-specific and one-vote-per-category.
- The faculty query no longer selects `photo_url` or the redundant `school_id` field.
- Admin faculty photo management is unchanged.

This change is intended to reduce student-side network transfer, image decoding, and browser rendering work while preserving the existing voting and database security flow.
