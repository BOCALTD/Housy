# Bringing in existing records

For a company that already keeps its assets and tenancies in spreadsheets. Only the company administrator can do this ("Bring in records" in the workspace menu, `/app/import`).

## How it works
1. **Download the template** (assets or leases). The headings are forgiving: "Asset Class", "asset_class" and "ASSET-CLASS" are the same column, and common spellings of values ("half-yearly", "Plant and machinery", "under renovation") are understood.
2. **Fill it in and save as CSV.** At most 2,000 lines and 2 MB per file.
3. **Upload.** Nothing is created. The preview shows each line as one of:
   - **Ready**: will be created.
   - **Duplicate**: already in the system (same name, address and city for an asset; same property, unit, start date and tenant for a lease) or repeated earlier in the same file. Skipped.
   - **Error**: a mistake in the file, with the reason in plain words (unknown class, date that does not exist, rent missing, "Paid so far" larger than all the rent on the lease, asset not found, two assets with that name).
4. **Confirm** (tick the box, then "Create n records"). Each good line is created in its own transaction, so one bad line never blocks the others. A batch can be confirmed once only. A line that passes the preview but is refused by the real rules (for example a lease that overlaps another on the same unit) is marked **Could not be created**, with the reason.
5. **Read the reconciliation.** It compares totals from the file with what is now in the database and shows "Agrees" or "Differs" for each. Save the report (every line, its result and reason) with "Save the report".

## Order
Import **assets first**, then leases. A lease line names its asset by reference (`AST-00012`) or by exact name. If two assets share a name the line is rejected and asks for the reference.

## Opening balances
Leases carry one extra column, **Paid so far**: the total naira the tenant has paid on that lease to date. The system records it as one receipt, dated the day of the import, with the evidence `IMPORT IMP-0003 row 7`, method "Opening balance". It is cleared against the **oldest rent first**, exactly as a normal payment is, so arrears, part-paid charges and receipts all behave normally afterwards. If you have the individual payments, enter them as normal payments instead; they carry real dates and references.

The deposit column is recorded on the lease. The money itself still has to be entered in the deposit ledger.

## What the reconciliation proves
For assets: every created line has an asset, and the sum of acquisition costs in the file equals the sum in the database.
For leases: every created line has a lease; total rent scheduled equals the sum of the rent schedule the file implies; total paid agrees three ways (the file, the rent charges, the opening receipts); and total still owed equals scheduled minus paid. It also confirms that every line of the file has exactly one outcome, so nothing is dropped silently.

## What it does not do
- It does not import tenants' individual payment histories, documents, photographs, service charges, maintenance records or contacts. Those would each need their own template.
- It does not guess dates written month-first (`01/31/2026`). Day-first (`31/01/2026`) and `2026-01-31` are accepted.
- Duplicate detection is by exact normalised match (case, punctuation and spacing ignored). A misspelt name is not recognised as a duplicate; the preview is where a person catches those.
- It has been tested with generated files only. **No real company's data has been imported.** Before relying on it, run a real file through the preview, read every Error and Duplicate line, and confirm only when they make sense.
