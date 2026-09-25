import { useTranslation } from 'react-i18next';

import { Button, Modal } from '@/components/ui';

/** Safari's Share glyph: a square with an arrow out of the top. */
function ShareIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-24 shrink-0" fill="none">
      <path
        d="M12 3v12M8 7l4-4 4 4M7 11H5v10h14V11h-2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** "Add to Home Screen": a plus in a rounded square. */
function AddIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-24 shrink-0" fill="none">
      <rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** The installed app's icon on the Home Screen. */
function HomeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-24 shrink-0" fill="none">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9.5 12.5l2 2 3.5-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const STEPS = [
  { key: 'share', Icon: ShareIcon },
  { key: 'add', Icon: AddIcon },
  { key: 'open', Icon: HomeIcon },
] as const;

/**
 * PRD §9.3.10: how to install on iPhone/iPad (Share › Add to Home Screen). On iOS, push
 * only works in the installed app (FR-NTF-1), so this replaces the enable button there.
 * Text and simple line icons only: no illustrations (CLAUDE.md §6.2).
 */
export function IosInstallGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('notifications.iosGuide.title')}
      description={t('notifications.iosGuide.intro')}
      footer={
        <Button variant="nav" onClick={onClose}>
          {t('notifications.iosGuide.done')}
        </Button>
      }
    >
      <ol className="flex flex-col gap-15">
        {STEPS.map(({ key, Icon }) => (
          <li key={key} className="flex items-start gap-12">
            <span className="flex size-40 shrink-0 items-center justify-center rounded-full-2 border border-mist bg-cream-linen">
              <Icon />
            </span>
            <p className="pt-8 text-body">{t(`notifications.iosGuide.steps.${key}`)}</p>
          </li>
        ))}
      </ol>
      <p className="mt-15 text-sm text-stone">{t('notifications.iosGuide.note')}</p>
    </Modal>
  );
}
