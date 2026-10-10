/**
 * Distinct ids one population lookup may carry. Mirrors the (internal) constant in
 * packages/runtime/src/populate.ts: if the runtime changes it, the fixture's call-count invariant fails visibly
 * and this number is updated deliberately, together with the budgets (spec 089).
 */
export const POPULATE_ID_CHUNK = 80;
