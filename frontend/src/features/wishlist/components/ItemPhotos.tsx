import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Carousel, Modal } from '@/components/ui';

import type { WishlistItem } from '../api';

/**
 * An item's photos on its card: a carousel of the 400px thumbnails, lazily loaded, and a
 * "View larger" pill that opens a lightbox with the full-size (1600px) images on the same
 * photo.
 */
export function ItemPhotos({ item }: { item: WishlistItem }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const total = item.photos.length;
  if (total === 0) return null;

  const alt = (n: number) => t('wishlist.photos.alt', { title: item.title, n, total });
  const label = t('wishlist.photos.carouselLabel', { title: item.title });

  return (
    <div className="flex w-full flex-col items-start gap-8 md:w-[240px] md:shrink-0">
      <Carousel
        label={label}
        className="w-full"
        aspectClassName="aspect-[4/3] md:aspect-square"
        onIndexChange={setIndex}
        slides={item.photos.map((photo, i) => (
          <img
            key={photo.id}
            src={photo.thumb_url}
            alt={alt(i + 1)}
            width={photo.width}
            height={photo.height}
            loading="lazy"
            decoding="async"
          />
        ))}
      />
      <Button
        variant="ghost"
        aria-label={t('wishlist.photos.enlargeLabel', { title: item.title })}
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('wishlist.photos.enlarge')}
      </Button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={item.title}
      >
        {open && (
          <Carousel
            label={label}
            initialIndex={index}
            aspectClassName="aspect-square"
            slides={item.photos.map((photo, i) => (
              <img
                key={photo.id}
                src={photo.url}
                alt={alt(i + 1)}
                width={photo.width}
                height={photo.height}
                decoding="async"
                className="object-contain!"
              />
            ))}
          />
        )}
      </Modal>
    </div>
  );
}
