export const stores = [
  { code: 'STR001', name: 'Lots Wholesale - Andheri' },
  { code: 'STR002', name: 'Lots Wholesale - Borivali' },
  { code: 'STR003', name: 'Lots Wholesale - Thane' },
  { code: 'STR004', name: 'Lots Wholesale - Pune' },
  { code: 'STR005', name: 'Lots Wholesale - Nashik' },
];

export const registeredMembers = [
  { employeeCode: 'EMP001', name: 'Rajesh Kumar',  contactNumber: '9876543210', storeCode: 'STR001' },
  { employeeCode: 'EMP002', name: 'Priya Sharma',  contactNumber: '9876543211', storeCode: 'STR001' },
  { employeeCode: 'EMP003', name: 'Amit Patel',    contactNumber: '9876543212', storeCode: 'STR002' },
  { employeeCode: 'EMP004', name: 'Sunita Rao',    contactNumber: '9876543213', storeCode: 'STR003' },
  { employeeCode: 'EMP005', name: 'Vikram Singh',  contactNumber: '9876543214', storeCode: 'STR004' },
];

export const products = [
  { id: 'P001', name: 'AC Unit',               vendorName: 'Cool Tech Services',  outOfScope: false },
  { id: 'P002', name: 'Lift / Elevator',        vendorName: 'Otis Elevators',      outOfScope: false },
  { id: 'P003', name: 'Generator / Genset',     vendorName: 'Kirloskar Power',     outOfScope: false },
  { id: 'P004', name: 'Sensormatic System',     vendorName: 'Tyco Security',       outOfScope: false },
  { id: 'P005', name: 'Electrical Works',       vendorName: '',                    outOfScope: false },
  { id: 'P006', name: 'Fire Safety Equipment',  vendorName: 'Minimax Fire',        outOfScope: false },
  { id: 'P007', name: 'CCTV System',            vendorName: 'Hikvision Services',  outOfScope: false },
  { id: 'P008', name: 'UPS / Inverter',         vendorName: '',                    outOfScope: true  },
  { id: 'P009', name: 'Printer / IT Equipment', vendorName: '',                    outOfScope: true  },
  { id: 'P010', name: 'Sealing Machine',        vendorName: '',                    outOfScope: true  },
];

export const natureOfComplaintOptions = [
  { id: 'N001', label: 'Not Maintaining Proper Temperature',       type: 'Breakdown',    tatDays: 1  },
  { id: 'N002', label: 'Not Working',                              type: 'Breakdown',    tatDays: 1  },
  { id: 'N003', label: 'Part Not Working',                         type: 'Repair',       tatDays: 2  },
  { id: 'N004', label: 'Repair Required',                          type: 'Repair',       tatDays: 2  },
  { id: 'N005', label: 'Servicing / Maintenance Required',         type: 'Maintenance',  tatDays: 3  },
  { id: 'N006', label: 'Requirement / Installation / Replacement', type: 'Requirement',  tatDays: 10 },
];
