/**
 * Clearance Requirement Rules
 *
 * ALL logic for which clearances a student needs lives here.
 * When rules change, only this file needs updating — no schema changes.
 */

// Mirrors the clearance_types seed codes
export const ClearanceCode = {
  PA_CHILD_ABUSE: "PA_CHILD_ABUSE",
  PATCH: "PATCH",
  FBI_OR_AFFIDAVIT: "FBI_OR_AFFIDAVIT",
  MANDATED_REPORTER: "MANDATED_REPORTER",
  SDP_CODE_OF_CONDUCT: "SDP_CODE_OF_CONDUCT",
  INTL_AFFIDAVIT: "INTL_AFFIDAVIT",
} as const;

export type ClearanceCodeType = (typeof ClearanceCode)[keyof typeof ClearanceCode];

/** The subset of student fields that rules need */
export type StudentForRules = {
  school: "SON" | "PSOM" | "other";
  position_type: "volunteer" | "paid";
  works_in_partner_afterschool: boolean | number; // DB returns 0/1
  is_international: boolean | number;
  in_sdp: boolean | number;
};

export type RequirementResult = {
  required: boolean;
  label: string | null; // display label when NOT required (null when required)
};

/** Normalize SQLite integer booleans to JS booleans */
function bool(v: boolean | number): boolean {
  return v === true || v === 1;
}

type Rule = (student: StudentForRules) => RequirementResult;

const REQUIRED: RequirementResult = { required: true, label: null };

/**
 * One rule function per clearance code.
 * Each returns { required, label }.
 */
const rules: Record<ClearanceCodeType, Rule> = {
  PA_CHILD_ABUSE: (s) => {
    // TODO(provisional): International students — not required (based on current spreadsheet data)
    if (bool(s.is_international)) {
      return { required: false, label: "N/A (international)" };
    }
    // SON/PSOM volunteers complete through their academic program
    if ((s.school === "SON" || s.school === "PSOM") && s.position_type === "volunteer") {
      return { required: false, label: "N/A (SON/PSOM student)" };
    }
    return REQUIRED;
  },

  PATCH: (s) => {
    // TODO(provisional): International students — not required
    if (bool(s.is_international)) {
      return { required: false, label: "N/A (international)" };
    }
    if ((s.school === "SON" || s.school === "PSOM") && s.position_type === "volunteer") {
      return { required: false, label: "N/A (SON/PSOM student)" };
    }
    return REQUIRED;
  },

  FBI_OR_AFFIDAVIT: (s) => {
    // TODO(provisional): International students — not required
    if (bool(s.is_international)) {
      return { required: false, label: "N/A (international)" };
    }
    if ((s.school === "SON" || s.school === "PSOM") && s.position_type === "volunteer") {
      return { required: false, label: "N/A (SON/PSOM student)" };
    }
    return REQUIRED;
  },

  MANDATED_REPORTER: (s) => {
    if (bool(s.works_in_partner_afterschool)) {
      return REQUIRED;
    }
    return { required: false, label: "N/A (not in partner afterschool program)" };
  },

  SDP_CODE_OF_CONDUCT: (s) => {
    if (bool(s.works_in_partner_afterschool)) {
      return REQUIRED;
    }
    return { required: false, label: "N/A (not in partner afterschool program)" };
  },

  // TODO(provisional): Client hasn't confirmed international affidavit rules
  INTL_AFFIDAVIT: (s) => {
    if (bool(s.is_international)) {
      return REQUIRED;
    }
    return { required: false, label: "N/A" };
  },
};

// TODO(provisional): in_sdp currently has no effect on requirements.

/**
 * Determine whether a clearance is required for a student.
 */
export function isRequired(
  student: StudentForRules,
  clearanceCode: ClearanceCodeType
): RequirementResult {
  const rule = rules[clearanceCode];
  if (!rule) {
    throw new Error(`Unknown clearance code: ${clearanceCode}`);
  }
  return rule(student);
}

/**
 * Get all requirement results for a student, keyed by clearance code.
 */
export function allRequirements(
  student: StudentForRules
): Record<ClearanceCodeType, RequirementResult> {
  const result = {} as Record<ClearanceCodeType, RequirementResult>;
  for (const code of Object.values(ClearanceCode)) {
    result[code] = isRequired(student, code);
  }
  return result;
}

/** Status values and their display labels */
const STATUS_LABELS: Record<string, string> = {
  not_issued: "Not Issued",
  not_started: "Not Started",
  in_progress: "In Progress",
  complete: "Complete",
  affidavit: "Affidavit",
  not_applicable: "N/A",
};

/**
 * Returns the display string for a clearance cell in the overview.
 * If the clearance is not required, returns the N/A label from the rule.
 * Otherwise returns the human-readable status.
 */
export function displayStatus(
  student: StudentForRules,
  clearanceCode: ClearanceCodeType,
  rawStatus: string
): string {
  const req = isRequired(student, clearanceCode);
  if (!req.required) {
    return req.label!;
  }
  return STATUS_LABELS[rawStatus] ?? rawStatus;
}

/**
 * A student is compliant when every REQUIRED clearance has status
 * 'complete' or 'affidavit'.
 */
export function isCompliant(
  student: StudentForRules,
  clearances: { code: ClearanceCodeType; status: string }[]
): boolean {
  for (const c of clearances) {
    const req = isRequired(student, c.code);
    if (req.required && c.status !== "complete" && c.status !== "affidavit") {
      return false;
    }
  }
  return true;
}
