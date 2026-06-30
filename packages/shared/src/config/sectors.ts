/**
 * Sector definitions for multi-vertical CRM.
 *
 * Each sector declares:
 *  - id          : machine key stored in tenants.sector
 *  - label       : display name
 *  - icon        : emoji for quick identification
 *  - description : shown on the registration picker
 *  - color       : brand accent for the sector badge
 *  - contactLabel: what "contacts" are called in this sector
 *  - fields      : default custom fields seeded into custom_field_definitions on signup
 *
 * Field types: text | email | phone | number | date | select | textarea | boolean
 */

export type FieldType = 'text' | 'email' | 'phone' | 'number' | 'date' | 'select' | 'textarea' | 'boolean';

export interface SectorField {
  name: string;           // machine key → stored in custom_fields JSONB
  label: string;          // shown in the form
  field_type: FieldType;
  is_required: boolean;
  sort_order: number;
  options?: string[];     // for select fields
  placeholder?: string;
  group?: string;         // visual grouping within the form
}

export interface SlaDefault {
  priority: 'urgent' | 'high' | 'medium' | 'low';
  name: string;
  description: string;
  first_response_hours: number;
  resolution_hours: number;
  business_hours_only: boolean;
}

export interface SectorConfig {
  id: string;
  label: string;
  icon: string;
  description: string;
  color: string;
  bg: string;
  contactLabel: string;
  contactLabelPlural: string;
  ticketLabel: string;
  companyLabel: string;       // e.g. "Bank", "Insurer", "Carrier"
  dealLabel: string;          // e.g. "Loan", "Policy", "Order"
  departments: string[];
  fields: SectorField[];        // contact fields (existing — keep for back-compat)
  companyFields: SectorField[]; // company-specific fields
  dealFields: SectorField[];    // deal / opportunity fields
  ticketFields: SectorField[];  // ticket / case fields
  slaDefaults: SlaDefault[];    // sector-tuned SLA timings
}

// ── Common field shared by every sector ────────────────────────────────────
const CUSTOMER_TYPE_FIELD: SectorField = {
  name:       'customer_type',
  label:      'Customer Type',
  field_type: 'select',
  is_required: true,
  sort_order: 0,
  options:    ['Individual', 'Company Employee', 'Corporate', 'SME', 'Government'],
  group:      'Identity',
};

