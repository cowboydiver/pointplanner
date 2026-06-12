// Default field values substituted when a task field is left blank. Shared
// between the reducer (which applies them on create/edit) and the modal (which
// strips them back out when pre-filling the edit form) so they can't drift.
export const PLACEHOLDER_DESC = 'No description yet.';
export const PLACEHOLDER_OWNER = 'Unassigned';
export const PLACEHOLDER_DASH = '—';
