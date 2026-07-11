/* Sales Mytrion redesign — reference mock data, extracted VERBATIM from the prototype.
   Seeds the UI at pixel fidelity; the live-data pass swaps the already-wired tabs. */
/* eslint-disable */

export const ANN = [
    { type:'ai', color:'var(--accent)', title:'Mytrion AI now drafts follow-up emails', body:"You can now ask Mytrion to draft a follow-up email for any stuck application. It pulls the carrier's last activity, outstanding balance, and account notes, then writes a ready-to-send message in your voice.\n\nTry it: open the chat and type \"draft a follow-up for RICS Logistics\".", time:'32m ago', icon:'M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z', prio:'Info' },
    { type:'system', color:'var(--warn)', title:'Scheduled maintenance Sat 2–4 AM ET', body:"The transactions data warehouse will be briefly unavailable during a scheduled upgrade on Saturday between 2:00 AM and 4:00 AM Eastern.\n\nCard actions, invoices and the AI copilot remain fully available. Only historical transaction reports may be delayed.", time:'2h ago', icon:'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z', prio:'Normal' },
    { type:'policy', color:'var(--violet)', title:'New WEX card-limit policy in effect', body:"Effective immediately, single-transaction fuel limits above $2,000 require a supervisor note on the deal. The limit-change automation will prompt you for this note automatically.", time:'Yesterday', icon:'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', prio:'High' },
  ] as const;

export const INBOX = [
    { id:'m1', type:'critical', prio:'high', title:'RICS Logistics — card on fraud hold', desc:"Card ••4471 was auto-held after 3 declined swipes in Newark, NJ. Driver is stranded. Review and override if legitimate.", time:'8m ago', tag:'Fraud' },
    { id:'m2', type:'task', prio:'medium', title:'Follow up: Blue Ridge Freight application', desc:"Application #872228 has been in 'Docs Pending' for 6 days. Call the contact and confirm the voided check was received.", time:'41m ago', tag:'Application' },
    { id:'m3', type:'warning', prio:'high', title:'Coastal Haul — balance overdue $4,280', desc:"Account is 14 days past due. A soft debtor flag was applied. Reach out before it escalates to hard debtor.", time:'1h ago', tag:'Billing' },
    { id:'m4', type:'reminder', prio:'medium', title:'New lead assigned: Summit Carriers', desc:"A new inbound lead was routed to you from the WEX partner form. First touch within 2 hours keeps you on the leaderboard.", time:'2h ago', tag:'Lead' },
    { id:'m5', type:'info', prio:'small', title:'Weekly volume recap is ready', desc:"Your carriers pumped 48,210 gallons this week — up 6% over last week. Nice work.", time:'3h ago', tag:'Recap' },
    { id:'m6', type:'task', prio:'medium', title:'Verify DOT for Meridian Transport', desc:"DOT #602070 needs re-verification before the card ships. Run the verification automation when you have a moment.", time:'5h ago', tag:'Verification' },
    { id:'m7', type:'reminder', prio:'small', title:'Reactivation approved: Delta Freight', desc:"The reactivation request you filed yesterday was approved. Cards are active again.", time:'Yesterday', tag:'Cards' },
  ] as const;

export const RECORDS = [
    { id:'c1', name:'RICS Logistics', carrier:'CR-10428', contact:'Richard Crossan', phone:'610-645-2231', cards:12, active:9, gallons:'18,240', balance:'-$1,240.00', status:'attention', mc:'285921', dot:'602070' },
    { id:'c2', name:'Blue Ridge Freight', carrier:'CR-10771', contact:'Dana Whitfield', phone:'540-221-9087', cards:8, active:8, gallons:'22,905', balance:'$0.00', status:'active', mc:'318402', dot:'771230' },
    { id:'c3', name:'Coastal Haul Co.', carrier:'CR-09982', contact:'Marta Nunez', phone:'305-778-4410', cards:15, active:6, gallons:'9,110', balance:'-$4,280.00', status:'debtor', mc:'204118', dot:'558921' },
    { id:'c4', name:'Summit Carriers', carrier:'CR-11204', contact:'Owen Park', phone:'801-559-3320', cards:5, active:5, gallons:'6,540', balance:'$0.00', status:'active', mc:'402551', dot:'889012' },
    { id:'c5', name:'Meridian Transport', carrier:'CR-10055', contact:'Priya Anand', phone:'312-660-1180', cards:20, active:14, gallons:'31,780', balance:'-$620.00', status:'attention', mc:'115540', dot:'334021' },
    { id:'c6', name:'Delta Freight LLC', carrier:'CR-11890', contact:'Sam Okafor', phone:'404-223-7756', cards:7, active:7, gallons:'14,320', balance:'$0.00', status:'active', mc:'509871', dot:'660145' },
  ] as const;

