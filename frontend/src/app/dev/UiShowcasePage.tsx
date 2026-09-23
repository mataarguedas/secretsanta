import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import {
  Avatar,
  Banner,
  Button,
  Card,
  Eyebrow,
  Input,
  Pill,
  PillToggle,
  Select,
  Switch,
  Textarea,
} from '@/components/ui';

const CRC_SYMBOL = '₡';

// A neutral "photo" for the avatar demo, inline so it works offline and under the CSP.
const SAMPLE_PHOTO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="wheat"/><circle cx="32" cy="26" r="12" fill="sienna"/><rect x="12" y="42" width="40" height="30" rx="20" fill="sienna"/></svg>',
  );

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-16">
      <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-15">
      <h2 className="font-serif text-heading-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

/** Development-only showcase of every UI primitive (registered only when import.meta.env.DEV). */
export default function UiShowcasePage() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'named' | 'anonymous'>('named');
  const [groupChat, setGroupChat] = useState(true);

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-32 px-20 py-32 md:gap-[64px] md:py-[64px]">
      <header className="flex flex-col gap-10">
        <h1 className="font-serif text-heading font-medium md:text-heading-lg">
          {t('ui.showcase.title')}
        </h1>
        <p className="text-body text-charcoal">{t('ui.showcase.intro')}</p>
      </header>

      <Section title={t('ui.showcase.sections.buttons')}>
        <div className="flex flex-wrap items-center gap-15">
          {/* One coral primary per viewport. */}
          <Button variant="primary">{t('ui.showcase.buttons.primary')}</Button>
          <Button variant="secondary">{t('ui.showcase.buttons.secondary')}</Button>
          <Button variant="nav">{t('ui.showcase.buttons.nav')}</Button>
          <Button variant="ghost">{t('ui.showcase.buttons.ghost')}</Button>
          <Button variant="secondary" loading>
            {t('ui.showcase.buttons.loading')}
          </Button>
          <Button variant="nav" disabled>
            {t('ui.showcase.buttons.disabled')}
          </Button>
          <Button variant="nav" iconOnly aria-label={t('ui.showcase.buttons.close')}>
            <CloseIcon />
          </Button>
          <Button variant="nav" asChild>
            <Link to="/">{t('app.name')}</Link>
          </Button>
        </div>
        <Button variant="secondary" fullWidthOnMobile>
          {t('ui.showcase.buttons.save')}
        </Button>
      </Section>

      <Section title={t('ui.showcase.sections.pills')}>
        <div className="flex flex-wrap items-center gap-10">
          <Pill>{t('ui.showcase.pills.high')}</Pill>
          <Pill>{t('ui.showcase.pills.medium')}</Pill>
          <Pill tone="outline">{t('ui.showcase.pills.low')}</Pill>
          <Pill tone="outline">{t('ui.showcase.pills.count')}</Pill>
        </div>
        <div className="flex flex-wrap gap-10">
          <PillToggle
            pressed={mode === 'named'}
            onPressedChange={() => {
              setMode('named');
            }}
          >
            {t('ui.showcase.pills.named')}
          </PillToggle>
          <PillToggle
            pressed={mode === 'anonymous'}
            onPressedChange={() => {
              setMode('anonymous');
            }}
          >
            {t('ui.showcase.pills.anonymous')}
          </PillToggle>
        </div>
      </Section>

      <Section title={t('ui.showcase.sections.cards')}>
        <div className="grid gap-20 md:grid-cols-2">
          <Card>
            <h3 className="font-serif text-subheading font-medium">
              {t('ui.showcase.cards.contentTitle')}
            </h3>
            <p className="mt-10 text-body text-charcoal">{t('ui.showcase.cards.contentBody')}</p>
          </Card>
          <Card asChild>
            <Link to="/">
              <span className="block font-serif text-subheading font-medium">
                {t('ui.showcase.cards.interactiveTitle')}
              </span>
              <span className="mt-10 block text-body text-charcoal">
                {t('ui.showcase.cards.interactiveBody')}
              </span>
            </Link>
          </Card>
        </div>
      </Section>

      <Section title={t('ui.showcase.sections.avatars')}>
        <div className="flex flex-wrap items-center gap-15">
          <Avatar size="sm" src={SAMPLE_PHOTO} alt={t('ui.showcase.avatars.image')} />
          <Avatar size="md" src={SAMPLE_PHOTO} alt={t('ui.showcase.avatars.image')} />
          <Avatar size="lg" src={SAMPLE_PHOTO} alt={t('ui.showcase.avatars.image')} />
          <Avatar size="md" alt={t('ui.showcase.avatars.initials')} />
          <Avatar
            size="md"
            src="/does-not-exist.png"
            name={t('ui.showcase.avatars.initials')}
            alt={t('ui.showcase.avatars.broken')}
          />
          <Avatar size="sm" anonymous alt={t('ui.showcase.avatars.anonymous')} />
          <Avatar size="md" anonymous alt={t('ui.showcase.avatars.anonymous')} />
          <Avatar size="lg" anonymous alt={t('ui.showcase.avatars.anonymous')} />
        </div>
      </Section>

      <Section title={t('ui.showcase.sections.forms')}>
        <div className="grid max-w-[600px] gap-20">
          <Input label={t('ui.showcase.forms.name')} error={t('ui.showcase.forms.nameError')} />
          <Input
            label={t('ui.showcase.forms.budget')}
            help={t('ui.showcase.forms.budgetHelp')}
            prefix={CRC_SYMBOL}
            inputMode="numeric"
            placeholder={t('ui.showcase.forms.budgetPlaceholder')}
          />
          <Textarea
            label={t('ui.showcase.forms.description')}
            help={t('ui.showcase.forms.descriptionHelp')}
          />
          <Select label={t('ui.showcase.forms.priority')} defaultValue="medium">
            <option value="high">{t('ui.showcase.pills.high')}</option>
            <option value="medium">{t('ui.showcase.pills.medium')}</option>
            <option value="low">{t('ui.showcase.pills.low')}</option>
          </Select>
          <Input label={t('ui.showcase.forms.disabled')} disabled />
          <Switch
            label={t('ui.showcase.forms.groupChat')}
            description={t('ui.showcase.forms.groupChatHelp')}
            checked={groupChat}
            onCheckedChange={setGroupChat}
          />
          <Switch label={t('ui.showcase.forms.reminders')} disabled />
        </div>
      </Section>

      <Section title={t('ui.showcase.sections.eyebrow')}>
        <div className="flex flex-col gap-10">
          <Eyebrow>{t('ui.showcase.eyebrow.open')}</Eyebrow>
          <Eyebrow>{t('ui.showcase.eyebrow.drawn')}</Eyebrow>
          <Eyebrow>{t('ui.showcase.eyebrow.hosting')}</Eyebrow>
          <Eyebrow as="span">{t('ui.showcase.eyebrow.elf')}</Eyebrow>
        </div>
      </Section>

      <Section title={t('ui.showcase.sections.banner')}>
        <Banner action={<Button variant="nav">{t('ui.showcase.banner.action')}</Button>}>
          {t('ui.showcase.banner.text')}
        </Banner>
      </Section>
    </div>
  );
}
