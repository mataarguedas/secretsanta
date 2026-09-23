import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import {
  Avatar,
  Banner,
  Button,
  Card,
  Carousel,
  Eyebrow,
  Input,
  Modal,
  Pill,
  PillToggle,
  Select,
  Sheet,
  Switch,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Textarea,
  useToast,
} from '@/components/ui';
import { formatCRC, formatDate, formatDateTime } from '@/lib/format';

const CRC_SYMBOL = '₡';

// A neutral "photo" for the avatar demo, inline so it works offline and under the CSP.
const SAMPLE_PHOTO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="wheat"/><circle cx="32" cy="26" r="12" fill="sienna"/><rect x="12" y="42" width="40" height="30" rx="20" fill="sienna"/></svg>',
  );

// Solid-color placeholder slides (no stock imagery, per DESIGN.md).
const SLIDE_COLORS = ['wheat', 'sienna', 'tan'] as const;
const slideSrc = (fill: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="${fill}"/></svg>`,
  );

const TAB_VALUES = ['overview', 'participants', 'wishlists', 'chat', 'manage'] as const;
type TabValue = (typeof TAB_VALUES)[number];
const isTabValue = (v: string | null): v is TabValue =>
  v !== null && (TAB_VALUES as readonly string[]).includes(v);

const SAMPLE_DATE = new Date('2026-12-20T15:00:00Z');

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
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [mode, setMode] = useState<'named' | 'anonymous'>('named');
  const [groupChat, setGroupChat] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: TabValue = isTabValue(tabParam) ? tabParam : 'overview';

  return (
    <div className="flex flex-col gap-32 md:gap-[64px]">
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

      <Section title={t('ui.showcase.sections.dialogs')}>
        <div className="flex flex-wrap gap-10">
          <Button
            variant="nav"
            onClick={() => {
              setModalOpen(true);
            }}
          >
            {t('ui.showcase.dialogs.openModal')}
          </Button>
          <Button
            variant="nav"
            onClick={() => {
              setSheetOpen(true);
            }}
          >
            {t('ui.showcase.dialogs.openSheet')}
          </Button>
        </div>
        <Modal
          open={modalOpen}
          onClose={() => {
            setModalOpen(false);
          }}
          title={t('ui.showcase.dialogs.modalTitle')}
          description={t('ui.showcase.dialogs.modalBody')}
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setModalOpen(false);
                }}
              >
                {t('ui.showcase.dialogs.cancel')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setModalOpen(false);
                }}
              >
                {t('ui.showcase.dialogs.confirm')}
              </Button>
            </>
          }
        />
        <Sheet
          open={sheetOpen}
          onClose={() => {
            setSheetOpen(false);
          }}
          title={t('ui.showcase.dialogs.sheetTitle')}
          description={t('ui.showcase.dialogs.sheetBody')}
        >
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
        </Sheet>
      </Section>

      <Section title={t('ui.showcase.sections.toasts')}>
        <div className="flex flex-wrap gap-10">
          <Button
            variant="nav"
            onClick={() => {
              toast.success(t('ui.showcase.toasts.success'));
            }}
          >
            {t('ui.showcase.toasts.showSuccess')}
          </Button>
          <Button
            variant="nav"
            onClick={() => {
              toast.error(t('ui.showcase.toasts.error'));
            }}
          >
            {t('ui.showcase.toasts.showError')}
          </Button>
          <Button
            variant="nav"
            onClick={() => {
              toast.info(t('ui.showcase.toasts.info'));
            }}
          >
            {t('ui.showcase.toasts.showInfo')}
          </Button>
        </div>
      </Section>

      <Section title={t('ui.showcase.sections.tabs')}>
        {/* URL-driven: the selected tab lives in ?tab=, like /events/:id/:tab later. */}
        <Tabs
          value={tab}
          onValueChange={(next) => {
            setSearchParams({ tab: next }, { replace: true });
          }}
        >
          <TabList aria-label={t('ui.showcase.tabs.label')}>
            {TAB_VALUES.map((value) => (
              <Tab key={value} value={value}>
                {t(`ui.showcase.tabs.${value}`)}
              </Tab>
            ))}
          </TabList>
          {TAB_VALUES.map((value) => (
            <TabPanel key={value} value={value}>
              <Card>
                <p className="text-body text-charcoal">
                  {t('ui.showcase.tabs.panel', { tab: t(`ui.showcase.tabs.${value}`) })}
                </p>
              </Card>
            </TabPanel>
          ))}
        </Tabs>
      </Section>

      <Section title={t('ui.showcase.sections.carousel')}>
        <Carousel
          className="max-w-[400px]"
          aspectClassName="aspect-[4/3]"
          label={t('ui.showcase.carousel.label')}
          slides={SLIDE_COLORS.map((fill, i) => (
            <img
              key={fill}
              src={slideSrc(fill)}
              alt={t('ui.showcase.carousel.slide', { n: i + 1 })}
              draggable={false}
            />
          ))}
        />
      </Section>

      <Section title={t('ui.showcase.sections.format')}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-20 gap-y-8 text-body">
          <dt className="text-charcoal">{t('ui.showcase.format.money')}</dt>
          <dd className="font-mono" data-testid="format-crc">
            {formatCRC(25000)}
          </dd>
          <dt className="text-charcoal">{t('ui.showcase.format.date')}</dt>
          <dd className="font-mono">{formatDate(SAMPLE_DATE, i18n.language)}</dd>
          <dt className="text-charcoal">{t('ui.showcase.format.dateTime')}</dt>
          <dd className="font-mono">{formatDateTime(SAMPLE_DATE, i18n.language)}</dd>
        </dl>
      </Section>

      <Section title={t('ui.showcase.sections.banner')}>
        <Banner action={<Button variant="nav">{t('ui.showcase.banner.action')}</Button>}>
          {t('ui.showcase.banner.text')}
        </Banner>
      </Section>
    </div>
  );
}
