import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ArrowDownIcon, ArrowUpIcon } from '@/components/icons';
import { Button, Card, Modal, Pill, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { formatCRC } from '@/lib/format';

import {
  moveId,
  useCreateItem,
  useDeleteItem,
  useReorderItems,
  useUpdateItem,
  type Wishlist,
  type WishlistItem,
} from '../api';
import { itemToFormValues } from '../schemas';
import { ItemFormSheet } from './ItemFormSheet';

type Editing = { mode: 'add' } | { mode: 'edit'; item: WishlistItem } | null;

/**
 * One participant's wishlist. The owner (while the event isn't archived) can add, edit,
 * delete and reorder: drag and drop from 768px, up/down pills on mobile.
 */
export function WishlistView({
  eventId,
  wishlist,
  editable,
  archived,
}: {
  eventId: string;
  wishlist: Wishlist;
  editable: boolean;
  archived: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const ownerId = wishlist.owner.id;
  const create = useCreateItem(eventId, ownerId);
  const update = useUpdateItem(eventId, ownerId);
  const remove = useDeleteItem(eventId, ownerId);
  const reorder = useReorderItems(eventId, ownerId);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<WishlistItem | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const { items } = wishlist;
  const ids = items.map((item) => item.id);

  const move = (id: string, to: number) => {
    const next = moveId(ids, id, to);
    if (next === ids) return;
    reorder.mutate(next, {
      onError: () => toast.error(t('wishlist.toast.reorderFailed')),
    });
  };

  const heading = wishlist.is_self
    ? t('wishlist.mine')
    : t('wishlist.ofPerson', { name: wishlist.owner.name });

  return (
    <section aria-labelledby="wishlist-heading" className="flex flex-col gap-20">
      <div className="flex flex-wrap items-center justify-between gap-15">
        <h2 id="wishlist-heading" className="font-serif text-heading-sm font-medium break-words">
          {heading}
        </h2>
        {editable && items.length > 0 && (
          <Button
            variant="secondary"
            onClick={() => {
              setEditing({ mode: 'add' });
            }}
          >
            {t('wishlist.add')}
          </Button>
        )}
      </div>
      {archived && <p className="text-body text-charcoal">{t('wishlist.readOnly')}</p>}

      {items.length === 0 ? (
        <EmptyState
          own={wishlist.is_self}
          name={wishlist.owner.name}
          canAdd={editable}
          onAdd={() => {
            setEditing({ mode: 'add' });
          }}
        />
      ) : (
        <ol aria-label={heading} className="flex flex-col gap-15">
          {items.map((item, index) => (
            <li
              key={item.id}
              draggable={editable}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.id);
                setDragging(item.id);
              }}
              onDragEnd={() => {
                setDragging(null);
              }}
              onDragOver={(e) => {
                if (editable) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain') || dragging;
                setDragging(null);
                if (id) move(id, index);
              }}
              className={cn(editable && 'md:cursor-grab', dragging === item.id && 'opacity-50')}
            >
              <ItemCard item={item}>
                {editable && (
                  <OwnerControls
                    item={item}
                    first={index === 0}
                    last={index === items.length - 1}
                    busy={reorder.isPending}
                    onUp={() => {
                      move(item.id, index - 1);
                    }}
                    onDown={() => {
                      move(item.id, index + 1);
                    }}
                    onEdit={() => {
                      setEditing({ mode: 'edit', item });
                    }}
                    onDelete={() => {
                      setDeleting(item);
                    }}
                  />
                )}
              </ItemCard>
            </li>
          ))}
        </ol>
      )}

      {editable && (
        <ItemFormSheet
          key={editing?.mode === 'edit' ? editing.item.id : 'new'}
          open={editing !== null}
          mode={editing?.mode ?? 'add'}
          {...(editing?.mode === 'edit' ? { defaultValues: itemToFormValues(editing.item) } : {})}
          onClose={() => {
            setEditing(null);
          }}
          onSubmit={async (payload) => {
            if (editing?.mode === 'edit') {
              await update.mutateAsync({ id: editing.item.id, payload });
              toast.success(t('wishlist.toast.saved'));
            } else {
              await create.mutateAsync(payload);
              toast.success(t('wishlist.toast.added'));
            }
          }}
        />
      )}

      <Modal
        open={deleting !== null}
        onClose={() => {
          if (!remove.isPending) setDeleting(null);
        }}
        title={t('wishlist.delete.title', { title: deleting?.title ?? '' })}
        description={t('wishlist.delete.body')}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => {
                setDeleting(null);
              }}
            >
              {t('wishlist.form.cancel')}
            </Button>
            <Button
              variant="secondary"
              loading={remove.isPending}
              onClick={() => {
                if (!deleting) return;
                remove.mutate(deleting.id, {
                  onSuccess: () => toast.success(t('wishlist.toast.deleted')),
                  onError: (error) => toast.error(errorMessage(t, error)),
                  onSettled: () => {
                    setDeleting(null);
                  },
                });
              }}
            >
              {t('wishlist.delete.confirm')}
            </Button>
          </>
        }
      />
    </section>
  );
}

