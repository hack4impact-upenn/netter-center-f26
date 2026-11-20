import { useState } from "react";
import { Check, ExternalLink, FileText, Info, X } from "lucide-react";
import type { RejectReason } from "../types";
import { useClearance, type QueueItem } from "../state/clearance";
import { useHotkey } from "../hooks/useHotkey";
import { box } from "../data/sample";
import {
  DOCS,
  REASON_LABEL,
  daysAgoLabel,
  fileName,
  requiredDocs,
} from "../lib/clearance";
import { DocBadge } from "../components/DocBadge";
import {
  Badge,
  Button,
  ButtonAnchor,
  Card,
  EmptyState,
  Field,
  IconTile,
  PageHeader,
  Segmented,
  Textarea,
  useToast,
} from "../components/ui";

const MOD = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";

export default function ReviewQueue() {
  const { queue, approve, reject } = useClearance();
  const toast = useToast();
  const [order, setOrder] = useState<"oldest" | "newest">("oldest");
  const items = order === "oldest" ? queue : [...queue].reverse();
  const [selectedKey, setSelectedKey] = useState(items[0]?.key);
  const index = Math.max(
    0,
    items.findIndex((item) => item.key === selectedKey)
  );
  const current = items[index];

  const move = (step: number) => {
    const next = items[index + step];
    if (next) setSelectedKey(next.key);
  };
  useHotkey("j", () => move(1));
  useHotkey("k", () => move(-1));

  /** Decide the current item, then land on the one after it. */
  function decide(act: () => void, message: string) {
    setSelectedKey((items[index + 1] ?? items[index - 1])?.key);
    act();
    toast(message);
  }

  return (
    <>
      <PageHeader
        title="Review queue"
        description="Open each file in Box, check it by hand, then mark it here. The app reads file names only; it never opens or stores a document."
      />

      {!current ? (
        <Card>
          <EmptyState
            art={
              <IconTile size="xl" tone="green">
                <Check />
              </IconTile>
            }
            title="All caught up"
            description="New uploads show up here as soon as a file lands in a student's Box folder."
          />
        </Card>
      ) : (
        <div className="queue">
          <Card className="queue-list">
            <div className="queue-list__head">
              <span className="card__title">
                <span className="num">{items.length}</span> to review
              </span>
              <Segmented
                size="sm"
                label="Sort"
                value={order}
                onChange={setOrder}
                options={[
                  { value: "oldest", label: "Oldest" },
                  { value: "newest", label: "Newest" },
                ]}
              />
            </div>
            <div
              className="queue-list__rows"
              role="listbox"
              aria-label="Documents to review"
            >
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="option"
                  aria-selected={item.key === current.key}
                  className="queue-row"
                  onClick={() => {
                    setSelectedKey(item.key);
                    // Stacked on a narrow screen, the document sits below the list.
                    if (window.matchMedia("(max-width: 1023px)").matches) {
                      document
                        .getElementById("review")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                  }}
                >
                  <span>
                    <span className="queue-row__name">{item.student.name}</span>
                    <span className="queue-row__meta">
                      {item.course?.name} · {daysAgoLabel(item.uploadedDaysAgo)}
                    </span>
                  </span>
                  <Badge tone="outline">{DOCS[item.doc].short}</Badge>
                </button>
              ))}
            </div>
            <div className="queue-list__foot">
              <kbd className="kbd">J</kbd>
              <kbd className="kbd">K</kbd>
              to move between documents
            </div>
          </Card>

          <ReviewPanel
            key={current.key}
            item={current}
            onApprove={() =>
              decide(
                () => approve(current.student.id, current.doc),
                `Approved ${DOCS[current.doc].short} for ${current.student.name}`
              )
            }
            onReject={(reason, note) =>
              decide(
                () => reject(current.student.id, current.doc, reason, note),
                `Rejected ${DOCS[current.doc].short} and emailed ${current.student.name}`
              )
            }
          />
        </div>
      )}
    </>
  );
}

