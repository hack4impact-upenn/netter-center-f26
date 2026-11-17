import { describe, it, expect } from "bun:test";
import {
  isRequired,
  allRequirements,
  isCompliant,
  displayStatus,
  ClearanceCode,
  type StudentForRules,
  type ClearanceCodeType,
} from "../clearance-rules";

// ─── Helper to build students with defaults ───────────────────

function makeStudent(overrides: Partial<StudentForRules> = {}): StudentForRules {
  return {
    school: "other",
    position_type: "volunteer",
    works_in_partner_afterschool: false,
    is_international: false,
    in_sdp: false,
    ...overrides,
  };
}

// ─── Test Cases ───────────────────────────────────────────────

describe("clearance requirement rules", () => {
  describe("domestic volunteer (standard case)", () => {
    const student = makeStudent();

    it("requires PA Child Abuse, PATCH, FBI", () => {
      expect(isRequired(student, ClearanceCode.PA_CHILD_ABUSE).required).toBe(true);
      expect(isRequired(student, ClearanceCode.PATCH).required).toBe(true);
      expect(isRequired(student, ClearanceCode.FBI_OR_AFFIDAVIT).required).toBe(true);
    });

    it("does not require Mandated Reporter or SDP CoC", () => {
      expect(isRequired(student, ClearanceCode.MANDATED_REPORTER).required).toBe(false);
      expect(isRequired(student, ClearanceCode.SDP_CODE_OF_CONDUCT).required).toBe(false);
    });

    it("does not require International Affidavit", () => {
      expect(isRequired(student, ClearanceCode.INTL_AFFIDAVIT).required).toBe(false);
      expect(isRequired(student, ClearanceCode.INTL_AFFIDAVIT).label).toBe("N/A");
    });
  });

  describe("SON volunteer", () => {
    const student = makeStudent({ school: "SON" });

    it("does NOT require PA Child Abuse, PATCH, FBI (completed through nursing program)", () => {
      expect(isRequired(student, ClearanceCode.PA_CHILD_ABUSE).required).toBe(false);
      expect(isRequired(student, ClearanceCode.PA_CHILD_ABUSE).label).toBe("N/A (SON/PSOM student)");

      expect(isRequired(student, ClearanceCode.PATCH).required).toBe(false);
      expect(isRequired(student, ClearanceCode.FBI_OR_AFFIDAVIT).required).toBe(false);
    });
  });

  describe("PSOM paid", () => {
    const student = makeStudent({ school: "PSOM", position_type: "paid" });

    it("DOES require PA Child Abuse, PATCH, FBI (paid overrides school exemption)", () => {
      expect(isRequired(student, ClearanceCode.PA_CHILD_ABUSE).required).toBe(true);
      expect(isRequired(student, ClearanceCode.PATCH).required).toBe(true);
      expect(isRequired(student, ClearanceCode.FBI_OR_AFFIDAVIT).required).toBe(true);
    });
  });

  describe("PSOM volunteer", () => {
    const student = makeStudent({ school: "PSOM" });

    it("does NOT require main 3 clearances", () => {
      expect(isRequired(student, ClearanceCode.PA_CHILD_ABUSE).required).toBe(false);
      expect(isRequired(student, ClearanceCode.PATCH).required).toBe(false);
      expect(isRequired(student, ClearanceCode.FBI_OR_AFFIDAVIT).required).toBe(false);
    });
  });

  describe("international student", () => {
    const student = makeStudent({ is_international: true });

    it("does NOT require PA Child Abuse, PATCH, FBI", () => {
      expect(isRequired(student, ClearanceCode.PA_CHILD_ABUSE).required).toBe(false);
      expect(isRequired(student, ClearanceCode.PA_CHILD_ABUSE).label).toBe("N/A (international)");

      expect(isRequired(student, ClearanceCode.PATCH).required).toBe(false);
      expect(isRequired(student, ClearanceCode.FBI_OR_AFFIDAVIT).required).toBe(false);
    });

    it("DOES require International Affidavit", () => {
      expect(isRequired(student, ClearanceCode.INTL_AFFIDAVIT).required).toBe(true);
    });
  });

  describe("international student (SQLite integer booleans)", () => {
    // D1 stores booleans as 0/1
    const student = makeStudent({ is_international: 1 });

    it("handles integer 1 the same as true", () => {
      expect(isRequired(student, ClearanceCode.PA_CHILD_ABUSE).required).toBe(false);
      expect(isRequired(student, ClearanceCode.INTL_AFFIDAVIT).required).toBe(true);
    });
  });

  describe("partner afterschool worker", () => {
    const student = makeStudent({ works_in_partner_afterschool: true });

    it("requires Mandated Reporter and SDP Code of Conduct", () => {
      expect(isRequired(student, ClearanceCode.MANDATED_REPORTER).required).toBe(true);
      expect(isRequired(student, ClearanceCode.SDP_CODE_OF_CONDUCT).required).toBe(true);
    });
  });

  describe("NOT in partner afterschool", () => {
    const student = makeStudent({ works_in_partner_afterschool: false });

    it("does not require Mandated Reporter or SDP CoC", () => {
      const mr = isRequired(student, ClearanceCode.MANDATED_REPORTER);
      expect(mr.required).toBe(false);
      expect(mr.label).toBe("N/A (not in partner afterschool program)");

      const sdp = isRequired(student, ClearanceCode.SDP_CODE_OF_CONDUCT);
      expect(sdp.required).toBe(false);
      expect(sdp.label).toBe("N/A (not in partner afterschool program)");
    });
  });

  describe("in_sdp has no effect (provisional)", () => {
    const withSdp = makeStudent({ in_sdp: true });
    const withoutSdp = makeStudent({ in_sdp: false });

    it("same requirements whether in_sdp is true or false", () => {
      const allWith = allRequirements(withSdp);
      const allWithout = allRequirements(withoutSdp);

      for (const code of Object.values(ClearanceCode)) {
        expect(allWith[code].required).toBe(allWithout[code].required);
      }
    });
  });

  describe("student in multiple courses and programs", () => {
    // Rules only depend on student attributes, not courses/programs
    const student = makeStudent({ works_in_partner_afterschool: true });

    it("requirements are determined by student attributes, not enrollment", () => {
      expect(isRequired(student, ClearanceCode.PA_CHILD_ABUSE).required).toBe(true);
      expect(isRequired(student, ClearanceCode.MANDATED_REPORTER).required).toBe(true);
      expect(isRequired(student, ClearanceCode.INTL_AFFIDAVIT).required).toBe(false);
    });
  });
});

