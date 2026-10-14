import type { ApprovalAnswer } from "../../tools/executor";
import { AlertIcon } from "./Icons";

interface Props {
  label: string;
  reason: string;
  onAnswer: (answer: ApprovalAnswer) => void;
}

export default function ApprovalCard({ label, reason, onAnswer }: Props) {
  return (
    <div className="approval" role="alertdialog" aria-label="Approve action">
      <div className="approval-head">
        <AlertIcon size={16} />
        <strong>Allow this action?</strong>
      </div>
      <p className="approval-label">{label}</p>
      <p className="approval-reason">{reason}</p>
      <div className="approval-actions">
        <button className="btn primary" onClick={() => onAnswer("approve")}>
          Allow
        </button>
        <button className="btn" onClick={() => onAnswer("deny")}>
          Deny
        </button>
        <button className="btn ghost" onClick={() => onAnswer("always")} title="Don't ask again in this chat">
          Allow for this chat
        </button>
      </div>
    </div>
  );
}