function ReviewPanel({
  item,
  onApprove,
  onReject,
}: {
  item: QueueItem;
  onApprove: () => void;
  onReject: (reason: RejectReason, note: string) => void;
}) {
  const { student, course, doc } = item;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<RejectReason>("wrong");
  const [note, setNote] = useState("");
  const canReject = reason !== "other" || note.trim().length > 0;

  useHotkey("a", onApprove, !rejecting);
  useHotkey("r", () => setRejecting(true), !rejecting);
  useHotkey("o", () => window.open(box.url, "_blank", "noreferrer"));
  // From the note field, the form's own key handler cancels instead.
  useHotkey("Escape", () => setRejecting(false), rejecting);

  return (
    <Card id="review" className="review">
      <div className="review__head">
        <div className="review__who">
          <IconTile size="lg">
            <FileText strokeWidth={1.75} />
          </IconTile>
          <div>
            <p className="muted">
              {course?.name} · {course?.program}
            </p>
            <h2 className="review__title display">
              {student.name} · {DOCS[doc].short}
            </h2>
          </div>
        </div>
        <ButtonAnchor
          variant="secondary"
          href={box.url}
          target="_blank"
          rel="noreferrer"
          icon={<ExternalLink />}
          keys={["O"]}
        >
          Open in Box
        </ButtonAnchor>
      </div>

      <dl className="facts">
        <div>
          <dt>File in Box</dt>
          <dd className="mono" title={fileName(student, doc)}>
            {fileName(student, doc)}
          </dd>
        </div>
        <div>
          <dt>Document</dt>
          <dd>{DOCS[doc].name}</dd>
        </div>
        <div>
          <dt>PennKey</dt>
          <dd>{student.pennkey}</dd>
        </div>
        <div>
          <dt>Uploaded</dt>
          <dd>{daysAgoLabel(item.uploadedDaysAgo)}</dd>
        </div>
      </dl>

      <div className="review__docs">
        <span className="subtle">All of {student.name.split(" ")[0]}'s documents</span>
        <div className="doc-chips">
          {requiredDocs(student, course).map((d) => (
            <DocBadge key={d} doc={d} record={student.docs[d]} />
          ))}
        </div>
      </div>

      {!rejecting ? (
        <div className="review__actions">
          <Button icon={<Check />} keys={["A"]} onClick={onApprove}>
            Approve
          </Button>
          <Button
            variant="secondary"
            icon={<X />}
            keys={["R"]}
            onClick={() => setRejecting(true)}
          >
            Reject
          </Button>
        </div>
      ) : (
        <form
          className="reject"
          onSubmit={(event) => {
            event.preventDefault();
            if (canReject) onReject(reason, note.trim());
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setRejecting(false);
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canReject) {
              event.preventDefault();
              onReject(reason, note.trim());
            }
          }}
        >
          <div className="field">
            <span className="field__label">Why is it being rejected?</span>
            <Segmented
              label="Reason"
              value={reason}
              onChange={setReason}
              options={(Object.keys(REASON_LABEL) as RejectReason[]).map((value) => ({
                value,
                label: REASON_LABEL[value],
              }))}
            />
          </div>
          <Field
            label={reason === "other" ? "Note to student" : "Note to student (optional)"}
            htmlFor="reject-note"
          >
            <Textarea
              id="reject-note"
              autoFocus
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={`For example: upload the full ${DOCS[doc].short} result, not the receipt.`}
            />
          </Field>
          <div className="callout" style={{ marginTop: 0 }}>
            <Info />
            <span>
              {student.name.split(" ")[0]} is emailed this reason, and the file in Box is
              renamed to <span className="mono">{fileName(student, doc, true)}</span>.
            </span>
          </div>
          <div className="row">
            <Button
              type="submit"
              variant="danger"
              keys={[MOD, "↩"]}
              disabled={!canReject}
            >
              Reject and email student
            </Button>
            <Button
              variant="secondary"
              keys={["Esc"]}
              onClick={() => setRejecting(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
