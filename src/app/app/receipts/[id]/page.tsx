import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getReceipt } from "@/lib/services/leases";
import { formatKobo } from "@/lib/money";
import { receiptStatus } from "@/lib/ledger-rules";
import { formatDate, formatDateTime } from "@/lib/dates";
import { Pill } from "@/components/ui";

export const metadata = { title: "Receipt" };

export default async function ReceiptPage({ params }: { params: { id: string } }) {
  const member = await requireMember("finance.view");
  const result = await getReceipt(member, params.id);
  if (!result) notFound();
  const { receipt, companyName, recordedBy } = result;
  const status = receiptStatus({ reversed: !!receipt.reversal, reconciled: !!receipt.reconciliation });

  return (
    <div className="stack" style={{ maxWidth: 640, marginInline: "auto" }}>
      <p className="small"><Link href={`/app/leases/${receipt.lease.id}`}>Back to lease {receipt.lease.ref}</Link></p>
      <article className="card stack" aria-label={`Receipt ${receipt.no}`}>
        <div className="row between">
          <div>
            <p className="eyebrow mono">Receipt</p>
            <h1>{receipt.no}</h1>
          </div>
          <Pill status={status} />
        </div>
        <p className="muted">{companyName}</p>
        <div className="fields">
          <div><div className="small muted">Amount received</div><strong style={{ fontSize: 22 }}>{formatKobo(receipt.amountKobo)}</strong></div>
          <div><div className="small muted">Date paid</div>{formatDate(receipt.paidOn)}</div>
          <div><div className="small muted">Method</div>{receipt.method || "—"}</div>
        </div>
        <div className="fields">
          <div><div className="small muted">Received from</div>{receipt.payerName || receipt.lease.occupantName}</div>
          <div><div className="small muted">Property</div>{receipt.lease.asset.ref} · {receipt.lease.asset.name}{receipt.lease.unit ? ` · ${receipt.lease.unit}` : ""}</div>
          <div><div className="small muted">Lease</div>{receipt.lease.ref}</div>
        </div>
        <div>
          <div className="small muted">Applied to</div>
          <ul className="timeline" style={{ marginTop: 6 }}>
            {receipt.allocations.map((a) => (
              <li key={a.id}><div>Rent due {formatDate(a.charge.dueDate)}: <strong>{formatKobo(a.amountKobo)}</strong></div></li>
            ))}
          </ul>
        </div>
        <div><div className="small muted">Evidence reference</div>{receipt.evidence}</div>
        <p className="small muted">
          Recorded by {recordedBy} on {formatDateTime(receipt.createdAt)}.
          {receipt.reconciliation ? ` Reconciled against ${receipt.reconciliation.statementRef} on ${formatDateTime(receipt.reconciliation.createdAt)}.` : " Not yet reconciled to a bank statement."}
          {receipt.reversal ? ` Reversed on ${formatDateTime(receipt.reversal.createdAt)}: ${receipt.reversal.reason}.` : ""}
        </p>
      </article>
      <p className="small muted">A receipt records money received. It is confirmed only once it has been reconciled to a bank statement.</p>
    </div>
  );
}
