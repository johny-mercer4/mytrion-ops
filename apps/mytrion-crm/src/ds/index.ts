/**
 * Mytrion Horizon — the design system's public surface.
 *
 * This barrel is the entry point for the library build (vite.lib.config.ts -> dist/), which is what
 * makes the system portable: an engineer imports `@/ds`, and a design tool binds the same compiled
 * bundle. Everything exported here obeys the purity contract in ./purity.test.ts — props in,
 * nothing else. No app context, no router, no data layer.
 *
 * Tokens are NOT exported from here. They are CSS custom properties in src/styles/theme.css and
 * reach a consumer through ./styles.css, which is why the bundle and the stylesheet ship together.
 *
 * GENERATED-ish: grouped by hand, symbols verified against the source. If you add a component,
 * add it to its group — a component missing from this file does not exist as far as the library
 * build, the kitchen sink, or a design tool is concerned.
 */


/* ── Foundation ─────────────────────────────────────────────────────────── */
export { Icon } from './Icon/Icon';
export type { IconName, IconProps } from './Icon/Icon';

/* ── Actions ─────────────────────────────────────────────────────────── */
export { Button } from './Button/Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button/Button';

/* ── Forms ─────────────────────────────────────────────────────────── */
export { Input } from './Input/Input';
export type { InputLabels, InputProps, InputSize, InputType } from './Input/Input';
export { Textarea } from './Textarea/Textarea';
export type { TextareaProps, TextareaResize, TextareaSize } from './Textarea/Textarea';
export { Select } from './Select/Select';
export type { SelectItem, SelectOption, SelectOptionGroup, SelectProps, SelectSize } from './Select/Select';
export { Checkbox } from './Checkbox/Checkbox';
export type { CheckboxProps, CheckboxSize } from './Checkbox/Checkbox';
export { Radio, RadioGroup } from './Radio';
export type { RadioGroupOrientation, RadioGroupProps, RadioProps, RadioSize } from './Radio';
export { Switch } from './Switch/Switch';
export type { SwitchLabelPlacement, SwitchProps, SwitchSize } from './Switch/Switch';

/* ── Display ─────────────────────────────────────────────────────────── */
export { Badge } from './Badge/Badge';
export type { BadgeIntent, BadgeProps, BadgeSize } from './Badge/Badge';
export { Avatar, AvatarGroup } from './Avatar';
export type { AvatarGroupProps, AvatarProps, AvatarSize, AvatarStatus } from './Avatar';
export { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSelectCell } from './Table';
export type { TableAlign, TableBodyProps, TableCellProps, TableDensity, TableHeadProps, TableHeaderCellProps, TableLayout, TableMessageRowProps, TableProps, TableRowProps, TableSelectCellProps, TableColumnPriority, TableScroller, TableSortDirection } from './Table';
// One column definition, two renderings: a real table on a desktop, a tap-to-detail card list below
// the structure line. Reach for this before Table — Table is the escape hatch for the tables too
// irregular to describe as data, not the default.
export { DataTable } from './DataTable';
export type { DataColumn, DataColumnMobile, DataTableDetail, DataTableProps, DataTableSort } from './DataTable';
export { Pagination } from './Pagination/Pagination';
export type { PaginationProps, PaginationSize } from './Pagination/Pagination';
export { TabPanel, Tabs } from './Tabs';
export type { TabItem, TabPanelProps, TabsProps, TabsSize, TabsVariant } from './Tabs';
export { Skeleton, SkeletonRegion } from './Skeleton/Skeleton';
export type { SkeletonProps, SkeletonRadius, SkeletonRegionProps, SkeletonTextSize, SkeletonVariant } from './Skeleton/Skeleton';

/* ── Overlays ─────────────────────────────────────────────────────────── */
export { Tooltip } from './Tooltip/Tooltip';
export type { TooltipPlacement, TooltipProps } from './Tooltip/Tooltip';
export { DropdownMenu } from './DropdownMenu/DropdownMenu';
export type { DropdownMenuActionItem, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabelItem, DropdownMenuPlacement, DropdownMenuProps, DropdownMenuSeparatorItem } from './DropdownMenu/DropdownMenu';
export { ConfirmDialog, Dialog } from './Dialog';
export type { ConfirmDialogProps, ConfirmTone, DialogCloseReason, DialogProps, DialogSize, FocusTargetRef } from './Dialog';
export { Drawer } from './Drawer';
export type { DrawerProps, DrawerSize } from './Drawer';

