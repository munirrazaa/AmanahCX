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
    name: string;
    label: string;
    field_type: FieldType;
    is_required: boolean;
    sort_order: number;
    options?: string[];
    placeholder?: string;
    group?: string;
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
    companyLabel: string;
    dealLabel: string;
    departments: string[];
    fields: SectorField[];
    companyFields: SectorField[];
    dealFields: SectorField[];
    ticketFields: SectorField[];
    slaDefaults: SlaDefault[];
    defaultModules: string[];
    defaultFeatures: string[];
}
export declare const SECTORS: SectorConfig[];
export declare const SECTOR_MAP: Record<string, SectorConfig>;
export declare function getSector(id: string | null | undefined): SectorConfig;
//# sourceMappingURL=sectors.d.ts.map