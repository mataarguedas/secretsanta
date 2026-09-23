import { DialogFrame, type DialogProps } from './dialog/DialogFrame';

export type ModalProps = DialogProps;

/**
 * Centered dialog: portal, focus trap, Esc and backdrop close, aria-modal, labelled by its
 * title, focus restored on close.
 */
export function Modal(props: ModalProps) {
  return <DialogFrame layout="modal" {...props} />;
}
