interface ApprovalCardProps {
  toolName: string;
  reason: string;
  argsSummary: string;
  onApprove: () => void;
  onDeny: () => void;
}

// Blocking card for irreversible actions. Shows the exact tool, reason, and
// argument summary — the model never sees full field values, but the user
// always does (form_submit previews land with the form tool).
export default function ApprovalCard({
  toolName,
  reason,
  argsSummary,
  onApprove,
  onDeny,
}: ApprovalCardProps) {
  return (
    <section role="alertdialog" aria-label={`Approve ${toolName}`}>
      <h2>Approval required</h2>
      <dl>
        <div>
          <dt>Action</dt>
          <dd>{toolName}</dd>
        </div>
        <div>
          <dt>Why approval is needed</dt>
          <dd>{reason}</dd>
        </div>
        <div>
          <dt>Arguments</dt>
          <dd>{argsSummary}</dd>
        </div>
      </dl>
      <button onClick={onApprove}>Approve</button>
      <button onClick={onDeny}>Deny</button>
    </section>
  );
}
