CREATE TABLE IF NOT EXISTS service_invoice_configs (
  id CHAR(36) PRIMARY KEY,
  service_code VARCHAR(50) NOT NULL UNIQUE,
  service_name VARCHAR(100) NOT NULL,
  template_style ENUM('STANDARD_TAX','ITEMIZED_SERVICE','PAYOUT_DISBURSAL','BANKING_CORRESPONDENT','UTILITY_BILL_RECEIPT','REMITTANCE_COMMISSION','COMPACT_RECEIPT') NOT NULL DEFAULT 'STANDARD_TAX',
  template_name VARCHAR(120) NOT NULL,
  business_name VARCHAR(160) NOT NULL,
  legal_name VARCHAR(200) NOT NULL,
  gstin VARCHAR(20) NOT NULL,
  pan VARCHAR(20) NOT NULL,
  sac_code VARCHAR(20) NOT NULL DEFAULT '998311',
  email VARCHAR(254) NOT NULL,
  mobile VARCHAR(20) NOT NULL,
  address TEXT NOT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  pincode VARCHAR(20) NOT NULL,
  beneficiary_name VARCHAR(160) NOT NULL,
  bank_name VARCHAR(120) NOT NULL,
  account_number VARCHAR(50) NOT NULL,
  ifsc_code VARCHAR(20) NOT NULL,
  branch_name VARCHAR(120) NOT NULL,
  primary_color VARCHAR(20) NOT NULL DEFAULT '#0f172a',
  logo_url VARCHAR(500) NULL,
  terms_and_conditions TEXT NOT NULL,
  footer_declaration TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

INSERT INTO service_invoice_configs (
  id, service_code, service_name, template_style, template_name, business_name, legal_name, gstin, pan, sac_code, email, mobile, address, city, state, pincode, beneficiary_name, bank_name, account_number, ifsc_code, branch_name, primary_color, terms_and_conditions, footer_declaration, is_active
) VALUES
('SIC_PAYIN_01', 'PAY_IN', 'Pay-In Collection Service', 'ITEMIZED_SERVICE', 'Pay-In Gateway Collection Fee Layout', 'Qin Star Pay (Pay-In Services Unit)', 'Qin Star Payment Services Pvt Ltd - PayIn Division', '36AAACQ9981P1Z1', 'AAACQ9981P', '998311', 'payin-billing@qinstarpay.com', '+91 9876543210', 'Financial District, Nanakramguda', 'Hyderabad', 'Telangana', '500032', 'Qin Star Pay - PayIn Nodal Account', 'ICICI Bank Ltd', '000405012938', 'ICIC0000004', 'Gachibowli Branch', '#0284c7', '1. Pay-In merchant MDR and collection fees are subject to 18% GST.\n2. Settlements governed by RBI Nodal guidelines.', 'Authorized tax invoice for Pay-In Payment Collection Services.', TRUE),
('SIC_PAYOUT_02', 'PAY_OUT', 'Pay-Out Disbursal Service', 'PAYOUT_DISBURSAL', 'Pay-Out Instant Disbursal & Charge Layout', 'Qin Star Pay (Pay-Out Operations)', 'Qin Star Payment Services Pvt Ltd - Disbursal Unit', '36AAACQ9981P1Z2', 'AAACQ9981P', '998312', 'payout-billing@qinstarpay.com', '+91 9876543211', 'Hitec City Phase 2, Madhapur', 'Hyderabad', 'Telangana', '500081', 'Qin Star Pay - Payout Escrow Account', 'HDFC Bank Ltd', '50200012345678', 'HDFC0000123', 'Hitec City Branch', '#4f46e5', '1. Includes IMPS, NEFT, RTGS, and UPI instant payout charges.\n2. Invoice generated under GST SAC 998312.', 'Digitally verified Tax Invoice for Payout & Money Disbursal Services.', TRUE),
('SIC_AEPS_03', 'AEPS', 'AEPS & MicroATM Service', 'BANKING_CORRESPONDENT', 'Aadhaar Banking & Cash Agent Layout', 'Qin Star Pay (AEPS Banking Unit)', 'Qin Star Financial Inclusion Technologies Ltd', '36AAACQ9981P1Z3', 'AAACQ9981P', '998313', 'aeps-support@qinstarpay.com', '+91 9876543212', 'Koramangala 4th Block', 'Bengaluru', 'Karnataka', '560034', 'Qin Star Pay - Business Correspondent Escrow', 'State Bank of India', '38291029384', 'SBIN0009981', 'Koramangala Main Branch', '#059669', '1. Covers AEPS Cash Withdrawal, Balance Enquiry, and Mini Statement BC commissions.\n2. Verified against NPCI AEPS settlement logs.', 'Authorized Business Correspondent (BC) Tax Invoice for AEPS Services.', TRUE),
('SIC_BBPS_04', 'BBPS', 'BBPS Utility Bills Service', 'UTILITY_BILL_RECEIPT', 'Bharat Bill Pay Agent Fee Layout', 'Qin Star Pay (BBPS Utility Unit)', 'Qin Star Pay Utilities & Services Pvt Ltd', '36AAACQ9981P1Z4', 'AAACQ9981P', '998314', 'bbps-billing@qinstarpay.com', '+91 9876543213', 'Outer Ring Road, Devarabeesanahalli', 'Bengaluru', 'Karnataka', '560103', 'Qin Star Pay - BBPS Settlement Escrow', 'YES Bank Ltd', '0123987654321', 'YESB0000123', 'ORR Branch', '#d97706', '1. Covers Electricity, Water, Gas, Fastag, and Broadband bill payment processing fees.\n2. Statutory 18% GST applied.', 'Bharat BillPay (BBPS) Agent Operating Unit Tax Receipt.', TRUE),
('SIC_DMT_05', 'DMT', 'DMT Domestic Money Transfer', 'REMITTANCE_COMMISSION', 'Domestic Money Transfer Remittance Layout', 'Qin Star Pay (DMT Remittance Node)', 'Qin Star Payment Services Pvt Ltd', '36AAACQ9981P1Z5', 'AAACQ9981P', '998315', 'dmt-billing@qinstarpay.com', '+91 9876543214', 'Indiranagar 100ft Road', 'Bengaluru', 'Karnataka', '560038', 'Qin Star Pay - DMT Remittance Account', 'Axis Bank Ltd', '9180200123456', 'UTIB0000456', 'Indiranagar Branch', '#e11d48', '1. Domestic Money Transfer charges subject to RBI remittance limits per customer.\n2. Computer-generated tax document.', 'DMT Domestic Money Remittance Tax Invoice.', TRUE),
('SIC_RECHARGE_06', 'RECHARGE', 'Mobile & DTH Recharge Service', 'COMPACT_RECEIPT', 'Telecom Recharge & Bill Pay Layout', 'Qin Star Pay (Telecom Recharge Unit)', 'Qin Star Pay Digital Services Pvt Ltd', '36AAACQ9981P1Z6', 'AAACQ9981P', '998316', 'recharge-billing@qinstarpay.com', '+91 9876543215', 'Sector 62, Institutional Area', 'Noida', 'Uttar Pradesh', '201309', 'Qin Star Pay - Recharge Operating Account', 'Kotak Mahindra Bank', '6712398712', 'KKBK0000123', 'Noida Branch', '#0891b2', '1. Covers Prepaid Mobile, DTH, and Data Card recharge commission processing.\n2. All recharges credited instantly upon operator confirmation.', 'Telecom & DTH Recharge Service Tax Receipt.', TRUE),
('SIC_DEFAULT_00', 'DEFAULT', 'Qin Star Pay Platform Default', 'STANDARD_TAX', 'Platform Standard GST Tax Invoice', 'Qin Star Pay Main Platform', 'Qin Star Pay Technologies Pvt Ltd', '36QSPAY9981P1Z0', 'QSPAY9981P', '998311', 'billing@qinstarpay.com', '+91 1800 123 4567', 'Plot 42, Hitec City Phase 2', 'Hyderabad', 'Telangana', '500081', 'Qin Star Pay Operations Nodal Account', 'State Bank of India', '38291029384', 'SBIN0009981', 'Hitec City Branch', '#0f172a', '1. All invoices are payable within 15 days of issuance.\n2. Subject to Hyderabad Jurisdiction.', 'Platform Default Service Tax Invoice.', TRUE)
ON DUPLICATE KEY UPDATE service_name = VALUES(service_name), is_active = TRUE;