// ══════════════════════════════════════════════════════════════════════════
// SECTOR DEFINITIONS
// ══════════════════════════════════════════════════════════════════════════
export const SECTORS: SectorConfig[] = [

  // ── 1. Banking ───────────────────────────────────────────────────────
  {
    id:                 'banking',
    label:              'Banking',
    icon:               '🏦',
    description:        'Retail & corporate banking, loans, accounts, and financial services',
    color:              '#1d4ed8',
    bg:                 '#eff6ff',
    contactLabel:       'Account Holder',
    contactLabelPlural: 'Account Holders',
    ticketLabel:        'Case',
    companyLabel:       'Bank / Financial Institution',
    dealLabel:          'Loan / Product',
    departments:        ['Retail Banking', 'Loans', 'Cards', 'Customer Support', 'Compliance'],
    slaDefaults: [
      { priority: 'urgent', name: 'Urgent — Fraud & Security',      description: 'Fraud alerts, blocked accounts, security breaches. 24/7.', first_response_hours: 1,  resolution_hours: 4,   business_hours_only: false },
      { priority: 'high',   name: 'High — Dispute & Card Issues',   description: 'Card disputes, failed payments, loan anomalies.',           first_response_hours: 2,  resolution_hours: 8,   business_hours_only: true  },
      { priority: 'medium', name: 'Medium — Account Service',       description: 'Account queries, statement requests, general service.',      first_response_hours: 8,  resolution_hours: 24,  business_hours_only: true  },
      { priority: 'low',    name: 'Low — Info & Balance Queries',   description: 'Balance checks, product enquiries, branch info.',           first_response_hours: 24, resolution_hours: 72,  business_hours_only: true  },
    ],
    companyFields: [
      { name: 'banking_license_no',   label: 'Banking License Number',    field_type: 'text',   is_required: false, sort_order: 1, group: 'Regulatory' },
      { name: 'central_bank_code',    label: 'Central Bank / BIC Code',   field_type: 'text',   is_required: false, sort_order: 2, group: 'Regulatory' },
      { name: 'aml_risk_category',    label: 'AML Risk Category',         field_type: 'select', is_required: false, sort_order: 3, group: 'Compliance', options: ['Low', 'Medium', 'High', 'Sanctioned'] },
      { name: 'institution_type',     label: 'Institution Type',          field_type: 'select', is_required: false, sort_order: 4, group: 'Identity',   options: ['Commercial Bank', 'Islamic Bank', 'Investment Bank', 'Microfinance', 'NBFC', 'Credit Union', 'Other'] },
      { name: 'correspondent_bank',   label: 'Correspondent Bank',        field_type: 'text',   is_required: false, sort_order: 5, group: 'Network' },
      { name: 'credit_rating',        label: 'Credit Rating',             field_type: 'text',   is_required: false, sort_order: 6, group: 'Financial',  placeholder: 'e.g. AA+, BBB' },
      { name: 'total_assets_usd',     label: 'Total Assets (USD mn)',     field_type: 'number', is_required: false, sort_order: 7, group: 'Financial' },
    ],
    dealFields: [
      { name: 'loan_type',            label: 'Loan / Product Type',       field_type: 'select', is_required: true,  sort_order: 1, group: 'Product',    options: ['Personal Loan', 'Home Loan', 'Auto Loan', 'Business Loan', 'Credit Card', 'Overdraft', 'Trade Finance', 'Fixed Deposit', 'Other'] },
      { name: 'loan_amount',          label: 'Applied Amount',            field_type: 'number', is_required: true,  sort_order: 2, group: 'Financials' },
      { name: 'sanctioned_amount',    label: 'Sanctioned Amount',         field_type: 'number', is_required: false, sort_order: 3, group: 'Financials' },
      { name: 'interest_rate_pct',    label: 'Interest Rate (%)',         field_type: 'number', is_required: false, sort_order: 4, group: 'Financials' },
      { name: 'tenure_months',        label: 'Tenure (months)',           field_type: 'number', is_required: false, sort_order: 5, group: 'Terms' },
      { name: 'collateral_type',      label: 'Collateral / Security',     field_type: 'select', is_required: false, sort_order: 6, group: 'Terms',      options: ['None', 'Property', 'Vehicle', 'Stocks', 'FD', 'Guarantor', 'Other'] },
      { name: 'ltv_ratio',            label: 'LTV Ratio (%)',             field_type: 'number', is_required: false, sort_order: 7, group: 'Financials' },
      { name: 'processing_fee',       label: 'Processing Fee',            field_type: 'number', is_required: false, sort_order: 8, group: 'Financials' },
      { name: 'disbursement_date',    label: 'Disbursement Date',         field_type: 'date',   is_required: false, sort_order: 9, group: 'Terms' },
      { name: 'emi_amount',           label: 'EMI / Monthly Repayment',   field_type: 'number', is_required: false, sort_order: 10, group: 'Financials' },
    ],
    ticketFields: [
      { name: 'case_type',            label: 'Case Type',                 field_type: 'select', is_required: true,  sort_order: 1, group: 'Case Details', options: ['Fraud Alert', 'Dispute', 'Account Block', 'Loan Query', 'Card Issue', 'KYC', 'Statement Request', 'Complaint', 'Other'] },
      { name: 'transaction_ref',      label: 'Transaction Reference',     field_type: 'text',   is_required: false, sort_order: 2, group: 'Case Details' },
      { name: 'amount_involved',      label: 'Amount Involved',           field_type: 'number', is_required: false, sort_order: 3, group: 'Case Details' },
      { name: 'regulatory_deadline',  label: 'Regulatory Deadline',       field_type: 'date',   is_required: false, sort_order: 4, group: 'Compliance' },
      { name: 'cb_reference',         label: 'Central Bank Ref #',        field_type: 'text',   is_required: false, sort_order: 5, group: 'Compliance' },
    ],
    fields: [
      CUSTOMER_TYPE_FIELD,
      { name: 'account_number',    label: 'Account Number',     field_type: 'text',   is_required: true,  sort_order: 1, group: 'Account Details', placeholder: 'e.g. 0012345678' },
      { name: 'account_type',      label: 'Account Type',       field_type: 'select', is_required: true,  sort_order: 2, group: 'Account Details', options: ['Savings', 'Current', 'Fixed Deposit', 'Loan', 'Credit Card', 'Demat'] },
      { name: 'branch_name',       label: 'Branch Name',        field_type: 'text',   is_required: false, sort_order: 3, group: 'Account Details', placeholder: 'e.g. Main Street Branch' },
      { name: 'ifsc_swift_code',   label: 'IFSC / SWIFT Code',  field_type: 'text',   is_required: false, sort_order: 4, group: 'Account Details', placeholder: 'e.g. HDFC0001234' },
      { name: 'relationship_manager', label: 'Relationship Manager', field_type: 'text', is_required: false, sort_order: 5, group: 'Account Details' },
      { name: 'kyc_status',        label: 'KYC Status',         field_type: 'select', is_required: false, sort_order: 6, group: 'Compliance', options: ['Pending', 'Submitted', 'Verified', 'Rejected', 'Expired'] },
      { name: 'customer_since',    label: 'Customer Since',     field_type: 'date',   is_required: false, sort_order: 7, group: 'Account Details' },
      { name: 'preferred_contact', label: 'Preferred Contact',  field_type: 'select', is_required: false, sort_order: 8, group: 'Preferences', options: ['Phone', 'Email', 'Branch', 'App', 'SMS'] },
      { name: 'national_id',       label: 'National ID / PAN',  field_type: 'text',   is_required: false, sort_order: 9, group: 'Identity', placeholder: 'Government-issued ID' },
    ],
  },

  // ── 2. Telecom ───────────────────────────────────────────────────────
  {
    id:                 'telecom',
    label:              'Telecom',
    icon:               '📡',
    description:        'Mobile, broadband, TV, and enterprise telecom services',
    color:              '#7c3aed',
    bg:                 '#f5f3ff',
    contactLabel:       'Subscriber',
    contactLabelPlural: 'Subscribers',
    ticketLabel:        'Trouble Ticket',
    companyLabel:       'Telecom Operator',
    dealLabel:          'Service Contract',
    departments:        ['Mobile Services', 'Broadband', 'Enterprise', 'Technical Support', 'Billing'],
    slaDefaults: [
      { priority: 'urgent', name: 'Urgent — Network / Outage',       description: 'Total service loss, network outages, major faults. 24/7.',  first_response_hours: 1,  resolution_hours: 4,   business_hours_only: false },
      { priority: 'high',   name: 'High — Service Degradation',      description: 'Slow speeds, partial outage, billing dispute.',             first_response_hours: 2,  resolution_hours: 8,   business_hours_only: true  },
      { priority: 'medium', name: 'Medium — Service Request',        description: 'Plan changes, SIM swap, roaming activation.',               first_response_hours: 4,  resolution_hours: 24,  business_hours_only: true  },
      { priority: 'low',    name: 'Low — General Inquiry',           description: 'Usage queries, plan comparison, coverage check.',           first_response_hours: 24, resolution_hours: 48,  business_hours_only: true  },
    ],
    companyFields: [
      { name: 'operator_license',     label: 'Operator License Number',   field_type: 'text',   is_required: false, sort_order: 1, group: 'Regulatory' },
      { name: 'regulator_name',       label: 'Regulatory Authority',      field_type: 'text',   is_required: false, sort_order: 2, group: 'Regulatory', placeholder: 'e.g. TRAI, Ofcom, FCC' },
      { name: 'spectrum_bands',       label: 'Spectrum Bands',            field_type: 'text',   is_required: false, sort_order: 3, group: 'Technical',  placeholder: 'e.g. 700MHz, 2.1GHz, 5G' },
      { name: 'coverage_zones',       label: 'Coverage Zones / Regions',  field_type: 'text',   is_required: false, sort_order: 4, group: 'Network' },
      { name: 'interconnect_code',    label: 'Interconnect / MNC Code',   field_type: 'text',   is_required: false, sort_order: 5, group: 'Technical' },
      { name: 'technology_type',      label: 'Network Technology',        field_type: 'select', is_required: false, sort_order: 6, group: 'Technical', options: ['2G', '3G', '4G LTE', '5G NSA', '5G SA', 'Fixed Wireless', 'Fibre'] },
      { name: 'subscriber_count',     label: 'Total Subscribers (000s)', field_type: 'number', is_required: false, sort_order: 7, group: 'Business' },
    ],
    dealFields: [
      { name: 'contract_type',        label: 'Contract Type',             field_type: 'select', is_required: true,  sort_order: 1, group: 'Contract', options: ['Monthly', '12-Month', '24-Month', 'Enterprise SLA', 'Wholesale', 'Roaming'] },
      { name: 'service_type',         label: 'Service Type',              field_type: 'select', is_required: true,  sort_order: 2, group: 'Contract', options: ['Mobile', 'Broadband', 'Fixed Line', 'TV', 'IoT', 'Enterprise Bundle'] },
      { name: 'mrc',                  label: 'Monthly Recurring Charge',  field_type: 'number', is_required: false, sort_order: 3, group: 'Commercial' },
      { name: 'bandwidth_mbps',       label: 'Committed Bandwidth (Mbps)',field_type: 'number', is_required: false, sort_order: 4, group: 'Technical' },
      { name: 'data_cap_gb',          label: 'Data Cap / Allowance (GB)', field_type: 'number', is_required: false, sort_order: 5, group: 'Technical' },
      { name: 'sla_uptime_pct',       label: 'Committed Uptime SLA (%)',  field_type: 'number', is_required: false, sort_order: 6, group: 'SLA', placeholder: 'e.g. 99.9' },
      { name: 'contract_start',       label: 'Contract Start Date',       field_type: 'date',   is_required: false, sort_order: 7, group: 'Contract' },
      { name: 'contract_end',         label: 'Contract End Date',         field_type: 'date',   is_required: false, sort_order: 8, group: 'Contract' },
    ],
    ticketFields: [
      { name: 'fault_type',           label: 'Fault / Issue Type',        field_type: 'select', is_required: true,  sort_order: 1, group: 'Fault Details', options: ['No Service', 'Slow Speed', 'Call Drop', 'Billing Error', 'SIM Issue', 'Roaming Problem', 'Coverage Gap', 'Device Fault', 'Other'] },
      { name: 'affected_service',     label: 'Affected Service',          field_type: 'select', is_required: false, sort_order: 2, group: 'Fault Details', options: ['Mobile Voice', 'Mobile Data', 'Broadband', 'TV', 'Fixed Line', 'SMS', 'Roaming'] },
      { name: 'fault_severity',       label: 'Severity',                  field_type: 'select', is_required: false, sort_order: 3, group: 'Fault Details', options: ['Critical', 'Major', 'Minor', 'Cosmetic'] },
      { name: 'fault_region',         label: 'Fault Location / Region',   field_type: 'text',   is_required: false, sort_order: 4, group: 'Fault Details' },
      { name: 'estimated_fix_time',   label: 'Estimated Resolution Time', field_type: 'text',   is_required: false, sort_order: 5, group: 'Resolution' },
      { name: 'root_cause',           label: 'Root Cause',                field_type: 'text',   is_required: false, sort_order: 6, group: 'Resolution' },
    ],
    fields: [
      CUSTOMER_TYPE_FIELD,
      { name: 'mobile_number',     label: 'Mobile / Service Number', field_type: 'phone',  is_required: true,  sort_order: 1, group: 'Service Details', placeholder: 'Primary service number' },
      { name: 'account_number',    label: 'Account Number',           field_type: 'text',   is_required: true,  sort_order: 2, group: 'Service Details' },
      { name: 'plan_type',         label: 'Plan Type',                field_type: 'select', is_required: true,  sort_order: 3, group: 'Service Details', options: ['Prepaid', 'Postpaid', 'Enterprise', 'Family', 'SIM Only'] },
      { name: 'service_type',      label: 'Service Type',             field_type: 'select', is_required: true,  sort_order: 4, group: 'Service Details', options: ['Mobile', 'Broadband', 'TV', 'Fixed Line', 'IoT', 'Enterprise'] },
      { name: 'sim_serial',        label: 'SIM Serial (ICCID)',       field_type: 'text',   is_required: false, sort_order: 5, group: 'Technical', placeholder: 'e.g. 8944501234567890' },
      { name: 'imei_number',       label: 'IMEI Number',              field_type: 'text',   is_required: false, sort_order: 6, group: 'Technical' },
      { name: 'data_usage_gb',     label: 'Monthly Data Usage (GB)',  field_type: 'number', is_required: false, sort_order: 7, group: 'Usage' },
      { name: 'contract_end_date', label: 'Contract End Date',        field_type: 'date',   is_required: false, sort_order: 8, group: 'Service Details' },
      { name: 'roaming_enabled',   label: 'Roaming Enabled',          field_type: 'boolean',is_required: false, sort_order: 9, group: 'Service Details' },
    ],
  },

  // ── 3. Public Transport ──────────────────────────────────────────────
  {
    id:                 'public_transport',
    label:              'Public Transport',
    icon:               '🚌',
    description:        'Bus, rail, metro, ferry, and aviation passenger services',
    color:              '#059669',
    bg:                 '#f0fdf4',
    contactLabel:       'Passenger',
    contactLabelPlural: 'Passengers',
    ticketLabel:        'Complaint',
    companyLabel:       'Transport Operator',
    dealLabel:          'Pass / Contract',
    departments:        ['Passenger Services', 'Operations', 'Ticketing', 'Lost & Found', 'Accessibility'],
    slaDefaults: [
      { priority: 'urgent', name: 'Urgent — Safety & Security',     description: 'Accidents, security threats, medical on vehicle. 24/7.',  first_response_hours: 1,  resolution_hours: 4,   business_hours_only: false },
      { priority: 'high',   name: 'High — Service Disruption',      description: 'Route cancellation, major delay, accessibility failure.', first_response_hours: 2,  resolution_hours: 8,   business_hours_only: false },
      { priority: 'medium', name: 'Medium — Service Complaint',     description: 'Staff conduct, cleanliness, minor delay, lost property.', first_response_hours: 8,  resolution_hours: 48,  business_hours_only: true  },
      { priority: 'low',    name: 'Low — General Feedback',         description: 'Suggestions, timetable queries, general information.',   first_response_hours: 24, resolution_hours: 72,  business_hours_only: true  },
    ],
    companyFields: [
      { name: 'operator_license',     label: 'Operator License',          field_type: 'text',   is_required: false, sort_order: 1, group: 'Regulatory' },
      { name: 'regulator',            label: 'Regulatory Authority',      field_type: 'text',   is_required: false, sort_order: 2, group: 'Regulatory' },
      { name: 'transport_modes',      label: 'Transport Modes Operated',  field_type: 'text',   is_required: false, sort_order: 3, group: 'Operations', placeholder: 'e.g. Bus, Rail, Metro' },
      { name: 'fleet_size',           label: 'Total Fleet Size',          field_type: 'number', is_required: false, sort_order: 4, group: 'Operations' },
      { name: 'route_network',        label: 'Route Network (km)',        field_type: 'number', is_required: false, sort_order: 5, group: 'Operations' },
      { name: 'daily_passengers',     label: 'Daily Passengers (avg)',    field_type: 'number', is_required: false, sort_order: 6, group: 'Operations' },
    ],
    dealFields: [
      { name: 'pass_type',            label: 'Pass / Contract Type',      field_type: 'select', is_required: true,  sort_order: 1, group: 'Pass Details', options: ['Daily Pass', 'Weekly Pass', 'Monthly Pass', 'Annual Pass', 'Concession Pass', 'Corporate Contract', 'Student Pass'] },
      { name: 'zones_covered',        label: 'Zones / Routes Covered',    field_type: 'text',   is_required: false, sort_order: 2, group: 'Pass Details' },
      { name: 'validity_period',      label: 'Validity Period',           field_type: 'text',   is_required: false, sort_order: 3, group: 'Pass Details', placeholder: 'e.g. 1 Jan 2025 – 31 Dec 2025' },
      { name: 'pass_value',           label: 'Pass Value / Contract Fee', field_type: 'number', is_required: false, sort_order: 4, group: 'Commercial' },
      { name: 'discount_category',    label: 'Discount Category',         field_type: 'select', is_required: false, sort_order: 5, group: 'Commercial', options: ['None', 'Student', 'Senior', 'Disabled', 'Corporate', 'Government'] },
      { name: 'number_of_passengers', label: 'Number of Beneficiaries',   field_type: 'number', is_required: false, sort_order: 6, group: 'Pass Details' },
    ],
    ticketFields: [
      { name: 'complaint_type',       label: 'Complaint Type',            field_type: 'select', is_required: true,  sort_order: 1, group: 'Complaint', options: ['Delay', 'Cancellation', 'Staff Conduct', 'Safety Concern', 'Lost Property', 'Accessibility', 'Overcharge', 'Cleanliness', 'Other'] },
      { name: 'route_affected',       label: 'Route / Line Affected',     field_type: 'text',   is_required: false, sort_order: 2, group: 'Complaint' },
      { name: 'vehicle_no',           label: 'Vehicle / Train Number',    field_type: 'text',   is_required: false, sort_order: 3, group: 'Complaint' },
      { name: 'incident_datetime',    label: 'Incident Date & Time',      field_type: 'text',   is_required: false, sort_order: 4, group: 'Complaint' },
      { name: 'compensation_claimed', label: 'Compensation Claimed',      field_type: 'boolean',is_required: false, sort_order: 5, group: 'Resolution' },
    ],
    fields: [
      CUSTOMER_TYPE_FIELD,
      { name: 'booking_reference',  label: 'Booking Reference #',    field_type: 'text',   is_required: true,  sort_order: 1, group: 'Journey Details', placeholder: 'e.g. BK-2024-00123' },
      { name: 'travel_mode',        label: 'Travel Mode',             field_type: 'select', is_required: true,  sort_order: 2, group: 'Journey Details', options: ['Bus', 'Train', 'Metro', 'Tram', 'Ferry', 'Airplane', 'Taxi / Ride-share'] },
      { name: 'traveling_from',     label: 'Traveling From',          field_type: 'text',   is_required: true,  sort_order: 3, group: 'Journey Details', placeholder: 'Origin station / city' },
      { name: 'traveling_to',       label: 'Traveling To',            field_type: 'text',   is_required: true,  sort_order: 4, group: 'Journey Details', placeholder: 'Destination station / city' },
      { name: 'date_of_travel',     label: 'Date of Travel',          field_type: 'date',   is_required: true,  sort_order: 5, group: 'Journey Details' },
      { name: 'vehicle_number',     label: 'Bus / Train / Flight No', field_type: 'text',   is_required: false, sort_order: 6, group: 'Journey Details', placeholder: 'e.g. TRN-204 / EK-501' },
      { name: 'seat_berth',         label: 'Seat / Berth / Class',    field_type: 'text',   is_required: false, sort_order: 7, group: 'Journey Details', placeholder: 'e.g. 14A / Sleeper' },
      { name: 'pnr_number',         label: 'PNR / Ticket Number',     field_type: 'text',   is_required: false, sort_order: 8, group: 'Journey Details' },
      { name: 'passenger_count',    label: 'Number of Passengers',    field_type: 'number', is_required: false, sort_order: 9, group: 'Journey Details' },
      { name: 'loyalty_card',       label: 'Loyalty Card / Pass No',  field_type: 'text',   is_required: false, sort_order: 10, group: 'Identity' },
      { name: 'accessibility_needs',label: 'Accessibility Requirements', field_type: 'textarea', is_required: false, sort_order: 11, group: 'Special Requirements', placeholder: 'Wheelchair, visual impairment, etc.' },
    ],
  },

  // ── 4. Logistics ─────────────────────────────────────────────────────
  {
    id:                 'logistics',
    label:              'Logistics',
    icon:               '🚚',
    description:        'Courier, freight, warehousing, and supply chain management',
    color:              '#d97706',
    bg:                 '#fffbeb',
    contactLabel:       'Shipper / Consignee',
    contactLabelPlural: 'Shippers & Consignees',
    ticketLabel:        'Dispute',
    companyLabel:       'Logistics Provider',
    dealLabel:          'Freight Contract',
    departments:        ['Customer Service', 'Operations', 'Customs & Compliance', 'Warehousing', 'Last Mile'],
    slaDefaults: [
      { priority: 'urgent', name: 'Urgent — Lost / Damaged Cargo',  description: 'Missing shipment, customs hold, perishables at risk. 24/7.', first_response_hours: 2,  resolution_hours: 8,   business_hours_only: false },
      { priority: 'high',   name: 'High — Delivery Exception',      description: 'Failed delivery, wrong address, delay beyond SLA.',           first_response_hours: 4,  resolution_hours: 24,  business_hours_only: true  },
      { priority: 'medium', name: 'Medium — Tracking Query',        description: 'Shipment status, ETA query, customs update.',                 first_response_hours: 8,  resolution_hours: 48,  business_hours_only: true  },
      { priority: 'low',    name: 'Low — Rate & Info Query',        description: 'Rate enquiry, booking support, general information.',         first_response_hours: 24, resolution_hours: 72,  business_hours_only: true  },
    ],
    companyFields: [
      { name: 'transport_license',    label: 'Transport / Freight License',field_type: 'text',  is_required: false, sort_order: 1, group: 'Regulatory' },
      { name: 'customs_broker_code',  label: 'Customs Broker Code',        field_type: 'text',  is_required: false, sort_order: 2, group: 'Regulatory' },
      { name: 'fleet_size',           label: 'Fleet Size (vehicles)',      field_type: 'number',is_required: false, sort_order: 3, group: 'Operations' },
      { name: 'warehouse_count',      label: 'Number of Warehouses',      field_type: 'number',is_required: false, sort_order: 4, group: 'Operations' },
      { name: 'service_lanes',        label: 'Key Service Lanes / Routes', field_type: 'text',  is_required: false, sort_order: 5, group: 'Operations' },
      { name: 'carrier_type',         label: 'Carrier Type',              field_type: 'select',is_required: false, sort_order: 6, group: 'Operations', options: ['Road', 'Air', 'Sea', 'Rail', 'Multi-modal'] },
      { name: 'iata_cass_code',       label: 'IATA / CASS Code',          field_type: 'text',  is_required: false, sort_order: 7, group: 'Regulatory' },
    ],
    dealFields: [
      { name: 'contract_type',        label: 'Contract Type',             field_type: 'select', is_required: true,  sort_order: 1, group: 'Contract', options: ['Spot Rate', 'Annual Contract', 'SLA-Based', '3PL', '4PL', 'Express', 'Economy'] },
      { name: 'volume_commitment',    label: 'Volume Commitment (kg/mo)', field_type: 'number', is_required: false, sort_order: 2, group: 'Commercial' },
      { name: 'base_rate',            label: 'Base Rate (per kg/CBM)',    field_type: 'number', is_required: false, sort_order: 3, group: 'Commercial' },
      { name: 'transit_sla_hours',    label: 'Transit SLA (hours)',       field_type: 'number', is_required: false, sort_order: 4, group: 'SLA' },
      { name: 'origin_hub',           label: 'Origin Hub',               field_type: 'text',   is_required: false, sort_order: 5, group: 'Route' },
      { name: 'destination_hub',      label: 'Destination Hub',          field_type: 'text',   is_required: false, sort_order: 6, group: 'Route' },
      { name: 'customs_handling',     label: 'Customs Handling Included', field_type: 'boolean',is_required: false, sort_order: 7, group: 'Services' },
      { name: 'insurance_included',   label: 'Cargo Insurance Included',  field_type: 'boolean',is_required: false, sort_order: 8, group: 'Services' },
    ],
    ticketFields: [
      { name: 'dispute_type',         label: 'Dispute / Issue Type',      field_type: 'select', is_required: true,  sort_order: 1, group: 'Dispute', options: ['Lost Shipment', 'Damaged Cargo', 'Wrong Delivery', 'Delay', 'Customs Hold', 'Billing Dispute', 'Short Delivery', 'Other'] },
      { name: 'shipment_ref',         label: 'Shipment / AWB Reference',  field_type: 'text',   is_required: false, sort_order: 2, group: 'Dispute' },
      { name: 'claim_amount',         label: 'Claim Amount (USD)',        field_type: 'number', is_required: false, sort_order: 3, group: 'Claim' },
      { name: 'cargo_insurer',        label: 'Cargo Insurer',             field_type: 'text',   is_required: false, sort_order: 4, group: 'Claim' },
      { name: 'insurance_claim_ref',  label: 'Insurance Claim Reference', field_type: 'text',   is_required: false, sort_order: 5, group: 'Claim' },
    ],
    fields: [
      CUSTOMER_TYPE_FIELD,
      { name: 'tracking_number',   label: 'Tracking / AWB Number',   field_type: 'text',   is_required: true,  sort_order: 1, group: 'Shipment Details', placeholder: 'e.g. TRK1234567890' },
      { name: 'shipment_type',     label: 'Shipment Type',            field_type: 'select', is_required: true,  sort_order: 2, group: 'Shipment Details', options: ['Document', 'Parcel', 'Pallet', 'Full Container', 'LCL', 'Bulk', 'Cold Chain'] },
      { name: 'origin_address',    label: 'Origin Address',           field_type: 'textarea',is_required: true, sort_order: 3, group: 'Shipment Details' },
      { name: 'destination_address',label: 'Destination Address',     field_type: 'textarea',is_required: true, sort_order: 4, group: 'Shipment Details' },
      { name: 'expected_delivery', label: 'Expected Delivery Date',   field_type: 'date',   is_required: false, sort_order: 5, group: 'Shipment Details' },
      { name: 'weight_kg',         label: 'Weight (kg)',              field_type: 'number', is_required: false, sort_order: 6, group: 'Cargo Details' },
      { name: 'dimensions_cm',     label: 'Dimensions (L×W×H cm)',    field_type: 'text',   is_required: false, sort_order: 7, group: 'Cargo Details', placeholder: 'e.g. 40×30×20' },
      { name: 'cargo_type',        label: 'Cargo Type',               field_type: 'select', is_required: false, sort_order: 8, group: 'Cargo Details', options: ['General', 'Fragile', 'Hazardous', 'Perishable', 'High Value', 'Oversized'] },
      { name: 'declared_value',    label: 'Declared Value (USD)',     field_type: 'number', is_required: false, sort_order: 9, group: 'Cargo Details' },
      { name: 'customs_required',  label: 'Customs Declaration Required', field_type: 'boolean', is_required: false, sort_order: 10, group: 'Compliance' },
      { name: 'incoterms',         label: 'Incoterms',                field_type: 'select', is_required: false, sort_order: 11, group: 'Compliance', options: ['EXW','FCA','CPT','CIP','DAP','DPU','DDP','FAS','FOB','CFR','CIF'] },
    ],
  },

  // ── 5. Insurance ─────────────────────────────────────────────────────
  {
    id:                 'insurance',
    label:              'Insurance',
    icon:               '🛡️',
    description:        'Life, health, motor, property, and commercial insurance',
    color:              '#dc2626',
    bg:                 '#fef2f2',
    contactLabel:       'Policyholder',
    contactLabelPlural: 'Policyholders',
    ticketLabel:        'Claim',
    companyLabel:       'Insurance Provider',
    dealLabel:          'Policy',
    departments:        ['New Business', 'Claims', 'Renewals', 'Customer Support', 'Underwriting'],
    slaDefaults: [
      { priority: 'urgent', name: 'Urgent — Casualty / Major Claim',  description: 'Death, hospitalisation, total loss, emergency claim. 24/7.', first_response_hours: 2,  resolution_hours: 24,  business_hours_only: false },
      { priority: 'high',   name: 'High — Active Claim Review',       description: 'Claim under investigation, surveyor assigned.',              first_response_hours: 4,  resolution_hours: 72,  business_hours_only: true  },
      { priority: 'medium', name: 'Medium — Policy Service',          description: 'Renewal, endorsement, coverage query, document request.',    first_response_hours: 8,  resolution_hours: 48,  business_hours_only: true  },
      { priority: 'low',    name: 'Low — General Enquiry',            description: 'Premium quote, product information, general feedback.',      first_response_hours: 24, resolution_hours: 96,  business_hours_only: true  },
    ],
    companyFields: [
      { name: 'insurer_license',      label: 'Insurer License Number',    field_type: 'text',   is_required: false, sort_order: 1, group: 'Regulatory' },
      { name: 'regulatory_body',      label: 'Regulatory Authority',      field_type: 'text',   is_required: false, sort_order: 2, group: 'Regulatory', placeholder: 'e.g. IRDAI, FCA, SAMA' },
      { name: 'reinsurer',            label: 'Reinsurance Partner',       field_type: 'text',   is_required: false, sort_order: 3, group: 'Business' },
      { name: 'product_lines',        label: 'Product Lines',             field_type: 'text',   is_required: false, sort_order: 4, group: 'Business', placeholder: 'e.g. Life, Health, Motor, Property' },
      { name: 'solvency_ratio',       label: 'Solvency Ratio (%)',        field_type: 'number', is_required: false, sort_order: 5, group: 'Financial' },
      { name: 'claims_ratio',         label: 'Claims Ratio (%)',          field_type: 'number', is_required: false, sort_order: 6, group: 'Financial' },
    ],
    dealFields: [
      { name: 'policy_type',          label: 'Policy Type',               field_type: 'select', is_required: true,  sort_order: 1, group: 'Policy',  options: ['Life', 'Health', 'Motor', 'Home', 'Travel', 'Commercial', 'Marine', 'Liability', 'Group'] },
      { name: 'sum_insured',          label: 'Sum Insured / Coverage',    field_type: 'number', is_required: true,  sort_order: 2, group: 'Policy' },
      { name: 'annual_premium',       label: 'Annual Premium',            field_type: 'number', is_required: false, sort_order: 3, group: 'Premium' },
      { name: 'payment_frequency',    label: 'Premium Payment Frequency', field_type: 'select', is_required: false, sort_order: 4, group: 'Premium', options: ['Annual', 'Semi-Annual', 'Quarterly', 'Monthly', 'Single Premium'] },
      { name: 'risk_category',        label: 'Risk Category',             field_type: 'select', is_required: false, sort_order: 5, group: 'Underwriting', options: ['Standard', 'Sub-Standard', 'Preferred', 'High Risk', 'Declined'] },
      { name: 'underwriter',          label: 'Underwriter Assigned',      field_type: 'text',   is_required: false, sort_order: 6, group: 'Underwriting' },
      { name: 'policy_start',         label: 'Policy Inception Date',     field_type: 'date',   is_required: false, sort_order: 7, group: 'Policy' },
      { name: 'policy_expiry',        label: 'Policy Expiry Date',        field_type: 'date',   is_required: false, sort_order: 8, group: 'Policy' },
      { name: 'no_claim_years',       label: 'No-Claim Bonus Years',      field_type: 'number', is_required: false, sort_order: 9, group: 'History' },
    ],
    ticketFields: [
      { name: 'claim_type',           label: 'Claim Type',                field_type: 'select', is_required: true,  sort_order: 1, group: 'Claim', options: ['Death Claim', 'Health / Hospitalisation', 'Motor Accident', 'Property Damage', 'Theft', 'Travel Disruption', 'Liability', 'Other'] },
      { name: 'date_of_loss',         label: 'Date of Loss / Incident',   field_type: 'date',   is_required: false, sort_order: 2, group: 'Claim' },
      { name: 'loss_amount',          label: 'Claimed Loss Amount',       field_type: 'number', is_required: false, sort_order: 3, group: 'Claim' },
      { name: 'surveyor_name',        label: 'Surveyor / Assessor Name',  field_type: 'text',   is_required: false, sort_order: 4, group: 'Investigation' },
      { name: 'settlement_method',    label: 'Settlement Method',         field_type: 'select', is_required: false, sort_order: 5, group: 'Settlement', options: ['Cash', 'Cashless', 'Reimbursement', 'Replacement', 'Repair'] },
      { name: 'salvage_value',        label: 'Salvage Value',             field_type: 'number', is_required: false, sort_order: 6, group: 'Settlement' },
    ],
    fields: [
      CUSTOMER_TYPE_FIELD,
      { name: 'policy_number',     label: 'Policy Number',            field_type: 'text',   is_required: true,  sort_order: 1, group: 'Policy Details', placeholder: 'e.g. POL-2024-00123' },
      { name: 'policy_type',       label: 'Policy Type',              field_type: 'select', is_required: true,  sort_order: 2, group: 'Policy Details', options: ['Life', 'Health', 'Motor', 'Home', 'Travel', 'Commercial', 'Marine', 'Liability'] },
      { name: 'coverage_amount',   label: 'Sum Insured / Coverage',   field_type: 'number', is_required: false, sort_order: 3, group: 'Policy Details' },
      { name: 'premium_amount',    label: 'Annual Premium',           field_type: 'number', is_required: false, sort_order: 4, group: 'Policy Details' },
      { name: 'policy_start_date', label: 'Policy Start Date',        field_type: 'date',   is_required: false, sort_order: 5, group: 'Policy Details' },
      { name: 'policy_end_date',   label: 'Policy Expiry Date',       field_type: 'date',   is_required: false, sort_order: 6, group: 'Policy Details' },
      { name: 'claim_number',      label: 'Claim Number (if any)',    field_type: 'text',   is_required: false, sort_order: 7, group: 'Claim Details', placeholder: 'e.g. CLM-2024-0045' },
      { name: 'claim_status',      label: 'Claim Status',             field_type: 'select', is_required: false, sort_order: 8, group: 'Claim Details', options: ['No Claim', 'Draft', 'Submitted', 'Under Review', 'Approved', 'Paid', 'Rejected', 'Disputed'] },
      { name: 'agent_broker',      label: 'Agent / Broker Name',      field_type: 'text',   is_required: false, sort_order: 9, group: 'Policy Details' },
      { name: 'nominee',           label: 'Nominee / Beneficiary',    field_type: 'text',   is_required: false, sort_order: 10, group: 'Policy Details' },
      { name: 'date_of_birth',     label: 'Date of Birth',            field_type: 'date',   is_required: false, sort_order: 11, group: 'Identity' },
    ],
  },

  // ── 6. Education ─────────────────────────────────────────────────────
  {
    id:                 'education',
    label:              'Education',
    icon:               '🎓',
    description:        'Schools, universities, training institutes, and e-learning platforms',
    color:              '#0891b2',
    bg:                 '#f0f9ff',
    contactLabel:       'Student',
    contactLabelPlural: 'Students',
    ticketLabel:        'Inquiry',
    companyLabel:       'Institution',
    dealLabel:          'Enrollment / Fee',
    departments:        ['Admissions', 'Student Services', 'Finance & Fees', 'Academic Affairs', 'Alumni'],
    slaDefaults: [
      { priority: 'urgent', name: 'Urgent — Student Safety / Crisis', description: 'Welfare concern, harassment, emergency on campus. 24/7.',    first_response_hours: 1,  resolution_hours: 8,   business_hours_only: false },
      { priority: 'high',   name: 'High — Exam / Results Issue',      description: 'Incorrect grades, missing results, appeal deadline.',       first_response_hours: 4,  resolution_hours: 24,  business_hours_only: true  },
      { priority: 'medium', name: 'Medium — Admissions / Finance',    description: 'Fee dispute, admission query, scholarship delay.',          first_response_hours: 8,  resolution_hours: 48,  business_hours_only: true  },
      { priority: 'low',    name: 'Low — General Inquiry',            description: 'Course info, timetable, library, hostel queries.',          first_response_hours: 24, resolution_hours: 72,  business_hours_only: true  },
    ],
    companyFields: [
      { name: 'institution_type',     label: 'Institution Type',          field_type: 'select', is_required: false, sort_order: 1, group: 'Identity', options: ['School', 'College', 'University', 'Training Institute', 'E-Learning', 'Vocational', 'Other'] },
      { name: 'accreditation_body',   label: 'Accreditation Body',        field_type: 'text',   is_required: false, sort_order: 2, group: 'Regulatory' },
      { name: 'affiliation',          label: 'Affiliated University / Board', field_type: 'text', is_required: false, sort_order: 3, group: 'Regulatory' },
      { name: 'ranking_grade',        label: 'Ranking / Grade (NAAC/QS)', field_type: 'text',   is_required: false, sort_order: 4, group: 'Quality', placeholder: 'e.g. A++, QS 500' },
      { name: 'student_capacity',     label: 'Student Capacity',          field_type: 'number', is_required: false, sort_order: 5, group: 'Operations' },
      { name: 'campus_count',         label: 'Number of Campuses',        field_type: 'number', is_required: false, sort_order: 6, group: 'Operations' },
    ],
    dealFields: [
      { name: 'program_name',         label: 'Program / Course Name',     field_type: 'text',   is_required: true,  sort_order: 1, group: 'Enrollment' },
      { name: 'academic_batch',       label: 'Batch / Academic Year',     field_type: 'text',   is_required: false, sort_order: 2, group: 'Enrollment', placeholder: 'e.g. 2024–2026' },
      { name: 'total_fee',            label: 'Total Program Fee',         field_type: 'number', is_required: false, sort_order: 3, group: 'Finance' },
      { name: 'fee_paid',             label: 'Amount Paid to Date',       field_type: 'number', is_required: false, sort_order: 4, group: 'Finance' },
      { name: 'installment_plan',     label: 'Installment Plan',          field_type: 'select', is_required: false, sort_order: 5, group: 'Finance', options: ['Full Upfront', 'Semester-wise', 'Monthly', 'Annual'] },
      { name: 'scholarship_applied',  label: 'Scholarship Applied',       field_type: 'boolean',is_required: false, sort_order: 6, group: 'Finance' },
      { name: 'enrollment_date',      label: 'Enrollment Date',           field_type: 'date',   is_required: false, sort_order: 7, group: 'Enrollment' },
      { name: 'expected_completion',  label: 'Expected Completion Date',  field_type: 'date',   is_required: false, sort_order: 8, group: 'Enrollment' },
    ],
    ticketFields: [
      { name: 'inquiry_type',         label: 'Inquiry / Issue Type',      field_type: 'select', is_required: true,  sort_order: 1, group: 'Inquiry', options: ['Admission', 'Fee / Finance', 'Result / Grade', 'Attendance', 'Scholarship', 'Hostel', 'Timetable', 'Certificate', 'Welfare', 'Other'] },
      { name: 'academic_department',  label: 'Department / Faculty',      field_type: 'text',   is_required: false, sort_order: 2, group: 'Inquiry' },
      { name: 'academic_year',        label: 'Academic Year Concerned',   field_type: 'text',   is_required: false, sort_order: 3, group: 'Inquiry' },
      { name: 'response_deadline',    label: 'Response Required By',      field_type: 'date',   is_required: false, sort_order: 4, group: 'Inquiry' },
    ],
    fields: [
      CUSTOMER_TYPE_FIELD,
      { name: 'student_id',        label: 'Student / Enrollment ID',  field_type: 'text',   is_required: true,  sort_order: 1, group: 'Academic Details', placeholder: 'e.g. STU-2024-0078' },
      { name: 'course_program',    label: 'Course / Program',         field_type: 'text',   is_required: true,  sort_order: 2, group: 'Academic Details', placeholder: 'e.g. B.Sc. Computer Science' },
      { name: 'faculty_department',label: 'Faculty / Department',     field_type: 'text',   is_required: false, sort_order: 3, group: 'Academic Details' },
      { name: 'academic_year',     label: 'Academic Year / Semester', field_type: 'text',   is_required: false, sort_order: 4, group: 'Academic Details', placeholder: 'e.g. Year 2 / Semester 3' },
      { name: 'enrollment_date',   label: 'Enrollment Date',          field_type: 'date',   is_required: false, sort_order: 5, group: 'Academic Details' },
      { name: 'expected_graduation',label: 'Expected Graduation Year',field_type: 'text',   is_required: false, sort_order: 6, group: 'Academic Details', placeholder: 'e.g. 2026' },
      { name: 'guardian_name',     label: "Parent / Guardian's Name", field_type: 'text',   is_required: false, sort_order: 7, group: 'Guardian Details' },
      { name: 'guardian_contact',  label: 'Guardian Contact Number',  field_type: 'phone',  is_required: false, sort_order: 8, group: 'Guardian Details' },
      { name: 'scholarship_status',label: 'Scholarship / Aid Status', field_type: 'select', is_required: false, sort_order: 9, group: 'Finance', options: ['None', 'Applied', 'Awarded', 'Partial', 'Full', 'Discontinued'] },
      { name: 'fee_status',        label: 'Fee Payment Status',       field_type: 'select', is_required: false, sort_order: 10, group: 'Finance', options: ['Paid', 'Partial', 'Pending', 'Overdue', 'Waived'] },
      { name: 'hostel_required',   label: 'Hostel / Accommodation',   field_type: 'boolean',is_required: false, sort_order: 11, group: 'Logistics' },
    ],
  },

  // ── 7. eCommerce ─────────────────────────────────────────────────────
  {
    id:                 'ecommerce',
    label:              'eCommerce',
    icon:               '🛒',
    description:        'Online retail, marketplaces, D2C brands, and digital stores',
    color:              '#ea580c',
    bg:                 '#fff7ed',
    contactLabel:       'Shopper',
    contactLabelPlural: 'Shoppers',
    ticketLabel:        'Issue',
    companyLabel:       'Seller / Brand',
    dealLabel:          'Order / Account',
    departments:        ['Customer Support', 'Returns & Refunds', 'Payments', 'Logistics', 'Seller Support'],
    slaDefaults: [
      { priority: 'urgent', name: 'Urgent — Payment / Fraud',        description: 'Unauthorized charge, payment failure, account compromise.', first_response_hours: 1,  resolution_hours: 4,   business_hours_only: false },
      { priority: 'high',   name: 'High — Non-Delivery / Damage',    description: 'Order not received, product damaged, wrong item.',          first_response_hours: 2,  resolution_hours: 24,  business_hours_only: true  },
      { priority: 'medium', name: 'Medium — Return / Refund',        description: 'Return request, refund tracking, exchange.',                first_response_hours: 4,  resolution_hours: 48,  business_hours_only: true  },
      { priority: 'low',    name: 'Low — Order / Account Query',     description: 'Order status, delivery ETA, account update.',              first_response_hours: 8,  resolution_hours: 24,  business_hours_only: true  },
    ],
    companyFields: [
      { name: 'marketplace',          label: 'Marketplace / Platform',    field_type: 'text',   is_required: false, sort_order: 1, group: 'Business', placeholder: 'e.g. Amazon, Noon, Website' },
      { name: 'seller_rating',        label: 'Seller Rating',             field_type: 'number', is_required: false, sort_order: 2, group: 'Performance' },
      { name: 'gmv_category',         label: 'GMV Category',              field_type: 'select', is_required: false, sort_order: 3, group: 'Performance', options: ['< $10k', '$10k–$100k', '$100k–$1M', '$1M–$10M', '> $10M'] },
      { name: 'return_rate_pct',      label: 'Return Rate (%)',           field_type: 'number', is_required: false, sort_order: 4, group: 'Performance' },
      { name: 'fulfilment_type',      label: 'Fulfilment Model',          field_type: 'select', is_required: false, sort_order: 5, group: 'Operations', options: ['Self-Fulfilled', 'FBA / FBN', '3PL', 'Dropship', 'Click & Collect'] },
      { name: 'product_categories',   label: 'Product Categories',        field_type: 'text',   is_required: false, sort_order: 6, group: 'Business' },
    ],
    dealFields: [
      { name: 'order_id',             label: 'Order / Account ID',        field_type: 'text',   is_required: true,  sort_order: 1, group: 'Order' },
      { name: 'sku_count',            label: 'Number of SKUs',            field_type: 'number', is_required: false, sort_order: 2, group: 'Order' },
      { name: 'average_order_value',  label: 'Average Order Value',       field_type: 'number', is_required: false, sort_order: 3, group: 'Commercial' },
      { name: 'lifetime_value',       label: 'Customer Lifetime Value',   field_type: 'number', is_required: false, sort_order: 4, group: 'Commercial' },
      { name: 'acquisition_channel',  label: 'Acquisition Channel',       field_type: 'select', is_required: false, sort_order: 5, group: 'Marketing', options: ['Organic', 'Paid Search', 'Social Media', 'Email', 'Referral', 'Marketplace', 'Direct'] },
      { name: 'discount_pct',         label: 'Discount / Promo (%)',      field_type: 'number', is_required: false, sort_order: 6, group: 'Commercial' },
      { name: 'subscription_active',  label: 'Subscription Active',       field_type: 'boolean',is_required: false, sort_order: 7, group: 'Subscription' },
    ],
    ticketFields: [
      { name: 'issue_category',       label: 'Issue Category',            field_type: 'select', is_required: true,  sort_order: 1, group: 'Issue', options: ['Non-Delivery', 'Damaged Item', 'Wrong Item', 'Payment Failure', 'Refund Pending', 'Return Rejected', 'Account Access', 'Fraud', 'Other'] },
      { name: 'affected_order_id',    label: 'Affected Order ID',         field_type: 'text',   is_required: false, sort_order: 2, group: 'Issue' },
      { name: 'refund_amount',        label: 'Refund Amount Requested',   field_type: 'number', is_required: false, sort_order: 3, group: 'Resolution' },
      { name: 'courier_partner',      label: 'Courier / Delivery Partner',field_type: 'text',   is_required: false, sort_order: 4, group: 'Delivery' },
      { name: 'return_tracking',      label: 'Return Tracking Number',    field_type: 'text',   is_required: false, sort_order: 5, group: 'Delivery' },
    ],
    fields: [
      CUSTOMER_TYPE_FIELD,
      { name: 'order_id',          label: 'Order ID',                 field_type: 'text',   is_required: true,  sort_order: 1, group: 'Order Details', placeholder: 'e.g. ORD-2024-00567' },
      { name: 'platform',          label: 'Platform / Store',         field_type: 'text',   is_required: false, sort_order: 2, group: 'Order Details', placeholder: 'e.g. Amazon, Shopify, Website' },
      { name: 'product_category',  label: 'Product Category',         field_type: 'select', is_required: false, sort_order: 3, group: 'Order Details', options: ['Electronics', 'Fashion', 'Home & Garden', 'Food & Beverage', 'Health & Beauty', 'Books', 'Toys', 'Sports', 'Automotive', 'Other'] },
      { name: 'order_value',       label: 'Order Value',              field_type: 'number', is_required: false, sort_order: 4, group: 'Order Details' },
      { name: 'order_status',      label: 'Order Status',             field_type: 'select', is_required: false, sort_order: 5, group: 'Order Details', options: ['Placed', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled', 'Failed'] },
      { name: 'return_refund_status', label: 'Return / Refund Status',field_type: 'select', is_required: false, sort_order: 6, group: 'After Sales', options: ['Not Requested', 'Requested', 'Approved', 'Picked Up', 'Refund Initiated', 'Refunded', 'Rejected'] },
      { name: 'delivery_address',  label: 'Delivery Address',         field_type: 'textarea',is_required: false, sort_order: 7, group: 'Delivery' },
      { name: 'payment_method',    label: 'Payment Method',           field_type: 'select', is_required: false, sort_order: 8, group: 'Payment', options: ['Credit Card', 'Debit Card', 'UPI / Wallet', 'Net Banking', 'COD', 'BNPL', 'Crypto', 'Other'] },
      { name: 'coupon_code',       label: 'Coupon / Promo Code',      field_type: 'text',   is_required: false, sort_order: 9, group: 'Order Details' },
      { name: 'seller_id',         label: 'Seller / Vendor ID',       field_type: 'text',   is_required: false, sort_order: 10, group: 'Marketplace', placeholder: 'If marketplace order' },
    ],
  },

  // ── 8. Others (Generic) ──────────────────────────────────────────────
  {
    id:                 'other',
    label:              'Other',
    icon:               '🏢',
    description:        'Any other business — fully customizable fields for your unique needs',
    color:              '#475569',
    bg:                 '#f8fafc',
    contactLabel:       'Contact',
    contactLabelPlural: 'Contacts',
    ticketLabel:        'Ticket',
    companyLabel:       'Company',
    dealLabel:          'Deal',
    departments:        ['Customer Support', 'Sales', 'Operations'],
    slaDefaults: [
      { priority: 'urgent', name: 'Urgent',  description: 'Critical issues requiring immediate attention. 24/7.',   first_response_hours: 1,  resolution_hours: 4,   business_hours_only: false },
      { priority: 'high',   name: 'High',    description: 'High-priority issues — same business day.',              first_response_hours: 4,  resolution_hours: 8,   business_hours_only: true  },
      { priority: 'medium', name: 'Medium',  description: 'Standard service request — respond within one day.',     first_response_hours: 8,  resolution_hours: 24,  business_hours_only: true  },
      { priority: 'low',    name: 'Low',     description: 'Low-priority query — respond within three business days.',first_response_hours: 24, resolution_hours: 72,  business_hours_only: true  },
    ],
    companyFields: [
      { name: 'industry',           label: 'Industry',                  field_type: 'text',   is_required: false, sort_order: 1, group: 'Details' },
      { name: 'company_size',       label: 'Company Size',              field_type: 'select', is_required: false, sort_order: 2, group: 'Details', options: ['1–10', '11–50', '51–200', '201–500', '500+'] },
      { name: 'annual_revenue',     label: 'Annual Revenue (USD)',      field_type: 'number', is_required: false, sort_order: 3, group: 'Details' },
      { name: 'account_manager',    label: 'Account Manager',           field_type: 'text',   is_required: false, sort_order: 4, group: 'Details' },
    ],
    dealFields: [
      { name: 'deal_type',          label: 'Deal Type',                 field_type: 'text',   is_required: false, sort_order: 1, group: 'Details' },
      { name: 'expected_close',     label: 'Expected Close Date',       field_type: 'date',   is_required: false, sort_order: 2, group: 'Details' },
      { name: 'deal_source',        label: 'Lead Source',               field_type: 'select', is_required: false, sort_order: 3, group: 'Details', options: ['Inbound', 'Outbound', 'Referral', 'Partner', 'Event', 'Other'] },
      { name: 'competitor',         label: 'Competing Against',         field_type: 'text',   is_required: false, sort_order: 4, group: 'Details' },
    ],
    ticketFields: [
      { name: 'ticket_category',    label: 'Category',                  field_type: 'text',   is_required: false, sort_order: 1, group: 'Details' },
      { name: 'impact',             label: 'Business Impact',           field_type: 'select', is_required: false, sort_order: 2, group: 'Details', options: ['None', 'Low', 'Medium', 'High', 'Critical'] },
    ],
    fields: [
      CUSTOMER_TYPE_FIELD,
      { name: 'reference_number',  label: 'Reference / Case Number',  field_type: 'text',   is_required: false, sort_order: 1, group: 'Details' },
      { name: 'customer_segment',  label: 'Customer Segment',         field_type: 'select', is_required: false, sort_order: 2, group: 'Details', options: ['VIP', 'Premium', 'Standard', 'Trial', 'Partner'] },
      { name: 'region',            label: 'Region / Territory',       field_type: 'text',   is_required: false, sort_order: 3, group: 'Details' },
      { name: 'notes',             label: 'Additional Notes',         field_type: 'textarea',is_required: false, sort_order: 4, group: 'Details' },
    ],
  },
];

export const SECTOR_MAP: Record<string, SectorConfig> = Object.fromEntries(
  SECTORS.map(s => [s.id, s]),
);

export function getSector(id: string | null | undefined): SectorConfig {
  return SECTOR_MAP[id ?? ''] ?? SECTOR_MAP['other'];
}