function ItemCard({ item, children }: { item: WishlistItem; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Card as="article" aria-label={item.title} className="flex flex-col gap-12">
      <div className="flex flex-wrap items-start justify-between gap-12">
        <h3 className="min-w-0 flex-1 font-sans text-subheading break-words">{item.title}</h3>
        <div className="flex items-center gap-10">
          {item.price_crc !== null && (
            <span className="font-mono text-body text-ink-black">
              <span className="sr-only">{t('wishlist.item.price')}: </span>
              {formatCRC(item.price_crc)}
            </span>
          )}
          <Pill>
            <span className="sr-only">{t('wishlist.priority.label')}: </span>
            {t(`wishlist.priority.${item.priority}`)}
          </Pill>
        </div>
      </div>
      {item.note && (
        <p className="text-body break-words whitespace-pre-line text-charcoal">{item.note}</p>
      )}
      {(item.url ?? children) && (
        <div className="flex flex-wrap items-center gap-10">
          {item.url && (
            <Button variant="ghost" asChild>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('wishlist.item.linkLabel', { title: item.title })}
              >
                {t('wishlist.item.link')}
              </a>
            </Button>
          )}
          {children}
        </div>
      )}
    </Card>
  );
}

function OwnerControls({
  item,
  first,
  last,
  busy,
  onUp,
  onDown,
  onEdit,
  onDelete,
}: {
  item: WishlistItem;
  first: boolean;
  last: boolean;
  busy: boolean;
  onUp: () => void;
  onDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="ml-auto flex flex-wrap items-center gap-10">
      {/* Mobile reordering. From 768px the cards are dragged; the pills stay reachable by
          keyboard (visually hidden until focused) so reordering never needs a mouse. */}
      <div className="flex gap-10 md:sr-only md:focus-within:not-sr-only">
        <Button
          variant="nav"
          iconOnly
          aria-label={t('wishlist.item.moveUp', { title: item.title })}
          disabled={first || busy}
          onClick={onUp}
        >
          <ArrowUpIcon />
        </Button>
        <Button
          variant="nav"
          iconOnly
          aria-label={t('wishlist.item.moveDown', { title: item.title })}
          disabled={last || busy}
          onClick={onDown}
        >
          <ArrowDownIcon />
        </Button>
      </div>
      <Button
        variant="ghost"
        aria-label={t('wishlist.item.editLabel', { title: item.title })}
        onClick={onEdit}
      >
        {t('wishlist.item.edit')}
      </Button>
      <Button
        variant="ghost"
        aria-label={t('wishlist.item.deleteLabel', { title: item.title })}
        onClick={onDelete}
      >
        {t('wishlist.item.delete')}
      </Button>
    </div>
  );
}

function EmptyState({
  own,
  name,
  canAdd,
  onAdd,
}: {
  own: boolean;
  name: string;
  canAdd: boolean;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-12">
      <p className="font-serif text-heading-sm font-medium">
        {own ? t('wishlist.empty.ownTitle') : t('wishlist.empty.otherTitle', { name })}
      </p>
      <p className="text-body text-charcoal">
        {own ? t('wishlist.empty.ownBody') : t('wishlist.empty.otherBody')}
      </p>
      {canAdd && (
        <Button variant="primary" onClick={onAdd}>
          {t('wishlist.add')}
        </Button>
      )}
    </div>
  );
}
