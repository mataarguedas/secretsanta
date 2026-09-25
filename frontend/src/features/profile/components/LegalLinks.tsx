import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button } from '@/components/ui';

/** `/privacy` and `/terms` as nav pills (FR-ACC-4). Also in the Landing footer. */
export function LegalLinks() {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-12">
      {(['privacy', 'terms'] as const).map((doc) => (
        <li key={doc}>
          <Button variant="nav" asChild>
            <Link to={`/${doc}`}>{t(`legal.links.${doc}`)}</Link>
          </Button>
        </li>
      ))}
    </ul>
  );
}
