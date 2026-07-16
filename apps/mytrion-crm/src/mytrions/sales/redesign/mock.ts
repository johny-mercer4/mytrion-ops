/* Sales Mytrion redesign — the ONLY remaining fixture.
   Every other tab is wired to live touchpoints/Desk/WS; the Open Pool tab intentionally stays on
   this seed because its live data flow is being rebuilt separately (per product decision). When
   Pool is wired, delete this file and its import in PoolTab.tsx. */
/* eslint-disable */

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