export const AUTOMATIONS = [
    { id:'invoices', title:'Request Invoices', codes:['C-20','Q-1'], dept:'Q', icon:'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', desc:'Fetch carrier invoices by date range and download the exact files from WorkDrive.', top:true, kind:'invoices' },
    { id:'transactions', title:'Transactions Report', codes:['Q-4'], dept:'Q', icon:'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z', desc:'Pull a full fuel-transaction report for any carrier across a custom date window.', top:true, kind:'transactions' },
    { id:'card-activation', title:'Activate a Card', codes:['C-3'], dept:'C', icon:'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3zM12 8v8M8 12h8', desc:'Set an EFS card to Active and optionally attach driver name, unit and driver ID.', kind:'card', verb:'Activate Card' },
    { id:'limits-change', title:'Change Card Limits', codes:['C-8'], dept:'C', icon:'M12 6v6l4 2m-4 10a10 10 0 110-20 10 10 0 010 20z', desc:'Increase or decrease a per-transaction or daily limit on any active card.', kind:'card', verb:'Update Limit', limits:true },
    { id:'fraud-hold-release', title:'Release Fraud Hold', codes:['C-11'], dept:'C', icon:'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622z', desc:'Clear a fraud hold on a card once the swipe pattern is confirmed legitimate.', kind:'card', verb:'Release Hold' },
    { id:'override-card', title:'Override a Card', codes:['C-16'], dept:'C', icon:'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z', desc:'Grant a fraud-held card a ~30 minute active window without lifting the hold.', kind:'card', verb:'Override Card' },
    { id:'card-replacement', title:'Card Replacement', codes:['C-6'], dept:'C', icon:'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z', desc:'Ship replacement cards to a confirmed address with live address autocomplete.', kind:'ticket', verb:'Request Replacement' },
    { id:'boca-boe-link', title:'BOCA Link Request', codes:['C-27'], dept:'C', icon:'M13.828 10.172a4 4 0 010 5.656l-4 4a4 4 0 01-5.656-5.656l1.5-1.5m9.656-9.656l-1.5 1.5m-4 4a4 4 0 015.656 0', desc:'Generate a BOCA onboarding link for a WEX application and assign it to the owner.', kind:'form', verb:'Send BOCA' },
    { id:'money-code', title:'Issue Money Code', codes:['C-9'], dept:'C', icon:'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', desc:'Generate an emergency EFS money code for a stranded driver.', kind:'simple', verb:'Issue Code' },
    { id:'wex-apps', title:'WEX Applications', codes:['C-29'], dept:'C', icon:'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', desc:'Search WEX applications by name, MC/DOT, email or application ID.', kind:'search' },
    { id:'balance', title:'Account Balance Check', codes:['Q-7'], dept:'Q', icon:'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', desc:'Check the current available balance and credit line for a carrier account.', kind:'simple', verb:'Check Balance' },
    { id:'unit-driver', title:'Edit Card Prompts', codes:['C-4'], dept:'C', icon:'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828z', desc:'Update the driver name, unit number and driver ID prompts on a card.', kind:'card', verb:'Submit Change' },
    { id:'verification', title:'DOT / MC Verification', codes:['V-2'], dept:'V', icon:'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622z', desc:'Re-run FMCSA verification on a carrier before a card ships.', kind:'simple', verb:'Verify Carrier' },
    { id:'close-app', title:'Close Application', codes:['C-14'], dept:'C', icon:'M6 18L18 6M6 6l12 12', desc:'Close a WEX application that is no longer moving forward.', kind:'form', verb:'Close Application' },
    { id:'reactivation', title:'Card Reactivation', codes:['C-7'], dept:'C', icon:'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15', desc:'File a reactivation request for a deactivated card.', kind:'ticket', verb:'Request Reactivation' },
    { id:'statement', title:'Monthly Statement', codes:['Q-9'], dept:'Q', icon:'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', desc:'Download a carrier statement PDF for any billing cycle.', soon:true, kind:'invoices' },
  ] as const;

export const DEALS = [
    { id:'d1', name:'RICS Logistics — Fleet 12', company:'RICS Logistics', app:'872228', carrier:'CR-10428', phone:'610-645-2231' },
    { id:'d2', name:'Blue Ridge Freight — Q3 expansion', company:'Blue Ridge Freight', app:'884120', carrier:'CR-10771', phone:'540-221-9087' },
    { id:'d3', name:'Coastal Haul — replacement cards', company:'Coastal Haul Co.', app:'869041', carrier:'CR-09982', phone:'305-778-4410' },
    { id:'d4', name:'Meridian Transport — new units', company:'Meridian Transport', app:'890233', carrier:'CR-10055', phone:'312-660-1180' },
  ] as const;