/* ── AI-native ─────────────────────────────────────────────────────────── */
export { StreamingText } from './StreamingText/StreamingText';
export type { StreamingTextProps, StreamingTextState } from './StreamingText/StreamingText';
export { AgentBadge, AgentStatus } from './AgentStatus';
export type { AgentBadgeProps, AgentBadgeSize, AgentState, AgentStatusProps, AgentStatusSize } from './AgentStatus';
export { TOOL_CALL_STATUS_LABEL, ToolCallCard, ToolCallStatusGlyph } from './ToolCallCard/ToolCallCard';
export type { ToolCallCardProps, ToolCallStatus, ToolCallStatusGlyphProps } from './ToolCallCard/ToolCallCard';
export { ToolCallList } from './ToolCallList/ToolCallList';
export type { ToolCallListItem, ToolCallListProps } from './ToolCallList/ToolCallList';
export { CitationChip } from './CitationChip/CitationChip';
export type { CitationChipProps } from './CitationChip/CitationChip';
export { SourceList } from './SourceList/SourceList';
export type { SourceItem, SourceListProps } from './SourceList/SourceList';
export { Provenance } from './Provenance/Provenance';
export type { GroundingState, ProvenanceProps } from './Provenance/Provenance';
export { ConfidenceMeter } from './ConfidenceMeter/ConfidenceMeter';
export type { ConfidenceLevel, ConfidenceMeterProps } from './ConfidenceMeter/ConfidenceMeter';
export { InlineDiff } from './InlineDiff/InlineDiff';
export type { DiffLine, DiffLineKind, InlineDiffProps } from './InlineDiff/InlineDiff';
export { ApprovalBar } from './ApprovalBar/ApprovalBar';
export type { ApprovalBarProps, ApprovalBusy, ApprovalOutcome, ApprovalRisk } from './ApprovalBar/ApprovalBar';
export { StopButton } from './StopButton/StopButton';
export type { StopButtonProps, StopButtonSize } from './StopButton/StopButton';
export { RetryButton } from './RetryButton/RetryButton';
export type { RetryButtonProps, RetryButtonSize, RetryButtonTone } from './RetryButton/RetryButton';
export { StoppedNote } from './StoppedNote/StoppedNote';
export type { StoppedNoteProps } from './StoppedNote/StoppedNote';
export { TurnError } from './TurnError/TurnError';
export type { TurnErrorKind, TurnErrorProps } from './TurnError/TurnError';
export { StructuredOutput } from './StructuredOutput/StructuredOutput';
export type { StructuredBlock, StructuredCodeBlock, StructuredListBlock, StructuredOutputProps, StructuredPreBlock, StructuredQuoteBlock, StructuredTableBlock, StructuredTableColumn } from './StructuredOutput/StructuredOutput';
export { ElicitationPicker } from './ElicitationPicker/ElicitationPicker';
export type { ElicitationOption, ElicitationPickerProps, ElicitationSelect } from './ElicitationPicker/ElicitationPicker';

/* ── Date & time · feedback ───────────────────────────────────── */
// Date math (addDays, parseDate, startOfWeek…) stays INTERNAL. A component library's public
// surface is its components; exporting a private date engine invites callers to depend on it.
export { DateField, DEFAULT_DATE_LABELS } from './DateField';
export type { DateFieldLabels, DateFieldMessages, DateFieldProps, DateFieldSize, DateValue } from './DateField';
export { EmptyState, ErrorState } from './EmptyState';
export type { EmptyStateProps, EmptyStateSize, EmptyStateTone, ErrorStateProps } from './EmptyState';
export { ToastProvider, useToast } from './Toast';
export type { ToastAction, ToastApi, ToastIntent, ToastOptions, ToastProviderProps } from './Toast';
export { Calendar, CalendarPopover, DatePicker, DateRangePicker } from './DatePicker';
export type { CalendarLabels, CalendarPopoverProps, CalendarProps, DatePickerMessages, DatePickerProps, DateRange, DateRangeMessages, DateRangePickerProps } from './DatePicker';
export { TimePicker } from './TimePicker';
export type { TimePickerLabels, TimePickerProps, TimePickerSize } from './TimePicker';
