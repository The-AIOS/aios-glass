/**
 * Whether the AIOS Files view is currently visible. A leaf module (imports
 * nothing) so both the Files view (writer) and the Home panel (reader, for the
 * files-button active state) can share it without an import cycle.
 */
let visible = false;
export const getFilesVisible = (): boolean => visible;
export const setFilesVisible = (v: boolean): void => { visible = v; };