export const CARDS = [
    { id:'k1', number:'70889012340004471', status:'fraud', driver:'J. Alvarez', unit:'1042' },
    { id:'k2', number:'70889012340009982', status:'active', driver:'M. Doyle', unit:'0771' },
    { id:'k3', number:'70889012340001205', status:'active', driver:'', unit:'' },
    { id:'k4', number:'70889012340006640', status:'inactive', driver:'R. Kim', unit:'2210' },
  ] as const;

export const INVROWS = [
    { inv:'WD-48120', date:'Jun 28, 2026', amount:'$8,240.15', status:'Paid' },
    { inv:'WD-47993', date:'Jun 14, 2026', amount:'$6,915.40', status:'Paid' },
    { inv:'WD-47810', date:'May 31, 2026', amount:'$9,102.88', status:'Overdue' },
    { inv:'WD-47655', date:'May 17, 2026', amount:'$5,480.00', status:'Paid' },
  ] as const;

export const TXNROWS = [
    { date:'Jul 09', card:'••4471', driver:'J. Alvarez', gallons:'142.6', amount:'$486.20' },
    { date:'Jul 09', card:'••9982', driver:'M. Doyle', gallons:'98.3', amount:'$334.90' },
    { date:'Jul 08', card:'••1205', driver:'—', gallons:'165.1', amount:'$562.40' },
    { date:'Jul 08', card:'••4471', driver:'J. Alvarez', gallons:'120.0', amount:'$408.00' },
    { date:'Jul 07', card:'••6640', driver:'R. Kim', gallons:'88.7', amount:'$302.10' },
  ] as const;

export const WEXRESULTS = [
    { company:'RICS Logistics', appId:'872228', contact:'Richard Crossan', status:'Docs Pending', group:'In Progress' },
    { company:'RICS Freight East', appId:'872914', contact:'Richard Crossan', status:'Approved', group:'Complete' },
  ] as const;

export const LIMITTYPES = ['Per-transaction $', 'Daily $', 'Daily gallons', 'Transactions / day'] as const;

export const DASHTABS = [
    { id:'sales', label:'Sales' },
    { id:'invoices', label:'Invoices', badge:'3' },
    { id:'transactions', label:'Transactions' },
    { id:'cards', label:'Cards' },
  ] as const;

export const DASHACT = [
    { m:'Jun 30', tx:640 },{ m:'Jul 01', tx:720 },{ m:'Jul 02', tx:690 },{ m:'Jul 03', tx:810 },
    { m:'Jul 04', tx:520 },{ m:'Jul 05', tx:470 },{ m:'Jul 06', tx:560 },{ m:'Jul 07', tx:880 },
    { m:'Jul 08', tx:960 },{ m:'Jul 09', tx:1040 },
  ] as const;

export const APPSTAGES = [
    { stage:'New', count:6, col:'var(--accent)' },{ stage:'Docs Pending', count:4, col:'var(--warn)' },
    { stage:'Underwriting', count:3, col:'var(--violet)' },{ stage:'Approved', count:9, col:'var(--ok)' },
  ] as const;

export const MONEYCODES = [
    { code:'8842-1190-3357', carrier:'RICS Logistics', amount:'$500', issued:'Today, 9:12 AM', status:'Active' },
    { code:'2201-8874-9910', carrier:'Coastal Haul Co.', amount:'$350', issued:'Yesterday', status:'Redeemed' },
    { code:'5567-3320-1148', carrier:'Meridian Transport', amount:'$800', issued:'Jul 07', status:'Expired' },
  ] as const;

