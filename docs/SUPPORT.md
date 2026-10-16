# Support, escalation and account recovery

For the people who answer users. Names, phone numbers and hours are filled in by the owner; this document says what the roles are and what each must do.

## Roles (fill in names)
| Role | Does | Name | Phone |
|---|---|---|---|
| First line | Answers `SUPPORT_EMAIL` and the phone, logs every contact, solves what the guide solves | | |
| Second line | Looks at data and logs, reproduces problems, fixes configuration | | |
| Engineer on call | Code and database changes, rollbacks, restores | | |
| Owner | Decides on level 1 incidents, tells affected companies, talks to regulators and lawyers | | |

## Logging
Every contact gets one line in a shared log: date and time, person, company, what they said, level, who has it, outcome. Use their words. Do not write passwords or codes anywhere.

## Levels and response (targets to agree; nothing enforces them)
| Level | Meaning | First reply | Then |
|---|---|---|---|
| 1 | Money wrong, another company's data seen, account taken over, site down for everyone | 15 minutes | Straight to the engineer and owner; follow `RUNBOOK.md` section 2 |
| 2 | A core workflow is broken for a company (cannot record payments, cannot sign in) | 2 hours in hours | Second line; engineer if not fixed in a day |
| 3 | A question, a confusing screen, a small bug | 1 working day | Guide, or add to the pilot feedback list |

## Common requests
- **Cannot sign in:** `/support` has the steps. If the reset email does not arrive, check `/admin/notifications` for that address (queued, failed, gave up) and the email provider's dashboard.
- **Lost authenticator phone and no recovery codes:** see below.
- **"My numbers are wrong":** do not edit anything. Ask for the lease reference and receipt number. Look at the lease history (every change is there with who and when). Most cases are a payment recorded to the wrong lease or a reversal not yet followed by a correct entry. Explain what happened in plain words. If the system is wrong, it is level 1: raise it.
- **Wrong person in the company:** the company administrator suspends them in Team. If the administrator is the problem, see recovery.

## Account recovery: who may do what
The rule is **identity before access**. Never remove protection from an account because someone is persuasive on the phone.

1. **Password forgotten:** self-service reset. No staff action.
2. **Lost authenticator, has recovery code:** self-service.
3. **Lost authenticator, no recovery code, ordinary user:** ask the user's **company administrator** (a different person) to confirm by a channel you already hold (their registered email, or a call to a number on file, not one given in the request). Then an engineer clears the two-step secret for that account in the database and the user signs in with the password and sets up again. Log who confirmed.
4. **Lost authenticator, company administrator:** the second administrator of the same company or the owner confirms in person or by a known phone number. Same engineer step.
5. **Platform administrator locked out:** use the second platform administrator to reset. If both are locked out, the owner and the engineer act together with access to the database, and write the incident up.
6. **Suspected takeover:** end sessions, reset the password, require a new two-step set-up, review the activity log for that user, and tell the company administrator.

(Clearing a two-step secret today is a manual database operation: set `mfa_secret`, `mfa_enabled_at` and `mfa_last_step` to NULL for that user and delete their `mfa_recoveries`. There is no screen for it yet.)

## Incident reporting by users
Users report by `SUPPORT_EMAIL` or phone. A company administrator reporting a suspected breach is level 1. Acknowledge in writing, give a name, and promise the next update time.

## Keep a record for improvement
Monthly: count contacts by cause. The top three causes are the next three things to fix in the product or the guide.
