import { useRef, useState } from "react";
import { Check, Download, FileSpreadsheet, X } from "lucide-react";
import { useClearance } from "../state/clearance";
import { imports } from "../data/sample";
import { DOCS, formatDay } from "../lib/clearance";
import {
  Badge,
  Button,
  ButtonAnchor,
  Card,
  CardHeader,
  IconTile,
  PageHeader,
  SectionTitle,
  useToast,
} from "../components/ui";

const COLUMNS = ["name", "email", "pennkey", "program", "courses"];

const TEMPLATE = `${COLUMNS.join(",")}\nAlex Kim,akim@upenn.edu,akim,Program 1,Course A\n`;

interface Preview {
  name: string;
  rows: number;
  columns: string[];
  existing: number;
}

export default function Roster() {
  const { students } = useClearance();
  const toast = useToast();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  /** Reads the header and PennKeys only, to show what an import would do. */
  async function read(file: File) {
    const lines = (await file.text()).split(/\r?\n/).filter((line) => line.trim());
    const columns = (lines[0] ?? "")
      .split(",")
      .map((cell) => cell.trim().replace(/^"|"$/g, "").toLowerCase());
    const keyAt = columns.indexOf("pennkey");
    const known = new Set(students.map((s) => s.pennkey));
    const rows = lines.slice(1);
    const existing =
      keyAt < 0
        ? 0
        : rows.filter((row) =>
            known.has((row.split(",")[keyAt] ?? "").trim().toLowerCase())
          ).length;
    setPreview({ name: file.name, rows: rows.length, columns, existing });
  }

  const missing = preview ? COLUMNS.filter((c) => !preview.columns.includes(c)) : [];

  return (
    <>
      <PageHeader
        title="Roster"
        description="Import volunteers from a CSV. Re-importing updates people already on the roster, matched by PennKey, and never creates duplicates."
        actions={
          <ButtonAnchor
            variant="secondary"
            icon={<Download />}
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
            download="roster-template.csv"
          >
            CSV template
          </ButtonAnchor>
        }
      />

      <div className="stack">
        <Card>
          <div
            className="dropzone"
            data-over={over}
            style={{ margin: 6 }}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setOver(false);
              const file = event.dataTransfer.files[0];
              if (file) void read(file);
            }}
          >
            <IconTile size="xl">
              <FileSpreadsheet strokeWidth={1.5} />
            </IconTile>
            <div>
              <p className="card__title">
                {preview ? preview.name : "Drop a roster CSV here"}
              </p>
              <p className="card__desc">
                {preview
                  ? `${preview.rows} people · ${preview.rows - preview.existing} new · ${preview.existing} already on the roster`
                  : "One row per volunteer, with these columns:"}
              </p>
            </div>
            <div className="row" style={{ justifyContent: "center" }}>
              {COLUMNS.map((column) => {
                const absent = missing.includes(column);
                return (
                  <Badge
                    key={column}
                    mono
                    tone={!preview ? "outline" : absent ? "red" : "green"}
                  >
                    {preview && (absent ? <X aria-hidden /> : <Check aria-hidden />)}
                    {column}
                  </Badge>
                );
              })}
            </div>
            <div className="row" style={{ justifyContent: "center" }}>
              {preview && (
                <Button
                  disabled={missing.length > 0}
                  onClick={() => toast("Preview only: importing needs the roster API")}
                >
                  Import {preview.rows} people
                </Button>
              )}
              <Button variant="secondary" onClick={() => picker.current?.click()}>
                {preview ? "Choose another file" : "Choose file"}
              </Button>
              <input
                ref={picker}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void read(file);
                  event.target.value = "";
                }}
              />
            </div>
          </div>
        </Card>

        <section>
          <SectionTitle title="Recent imports" />
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Imported</th>
                  <th className="align-right">Rows</th>
                  <th className="align-right">Added</th>
                  <th className="align-right">Updated</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{row.file}</td>
                    <td className="muted">{formatDay(row.at)}</td>
                    <td className="align-right num">{row.rows}</td>
                    <td className="align-right num">{row.added}</td>
                    <td className="align-right num">{row.updated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <Card>
          <CardHeader
            title="Box folders and file names"
            description="Each student on the roster gets their own subfolder in the clearances folder, shared with them as an uploader. The app matches files by these names, so students should use them exactly."
          />
          <div className="card__body row">
            {Object.values(DOCS).map((doc) => (
              <Badge key={doc.key} mono tone="neutral" title={doc.name}>
                {doc.code}_pennkey.pdf
              </Badge>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
