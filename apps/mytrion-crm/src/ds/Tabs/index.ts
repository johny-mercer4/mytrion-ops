/**
 * Two components, one ARIA contract. `Tabs` and `TabPanel` share the id-derivation helpers that
 * wire `aria-controls` to `aria-labelledby`, so they live in one file and re-export from here —
 * per CONVENTIONS §1, a folder that exports more than one component carries an index.
 */
export { Tabs, TabPanel } from './Tabs';
export type { TabsProps, TabPanelProps, TabItem, TabsVariant, TabsSize } from './Tabs';