export const TICKETS = [
    { id:'t1', num:'48120', subject:'Card ••4471 declined — driver stranded', company:'RICS Logistics', channel:'Customer Service', dept:'Customer Service', targetDept:'', contact:'Richard Crossan', agent:'Marcus Reyes', priority:'High', status:'Open', ticketType:'Card Issue', carrierId:'CR-10428', description:'Driver had card ••4471 declined three times in Newark, NJ and is stranded at the pump. Card auto-held after repeated declines. Needs urgent review and a possible override.', ageHrs:0.5, unread:2, escalated:false, overdue:false },
    { id:'t2', num:'48098', subject:'Invoice dispute — May statement double charge', company:'Coastal Haul Co.', channel:'Billing', dept:'Billing', targetDept:'', contact:'Marta Nunez', agent:'Marcus Reyes', priority:'Normal', status:'On Hold', ticketType:'Billing Dispute', carrierId:'CR-09982', description:'Customer was billed twice for the May 17 delivery. Awaiting a credit confirmation from finance before closing the ticket.', ageHrs:26, unread:1, escalated:false, overdue:false },
    { id:'t3', num:'47990', subject:'DOT re-verification before card ship', company:'Meridian Transport', channel:'Verification', dept:'Verification', targetDept:'', contact:'Priya Anand', agent:'Dana Whitfield', priority:'Low', status:'Stream Manager Review', ticketType:'Verification', carrierId:'CR-10055', description:'DOT #334021 requires re-verification with FMCSA before the new cards can be shipped to the carrier.', ageHrs:52, unread:0, escalated:false, overdue:false },
    { id:'t4', num:'47955', subject:'Escalation — credit line increase approval', company:'', channel:'Escalation', dept:'Finance', targetDept:'Head of Finance', contact:'Owen Park', agent:'Finance Team', priority:'High', status:'Head of Department Review', ticketType:'Credit Request', carrierId:'CR-11204', description:'Summit Carriers requested a credit line increase from \$20k to \$45k. Escalated to the Head of Finance for approval.', ageHrs:80, unread:1, escalated:true, overdue:true },
    { id:'t5', num:'47881', subject:'Replacement cards — new warehouse address', company:'Blue Ridge Freight', channel:'Customer Service', dept:'Customer Service', targetDept:'', contact:'Dana Whitfield', agent:'Marcus Reyes', priority:'Normal', status:'Resolved', ticketType:'Card Request', carrierId:'CR-10771', description:'Customer moved warehouses and needs replacement cards shipped to the new address.', ageHrs:120, unread:0, escalated:false, overdue:false },
    { id:'t6', num:'47720', subject:'Money code request — stranded driver', company:'Delta Freight LLC', channel:'Customer Service', dept:'Customer Service', targetDept:'', contact:'Sam Okafor', agent:'Marcus Reyes', priority:'Normal', status:'Closed', ticketType:'Money Code', carrierId:'CR-11890', description:'Emergency EFS money code requested for a stranded driver. Issued and redeemed successfully.', ageHrs:200, unread:0, escalated:false, overdue:false },
  ] as const;

export const TICKET_MSGS = {
    t1:[
      { from:'Richard Crossan', type:'comment', text:'Hi — one of our drivers just had his card declined three times in Newark. He is stuck at the pump. Can you check what happened?', time:'9:04 AM' },
      { from:'me', type:'comment', text:'Thanks Richard. I can see card ••4471 was auto-held after 3 declined swipes. The pattern matches your usual route, so it looks legitimate — I can grant a 30-minute override right now.', time:'9:07 AM' },
      { from:'Richard Crossan', type:'attachment', file:{ name:'pump-receipt-newark.jpg', size:'248 KB' }, time:'9:08 AM' },
      { from:'Richard Crossan', type:'comment', text:'Yes please, go ahead. He needs to get back on the road.', time:'9:09 AM' },
      { from:'me', type:'comment', text:'Done — the card is active for the next 30 minutes and I have flagged the hold for review. He should be able to fuel now. I will follow up once the review clears.', time:'9:11 AM' },
    ],
    t2:[
      { from:'Marta Nunez', type:'comment', text:'We were billed twice for the May 17 delivery on our statement. Can you take a look?', time:'Yesterday' },
      { from:'me', type:'comment', text:'Looking into it now — pulling invoice WD-47810. Give me a couple of minutes.', time:'Yesterday' },
      { from:'Marta Nunez', type:'attachment', file:{ name:'may-statement.pdf', size:'1.2 MB' }, time:'Yesterday' },
      { from:'me', type:'comment', text:'Confirmed there was a duplicate line. I have requested a \$9,102.88 credit; it will show on your next statement. Holding this open until finance confirms.', time:'Yesterday' },
    ],
    t3:[
      { from:'Priya Anand', type:'comment', text:'Our DOT number needs re-verification before the new cards ship. What do you need from us?', time:'3h ago' },
      { from:'me', type:'comment', text:'Just a moment while I re-run FMCSA verification on DOT 334021. This is with the stream manager for review.', time:'3h ago' },
    ],
    t4:[
      { from:'Owen Park', type:'comment', text:'We would like to raise our credit line to support the new fleet. Current \$20k is not enough for the expansion.', time:'3d ago' },
      { from:'me', type:'comment', text:'Understood. I have escalated the request to the Head of Finance for approval — I will update you as soon as I hear back.', time:'3d ago' },
      { from:'Finance Team', type:'comment', text:'Reviewing the account history and payment record now. Will have a decision within 24 hours.', time:'2d ago' },
    ],
    t5:[
      { from:'Dana Whitfield', type:'comment', text:'We moved warehouses — can you ship the replacement cards to the new address?', time:'Jul 08' },
      { from:'me', type:'comment', text:'All set — cards are shipping to the updated address. Tracking will arrive by email. Marking this resolved; reopen anytime.', time:'Jul 08' },
    ],
    t6:[
      { from:'Sam Okafor', type:'comment', text:'One of our drivers is stranded and needs an emergency money code.', time:'Jul 03' },
      { from:'me', type:'comment', text:'Issued money code 8842-1190-3357 for \$500. It expires in 24 hours. Closing this out.', time:'Jul 03' },
    ],
  } as const;

