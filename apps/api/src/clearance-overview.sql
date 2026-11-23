-- =============================================================
-- Student Clearance Overview (base view)
--
-- Returns one row per student with their clearance statuses,
-- courses, and programs joined. Compliance and N/A display
-- labels are computed in the TypeScript layer (clearance-rules.ts)
-- because the rules are too complex for pure SQL and need to
-- stay in one place.
-- =============================================================

CREATE VIEW IF NOT EXISTS student_clearance_overview AS
SELECT
  s.id AS student_id,
  s.last_name,
  s.first_name,
  s.email,
  s.school,
  s.position_type,
  s.works_in_partner_afterschool,
  s.is_international,
  s.in_sdp,
  s.notes,

  -- Comma-joined courses
  (
    SELECT group_concat(c.code, ', ')
    FROM student_courses sc
    JOIN courses c ON c.id = sc.course_id
    WHERE sc.student_id = s.id
  ) AS courses,

  -- Comma-joined programs
  (
    SELECT group_concat(p.name, ', ')
    FROM student_programs sp
    JOIN programs p ON p.id = sp.program_id
    WHERE sp.student_id = s.id
  ) AS programs,

  -- Individual clearance statuses (by sort_order)
  MAX(CASE WHEN ct.code = 'PA_CHILD_ABUSE' THEN sc2.status END) AS pa_child_abuse_status,
  MAX(CASE WHEN ct.code = 'PATCH' THEN sc2.status END) AS patch_status,
  MAX(CASE WHEN ct.code = 'FBI_OR_AFFIDAVIT' THEN sc2.status END) AS fbi_or_affidavit_status,
  MAX(CASE WHEN ct.code = 'MANDATED_REPORTER' THEN sc2.status END) AS mandated_reporter_status,
  MAX(CASE WHEN ct.code = 'SDP_CODE_OF_CONDUCT' THEN sc2.status END) AS sdp_code_of_conduct_status,
  MAX(CASE WHEN ct.code = 'INTL_AFFIDAVIT' THEN sc2.status END) AS intl_affidavit_status

FROM students s
LEFT JOIN student_clearances sc2 ON sc2.student_id = s.id
LEFT JOIN clearance_types ct ON ct.id = sc2.clearance_type_id
GROUP BY s.id;
