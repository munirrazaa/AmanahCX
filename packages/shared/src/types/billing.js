"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAN_PRICING = void 0;
// All plans priced in PKR and USD
exports.PLAN_PRICING = [
    // USD pricing
    { plan: 'starter', billingCycle: 'monthly', currency: 'USD', amount: 2900, displayAmount: 29 },
    { plan: 'starter', billingCycle: 'annual', currency: 'USD', amount: 27840, displayAmount: 278.4 },
    { plan: 'professional', billingCycle: 'monthly', currency: 'USD', amount: 7900, displayAmount: 79 },
    { plan: 'professional', billingCycle: 'annual', currency: 'USD', amount: 75840, displayAmount: 758.4 },
    { plan: 'enterprise', billingCycle: 'monthly', currency: 'USD', amount: 0, displayAmount: 0 }, // custom
    // PKR pricing (for Pakistan-based customers)
    { plan: 'starter', billingCycle: 'monthly', currency: 'PKR', amount: 799900, displayAmount: 7999 },
    { plan: 'starter', billingCycle: 'annual', currency: 'PKR', amount: 7679040, displayAmount: 76790 },
    { plan: 'professional', billingCycle: 'monthly', currency: 'PKR', amount: 2199900, displayAmount: 21999 },
    { plan: 'professional', billingCycle: 'annual', currency: 'PKR', amount: 21119040, displayAmount: 211190 },
];
//# sourceMappingURL=billing.js.map