export const DEALPOOL = [
    { dealId:'p1', carrierId:'CR-88213', company:'Ironline Carriers', fullName:'Devon Marsh', approvalStatus:'N/A', lastTransaction:'2026-07-02', inactivityReason:'No swipes in 12 days', numberOfCards:'8', status:'Inactive', comments:'Left voicemail 7/9', owner:'' },
    { dealId:'p2', carrierId:'CR-88109', company:'Nova Freightways', fullName:'Alicia Bloom', approvalStatus:'Initial', lastTransaction:'2026-06-28', inactivityReason:'Card expired, not renewed', numberOfCards:'3', status:'Pending', comments:'N/A', owner:'' },
    { dealId:'p3', carrierId:'CR-87740', company:'Granite Peak Trucking', fullName:'Marcus Vaughn', approvalStatus:'Approved', lastTransaction:'2026-07-05', inactivityReason:'N/A', numberOfCards:'15', status:'Assigned to Agent', comments:'Claimed after 3 calls', owner:'Dana Whitfield' },
    { dealId:'p4', carrierId:'CR-87655', company:'Coastal Haul Co.', fullName:'Marta Nunez', approvalStatus:'Rejected', lastTransaction:'2026-06-15', inactivityReason:'Balance overdue 30+ days', numberOfCards:'6', status:'Out of Reach', comments:'Debtor flag — on hold', owner:'' },
    { dealId:'p5', carrierId:'CR-87401', company:'Redwood Logistics', fullName:'Owen Park', approvalStatus:'N/A', lastTransaction:'2026-07-08', inactivityReason:'N/A', numberOfCards:'11', status:'Active', comments:'Interested in expansion', owner:'' },
    { dealId:'p6', carrierId:'CR-87220', company:'Blue Ridge Freight', fullName:'Dana Whitfield', approvalStatus:'N/A', lastTransaction:'2026-06-30', inactivityReason:'Slowed volume, 9 days quiet', numberOfCards:'4', status:'Inactive', comments:'N/A', owner:'' },
    { dealId:'p7', carrierId:'CR-86998', company:'Summit Carriers', fullName:'Priya Anand', approvalStatus:'Pending', lastTransaction:'2026-07-01', inactivityReason:'Awaiting DOT re-verify', numberOfCards:'7', status:'Pending', comments:'Verification in progress', owner:'' },
    { dealId:'p8', carrierId:'CR-86770', company:'Meridian Transport', fullName:'Sam Okafor', approvalStatus:'N/A', lastTransaction:'2026-07-06', inactivityReason:'N/A', numberOfCards:'20', status:'Active', comments:'High potential', owner:'' },
    { dealId:'p9', carrierId:'CR-86540', company:'Delta Freight LLC', fullName:'Rachel Kim', approvalStatus:'Approved', lastTransaction:'2026-07-04', inactivityReason:'N/A', numberOfCards:'9', status:'Assigned to Agent', comments:'N/A', owner:'Marcus Reyes' },
    { dealId:'p10', carrierId:'CR-86310', company:'Overland Express', fullName:'Tobias Reed', approvalStatus:'N/A', lastTransaction:'2026-05-29', inactivityReason:'No swipes in 40+ days', numberOfCards:'2', status:'Out of Reach', comments:'No answer x4', owner:'' },
    { dealId:'p11', carrierId:'CR-86055', company:'Pinnacle Hauling', fullName:'Grace Liu', approvalStatus:'Rejected', lastTransaction:'2026-06-20', inactivityReason:'Requested no contact', numberOfCards:'5', status:'Inactive', comments:'Do not re-engage', owner:'' },
  ] as const;
