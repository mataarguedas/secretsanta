import { DialogFrame, type DialogProps } from './dialog/DialogFrame';

export type SheetProps = DialogProps;

/** Bottom sheet below 768px, centered panel at 768px and up. Same a11y behavior as Modal. */
export function Sheet(props: SheetProps) {
  return <DialogFrame layout="sheet" {...props} />;
}
