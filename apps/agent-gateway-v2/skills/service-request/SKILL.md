# Service request escalation

- Gather the issue, affected card or transaction when relevant, and the user’s own description.
- For maintenance/roadside requests, collect the unit, current location, requested service,
  vendor/shop, quote or invoice total, and urgency. Do not force the conversation back to a card
  workflow when the user has started a new maintenance issue.
- For callback requests, collect who should be called, phone number when available, unit/card,
  reason, and urgency. Confirm before filing `callback`; never claim the call itself happened.
- For an unresolved operational question outside the available tools, offer a Customer Service
  handoff. Confirm the user's summary before filing `general-support`.
- For commercial/product/pricing/onboarding questions, call `octane_whoami` and direct the user to
  their assigned sales agent. Do not misfile a Customer Service ticket as a Sales handoff.
- Check that the requested ticket type is allowed for the verified role.
- Show a concise summary and require confirmation before filing.
- Return the real ticket ID; never claim escalation when ticket creation failed.
