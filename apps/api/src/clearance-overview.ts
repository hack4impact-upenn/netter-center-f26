/**
 * Student Clearance Overview
 *
 * Queries the student_clearance_overview SQL view and applies
 * the requirement rules from clearance-rules.ts to compute
 * compliance and display labels.
 */

import { query } from "./integrations/database";
import {
  ClearanceCode,
  displayStatus,
  isCompliant,
  type ClearanceCodeType,
  type StudentForRules,
} from "./clearance-rules";

/** Raw row shape from the SQL view */
type OverviewRow = {
  student_id: string;
  last_name: string;
  first_name: string;
  email: string;
  school: "SON" | "PSOM" | "other";
  position_type: "volunteer" | "paid";
  works_in_partner_afterschool: number;
  is_international: number;
  in_sdp: number;
  notes: string | null;
  courses: string | null;
  programs: string | null;
  pa_child_abuse_status: string | null;
  patch_status: string | null;
  fbi_or_affidavit_status: string | null;
  mandated_reporter_status: string | null;
  sdp_code_of_conduct_status: string | null;
  intl_affidavit_status: string | null;
};

/** Final shape returned to callers / the API */
export type ClearanceOverviewEntry = {
  last_name: string;
  first_name: string;
  email: string;
  compliant: boolean;
  courses: string;
  programs: string;
  pa_child_abuse: string;
  patch: string;
  fbi_or_affidavit: string;
  mandated_reporter: string;
  sdp_code_of_conduct: string;
  intl_affidavit: string;
  notes: string;
  in_sdp: boolean;
};

const STATUS_FIELDS = {
  [ClearanceCode.PA_CHILD_ABUSE]: "pa_child_abuse_status",
  [ClearanceCode.PATCH]: "patch_status",
  [ClearanceCode.FBI_OR_AFFIDAVIT]: "fbi_or_affidavit_status",
  [ClearanceCode.MANDATED_REPORTER]: "mandated_reporter_status",
  [ClearanceCode.SDP_CODE_OF_CONDUCT]: "sdp_code_of_conduct_status",
  [ClearanceCode.INTL_AFFIDAVIT]: "intl_affidavit_status",
} as const satisfies Record<ClearanceCodeType, keyof OverviewRow>;

function toStudent(row: OverviewRow): StudentForRules {
  return {
    school: row.school,
    position_type: row.position_type,
    works_in_partner_afterschool: row.works_in_partner_afterschool,
    is_international: row.is_international,
    in_sdp: row.in_sdp,
  };
}

function transform(row: OverviewRow): ClearanceOverviewEntry {
  const student = toStudent(row);
  const statusFor = (code: ClearanceCodeType) => row[STATUS_FIELDS[code]] ?? "not_issued";
  const display = (code: ClearanceCodeType) =>
    displayStatus(student, code, statusFor(code));
  const clearances = Object.values(ClearanceCode).map((code) => ({
    code,
    status: statusFor(code),
  }));

  return {
    last_name: row.last_name,
    first_name: row.first_name,
    email: row.email,
    compliant: isCompliant(student, clearances),
    courses: row.courses ?? "",
    programs: row.programs ?? "",
    pa_child_abuse: display(ClearanceCode.PA_CHILD_ABUSE),
    patch: display(ClearanceCode.PATCH),
    fbi_or_affidavit: display(ClearanceCode.FBI_OR_AFFIDAVIT),
    mandated_reporter: display(ClearanceCode.MANDATED_REPORTER),
    sdp_code_of_conduct: display(ClearanceCode.SDP_CODE_OF_CONDUCT),
    intl_affidavit: display(ClearanceCode.INTL_AFFIDAVIT),
    notes: row.notes ?? "",
    in_sdp: row.in_sdp === 1,
  };
}

/**
 * Fetch the full clearance overview, with computed compliance and display labels.
 */
export async function getClearanceOverview(): Promise<ClearanceOverviewEntry[]> {
  const rows = await query<OverviewRow>(
    "SELECT * FROM student_clearance_overview ORDER BY last_name, first_name"
  );
  return rows.map(transform);
}
