// Fallback delay reasons — used until the API/sheet responds.
// Same set used by FollowUp; labels match the Google Sheet (VMM Master Data → Delay Reason).
export const FALLBACK_DELAY_REASONS = {
  'Delay From Vendor Side': [
    { label: 'Quotation / Field Service Report not received from vendor', tat: 1 },
    { label: 'Material or Parts Not Available',                           tat: 3 },
    { label: 'Under Transit',                                             tat: 3 },
    { label: 'Work in progress',                                          tat: 1 },
    { label: 'Vendor Is Not Responding',                                  tat: 1 },
    { label: 'Vendor Visit Pending',                                      tat: 2 },
  ],
  'Delay From HO Team': [
    { label: 'Quotation Approval Pending',  tat: 1    },
    { label: 'Delay In Release Of PO',      tat: 2    },
    { label: 'Delay Due To Landlord',       tat: 15   },
    { label: 'Delay Due To Lapse Of AMC',   tat: 3    },
    { label: 'Vendor details not provided', tat: 2    },
    { label: 'Payment under process',       tat: null },
    { label: 'Vendor Has Payment Issues',   tat: 2    },
    { label: 'Under Transit',               tat: 3    },
    { label: 'Material To Be Dispatched',   tat: 2    },
  ],
  'Work Is Delayed Due To FM': [
    { label: 'Local vendor or Quotation is being arranged', tat: 2 },
    { label: 'Site inspection pending',                     tat: 2 },
    { label: 'Facility Manager is not responding',          tat: 1 },
  ],
  'Delay From Store': [
    { label: 'Store has rescheduled the work', tat: 3 },
    { label: 'Product under observation',      tat: 1 },
    { label: 'Store is not responding',        tat: 1 },
  ],
};