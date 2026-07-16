import type { AuditEntry } from "tiptap-apcore";

interface AuditPanelProps {
  entries: AuditEntry[];
}

/** Format an ISO timestamp as HH:MM:SS for compact display. */
function formatTime(iso: string): string {
  return iso.length >= 19 ? iso.slice(11, 19) : iso;
}

/**
 * AuditPanel — renders the structured ACL audit trail produced when the
 * TiptapAPCore instance is created with `audit: true`. Every allow/deny
 * decision recorded by the AclGuard is surfaced here, newest first.
 */
export default function AuditPanel({ entries }: AuditPanelProps) {
  const denied = entries.filter((e) => e.decision === "deny").length;

  return (
    <div className="card audit-panel">
      <h2>
        ACL Audit Log
        <span className="audit-count">
          {entries.length} total{denied > 0 ? `, ${denied} denied` : ""}
        </span>
      </h2>

      {entries.length === 0 ? (
        <div className="audit-empty">
          No decisions yet. Run a command (or switch roles and retry a denied
          one) to see allow/deny entries appear here.
        </div>
      ) : (
        <ul className="audit-entries">
          {[...entries].reverse().map((entry, i) => (
            <li key={i} className={`audit-entry audit-${entry.decision}`}>
              <span className="audit-time">{formatTime(entry.timestamp)}</span>
              <span className={`audit-badge audit-badge-${entry.decision}`}>
                {entry.decision.toUpperCase()}
              </span>
              <span className="audit-target">{entry.targetId}</span>
              {entry.roles.length > 0 && (
                <span className="audit-role">{entry.roles.join(", ")}</span>
              )}
              {entry.decision === "deny" && entry.reason && (
                <span className="audit-reason">{entry.reason}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