// ─── Compliance ───────────────────────────────────────────────

describe("compliance calculation", () => {
  const allCodes = Object.values(ClearanceCode);

  function makeClearances(
    statuses: Partial<Record<ClearanceCodeType, string>>
  ) {
    return allCodes.map((code) => ({
      code,
      status: statuses[code] ?? "not_issued",
    }));
  }

  it("domestic volunteer is compliant when 3 main clearances are complete", () => {
    const student = makeStudent();
    const clearances = makeClearances({
      PA_CHILD_ABUSE: "complete",
      PATCH: "complete",
      FBI_OR_AFFIDAVIT: "complete",
    });
    expect(isCompliant(student, clearances)).toBe(true);
  });

  it("domestic volunteer is NOT compliant when one main clearance is missing", () => {
    const student = makeStudent();
    const clearances = makeClearances({
      PA_CHILD_ABUSE: "complete",
      PATCH: "in_progress",
      FBI_OR_AFFIDAVIT: "complete",
    });
    expect(isCompliant(student, clearances)).toBe(false);
  });

  it("affidavit counts as compliant for FBI_OR_AFFIDAVIT", () => {
    const student = makeStudent();
    const clearances = makeClearances({
      PA_CHILD_ABUSE: "complete",
      PATCH: "complete",
      FBI_OR_AFFIDAVIT: "affidavit",
    });
    expect(isCompliant(student, clearances)).toBe(true);
  });

  it("SON volunteer is compliant with no clearances (all are N/A)", () => {
    const student = makeStudent({ school: "SON" });
    const clearances = makeClearances({}); // all not_issued
    expect(isCompliant(student, clearances)).toBe(true);
  });

  it("partner afterschool worker needs mandated reporter + SDP + main 3", () => {
    const student = makeStudent({ works_in_partner_afterschool: true });

    // Missing mandated reporter
    const partial = makeClearances({
      PA_CHILD_ABUSE: "complete",
      PATCH: "complete",
      FBI_OR_AFFIDAVIT: "complete",
      SDP_CODE_OF_CONDUCT: "complete",
    });
    expect(isCompliant(student, partial)).toBe(false);

    // All complete
    const full = makeClearances({
      PA_CHILD_ABUSE: "complete",
      PATCH: "complete",
      FBI_OR_AFFIDAVIT: "complete",
      MANDATED_REPORTER: "complete",
      SDP_CODE_OF_CONDUCT: "complete",
    });
    expect(isCompliant(student, full)).toBe(true);
  });

  it("international student is compliant when intl affidavit is complete", () => {
    const student = makeStudent({ is_international: true });
    const clearances = makeClearances({ INTL_AFFIDAVIT: "complete" });
    expect(isCompliant(student, clearances)).toBe(true);
  });
});

// ─── Display Status ───────────────────────────────────────────

describe("displayStatus", () => {
  it("shows N/A label when clearance is not required", () => {
    const student = makeStudent({ school: "SON" });
    expect(displayStatus(student, ClearanceCode.PA_CHILD_ABUSE, "not_issued")).toBe(
      "N/A (SON/PSOM student)"
    );
  });

  it("shows readable status when clearance is required", () => {
    const student = makeStudent();
    expect(displayStatus(student, ClearanceCode.PA_CHILD_ABUSE, "complete")).toBe("Complete");
    expect(displayStatus(student, ClearanceCode.PA_CHILD_ABUSE, "in_progress")).toBe("In Progress");
    expect(displayStatus(student, ClearanceCode.PA_CHILD_ABUSE, "not_issued")).toBe("Not Issued");
    expect(displayStatus(student, ClearanceCode.PA_CHILD_ABUSE, "not_started")).toBe("Not Started");
  });

  it("shows Affidavit for affidavit status", () => {
    const student = makeStudent();
    expect(displayStatus(student, ClearanceCode.FBI_OR_AFFIDAVIT, "affidavit")).toBe("Affidavit");
  });
});
